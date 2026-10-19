/**
 * The assistant's executor.
 *
 * It runs a plan one step at a time against the *live* document, through the same commands, session,
 * history and exporters the interface uses. Three properties matter more than speed here:
 *
 *  - **Inspect, then report.** A step is never called successful because a command returned a patch;
 *    the tool's `verify` reads the document back after the commit, and a mismatch fails the step.
 *  - **A failure stops the line.** Steps after a failed one are reported as skipped, because a plan
 *    is a sequence of dependent edits, not a bag of independent suggestions.
 *  - **Interruption is normal.** Pause and cancel are checked between steps, every completed step is
 *    already undoable, and the report says exactly where the run stopped.
 */

import type { ForgeDocument } from '../documents/types';
import type { SceneCommand } from '../editor/commands';
import type { Result } from '../result';
import {
  checkPlan,
  findTool,
  validateToolArgs,
  type AssistantPlan,
  type AssistantStudio,
  type ToolCall,
} from './registry';
import { runnerFor } from './tools';

export type AssistantDownload = {
  readonly kind: 'svg' | 'png' | 'jpeg' | 'webp';
  readonly fileName: string;
  readonly bytes: number;
};

export type AssistantEnvironment = {
  readonly studio: AssistantStudio;
  /** The current document, re-read before every step so a tool plans against reality. */
  current(): ForgeDocument;
  /** Selected layer ids, re-read before every step. */
  selection(): readonly string[];
  /** Applies one command through the session; `false` means the session refused it. */
  commit(command: SceneCommand, options?: { readonly coalesceKey?: string }): Promise<boolean>;
  /**
   * Produces a real file and reports what the browser actually wrote.
   *
   * The document is passed in because an export step must write the *current* document: the run may
   * have adjusted it two steps ago, and a callback that closed over the pre-run document would
   * export the state before the request.
   */
  download(
    kind: 'svg' | 'png' | 'jpeg' | 'webp',
    document: ForgeDocument,
  ): Promise<Result<{ readonly fileName: string; readonly bytes: number }>>;
};

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

export type StepReport = {
  readonly step: ToolCall;
  readonly status: StepStatus;
  readonly detail: string;
  /** What the tool read back from the document. */
  readonly inspection?: string;
  readonly error?: string;
};

export type RunStatus = 'completed' | 'failed' | 'cancelled' | 'paused';

export type RunReport = {
  readonly status: RunStatus;
  readonly steps: readonly StepReport[];
  /** Steps whose commands actually changed the document. */
  readonly changed: number;
  readonly files: readonly AssistantDownload[];
  readonly summary: string;
};

export type RunOptions = {
  readonly shouldPause?: () => boolean;
  readonly shouldCancel?: () => boolean;
  readonly onStep?: (report: StepReport, index: number) => void;
};

/** One retry for a failure the error itself calls retryable; nothing more. */
const MAX_DOWNLOAD_ATTEMPTS = 2;

export function planIssues(plan: AssistantPlan): readonly string[] {
  const checked = checkPlan(plan);
  if (!checked.ok) return [checked.error.message];
  return checked.value.issues.map((issue) => issue.message);
}

function skipped(step: ToolCall, status: StepStatus, detail: string): StepReport {
  return { step, status, detail };
}

/**
 * Runs a plan.
 *
 * The environment is asked for fresh state before every step because an earlier step may have
 * replaced the selection, created the layer a later step edits, or been undone by the user.
 */
export async function executePlan(
  plan: AssistantPlan,
  environment: AssistantEnvironment,
  options: RunOptions = {},
): Promise<RunReport> {
  const reports: StepReport[] = plan.steps.map((step) => skipped(step, 'pending', 'Waiting.'));
  const files: AssistantDownload[] = [];
  let changed = 0;

  // A plan with no runnable step is a refusal, not a success with zero work. Saying "completed"
  // here would let the interface claim an outcome for a request nothing acted on.
  if (plan.steps.length === 0) {
    const why =
      plan.unsupported.map((entry) => entry.why).join(' ') || 'The plan contained no steps.';
    return {
      status: 'failed',
      steps: [],
      changed: 0,
      files,
      summary: `Nothing ran. ${why}`,
    };
  }

  // Pre-flight: a plan that names an unknown tool, uses an unavailable capability or carries
  // malformed arguments is refused as a whole, before any step can apply half of it.
  const preflight = planIssues(plan);
  if (preflight.length > 0) {
    const failed = reports.map((report) => ({
      ...report,
      status: 'failed' as const,
      detail: 'Not run: the plan did not pass its pre-flight check.',
      error: preflight.join(' '),
    }));
    return {
      status: 'failed',
      steps: failed,
      changed: 0,
      files,
      summary: `Nothing ran. ${preflight.join(' ')}`,
    };
  }

  const cancel = (): RunReport => {
    const steps = reports.map((report) =>
      report.status === 'pending'
        ? skipped(report.step, 'cancelled', 'Cancelled before this step ran.')
        : report,
    );
    const done = steps.filter((report) => report.status === 'succeeded').length;
    return {
      status: 'cancelled',
      steps,
      changed,
      files,
      summary: `Cancelled after ${String(done)} of ${String(steps.length)} step(s). ${String(changed)} edit(s) and ${String(files.length)} file(s) were kept and can be undone.`,
    };
  };

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]!;
    if (options.shouldCancel?.()) return cancel();
    if (options.shouldPause?.()) {
      return {
        status: 'paused',
        steps: reports,
        changed,
        files,
        summary: `Paused before step ${String(index + 1)} of ${String(reports.length)}. ${String(changed)} edit(s) are already in the history.`,
      };
    }

    reports[index] = skipped(step, 'running', 'Running…');
    options.onStep?.(reports[index]!, index);

    const fail = (message: string): RunReport => {
      reports[index] = {
        ...reports[index]!,
        status: 'failed',
        detail: 'This step did not complete.',
        error: message,
      };
      options.onStep?.(reports[index]!, index);
      for (let later = index + 1; later < reports.length; later += 1) {
        reports[later] = skipped(plan.steps[later]!, 'skipped', 'Skipped: an earlier step failed.');
      }
      return {
        status: 'failed',
        steps: reports,
        changed,
        files,
        summary: `Stopped at step ${String(index + 1)} of ${String(reports.length)}: ${message}`,
      };
    };

    const spec = findTool(step.tool);
    if (!spec) return fail(`Unknown tool “${step.tool}”.`);
    const args = validateToolArgs(spec, step.args);
    if (!args.ok) return fail(args.error.message);
    if (environment.studio !== spec.studio) {
      return fail(`${spec.label} belongs to the ${spec.studio} studio, not ${environment.studio}.`);
    }
    const runner = runnerFor(step);
    if (!runner) return fail(`“${spec.label}” has no implementation in this build.`);

    const outcome = runner(
      { document: environment.current(), selection: environment.selection() },
      args.value,
    );
    if (!outcome.ok) return fail(outcome.error.message);

    let applied = false;
    for (const command of outcome.value.commands) {
      const committed = await environment.commit(command);
      if (!committed) return fail(`The session refused “${command.label}”.`);
      applied = true;
    }
    if (applied) changed += 1;

    let attempts = 1;
    if (outcome.value.download) {
      let produced = await environment.download(outcome.value.download, environment.current());
      // A failure the exporter itself marks retryable (a transient refusal, not a refusal of the
      // format) gets exactly one more attempt. Deterministic failures are not retried, because
      // repeating them would only waste the user's time and hide the real message.
      while (!produced.ok && produced.error.retryable && attempts < MAX_DOWNLOAD_ATTEMPTS) {
        attempts += 1;
        produced = await environment.download(outcome.value.download, environment.current());
      }
      if (!produced.ok) return fail(produced.error.message);
      if (produced.value.bytes <= 0) return fail('The exporter produced an empty file.');
      files.push({
        kind: outcome.value.download,
        fileName: produced.value.fileName,
        bytes: produced.value.bytes,
      });
    }

    let inspection: string;
    try {
      inspection = outcome.value.verify(environment.current());
    } catch (cause) {
      return fail(cause instanceof Error ? cause.message : 'The result did not validate.');
    }

    reports[index] = {
      step,
      status: 'succeeded',
      detail:
        attempts > 1
          ? `${outcome.value.detail} Retried once after a recoverable failure.`
          : outcome.value.detail,
      inspection,
    };
    options.onStep?.(reports[index]!, index);
  }

  const succeeded = reports.filter((report) => report.status === 'succeeded').length;
  return {
    status: 'completed',
    steps: reports,
    changed,
    files,
    summary:
      `${String(succeeded)} step(s) completed; ${String(changed)} changed the document and ` +
      `${String(files.length)} file(s) were written.` +
      (files.length > 0
        ? ` Files: ${files.map((file) => `${file.fileName} (${file.bytes.toLocaleString('en-US')} bytes)`).join(', ')}.`
        : ''),
  };
}
