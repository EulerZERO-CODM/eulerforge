/**
 * A resumable assistant run.
 *
 * A long task can be interrupted by a reload, a closed tab or a crash. The edits that already
 * committed are in the document and the history, so re-running the *whole* plan would apply them
 * twice; stopping for good would leave a half-finished request with no explanation. The checkpoint
 * records which steps finished, which lets a later session continue from the first unfinished one.
 *
 * It deliberately stores no results, no document and no credential — only the goal, the plan and the
 * ids of the steps that completed. A resume therefore starts from the document as it is now, and the
 * executor revalidates every remaining step against the registry.
 */

import {
  ASSISTANT_STUDIOS,
  checkPlan,
  type AssistantPlan,
  type AssistantStudio,
  type ToolCall,
} from './registry';
import { err, forgeError, ok, type Result } from '../result';

export const ASSISTANT_CHECKPOINT_VERSION = 1;

export type AssistantCheckpoint = {
  readonly version: typeof ASSISTANT_CHECKPOINT_VERSION;
  readonly studio: AssistantStudio;
  readonly goal: string;
  readonly plan: AssistantPlan;
  /** Step ids that succeeded, in the order they finished. */
  readonly completed: readonly string[];
  /** ISO timestamp of the last write, for the resume banner. */
  readonly updatedAt: string;
};

export function createCheckpoint(input: {
  readonly studio: AssistantStudio;
  readonly goal: string;
  readonly plan: AssistantPlan;
  readonly now: string;
}): AssistantCheckpoint {
  return Object.freeze({
    version: ASSISTANT_CHECKPOINT_VERSION,
    studio: input.studio,
    goal: input.goal.trim(),
    plan: input.plan,
    completed: Object.freeze([]),
    updatedAt: input.now,
  });
}

/** Records a finished step. Unknown or repeated ids are ignored rather than trusted. */
export function markStepCompleted(
  checkpoint: AssistantCheckpoint,
  stepId: string,
  now: string,
): AssistantCheckpoint {
  if (!checkpoint.plan.steps.some((step) => step.id === stepId)) return checkpoint;
  if (checkpoint.completed.includes(stepId)) return checkpoint;
  return Object.freeze({
    ...checkpoint,
    completed: Object.freeze([...checkpoint.completed, stepId]),
    updatedAt: now,
  });
}

export function remainingSteps(checkpoint: AssistantCheckpoint): readonly ToolCall[] {
  return checkpoint.plan.steps.filter((step) => !checkpoint.completed.includes(step.id));
}

/**
 * The plan a resume should run: the intent and refusals stay, finished steps go.
 *
 * Every remaining step is re-checked against the registry, because a checkpoint can outlive the
 * build that wrote it. A step that no longer validates is reported instead of being attempted.
 */
export function resumePlan(checkpoint: AssistantCheckpoint): Result<AssistantPlan> {
  const steps = remainingSteps(checkpoint);
  if (steps.length === 0) {
    return err(
      forgeError('validation-failed', 'This run has no steps left.', {
        detail: 'Everything in it finished; the checkpoint can be discarded.',
        retryable: false,
      }),
    );
  }
  const plan: AssistantPlan = {
    intent: checkpoint.plan.intent,
    steps: Object.freeze([...steps]),
    unsupported: checkpoint.plan.unsupported,
    source: checkpoint.plan.source,
  };
  const checked = checkPlan(plan);
  if (!checked.ok) return checked;
  if (checked.value.issues.length > 0) {
    return err(
      forgeError(
        'validation-failed',
        'The rest of this run can no longer be applied by this build.',
        {
          detail: checked.value.issues[0]?.message,
          retryable: false,
        },
      ),
    );
  }
  return ok(plan);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a checkpoint written by an earlier session.
 *
 * Unknown versions, unknown studios, missing fields and a malformed plan are refusals, not crashes:
 * the caller drops the record and the user sees a normal assistant panel.
 */
export function parseCheckpoint(raw: unknown): Result<AssistantCheckpoint> {
  if (!isRecord(raw)) {
    return err(forgeError('validation-failed', 'The saved run is not an object.'));
  }
  if (raw.version !== ASSISTANT_CHECKPOINT_VERSION) {
    return err(
      forgeError('validation-failed', 'The saved run was written by a different version.', {
        detail: 'Start the request again; the older run cannot be continued.',
        retryable: false,
      }),
    );
  }
  const studio = raw.studio;
  if (typeof studio !== 'string' || !(ASSISTANT_STUDIOS as readonly string[]).includes(studio)) {
    return err(forgeError('validation-failed', 'The saved run names no studio.'));
  }
  if (typeof raw.goal !== 'string' || raw.goal.trim().length === 0) {
    return err(forgeError('validation-failed', 'The saved run has no goal.'));
  }
  if (typeof raw.updatedAt !== 'string' || Number.isNaN(Date.parse(raw.updatedAt))) {
    return err(forgeError('validation-failed', 'The saved run has no usable timestamp.'));
  }
  if (!isRecord(raw.plan)) {
    return err(forgeError('validation-failed', 'The saved run has no plan.'));
  }
  const plan = raw.plan;
  if (
    (plan.source !== 'native' && plan.source !== 'provider') ||
    typeof plan.intent !== 'string' ||
    !Array.isArray(plan.steps) ||
    !Array.isArray(plan.unsupported)
  ) {
    return err(forgeError('validation-failed', 'The saved plan is unreadable.'));
  }
  const steps: ToolCall[] = [];
  for (const entry of plan.steps) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.tool !== 'string' ||
      !isRecord(entry.args)
    ) {
      return err(forgeError('validation-failed', 'The saved plan has a malformed step.'));
    }
    const args: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(entry.args)) {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return err(forgeError('validation-failed', 'The saved plan has a malformed argument.'));
      }
      args[key] = value;
    }
    steps.push({ id: entry.id, tool: entry.tool, args: Object.freeze(args) });
  }
  const completed = Array.isArray(raw.completed)
    ? raw.completed.filter((value): value is string => typeof value === 'string')
    : [];
  const checkpoint: AssistantCheckpoint = {
    version: ASSISTANT_CHECKPOINT_VERSION,
    studio: studio as AssistantStudio,
    goal: raw.goal.trim().slice(0, 2_000),
    plan: {
      intent: plan.intent,
      steps: Object.freeze(steps),
      // Refusals are plain data; they are kept so a resumed run still explains what it will not do.
      unsupported: plan.unsupported.filter(
        (entry): entry is AssistantPlan['unsupported'][number] =>
          isRecord(entry) &&
          typeof entry.request === 'string' &&
          typeof entry.why === 'string' &&
          Array.isArray(entry.alternatives) &&
          entry.alternatives.every((item) => typeof item === 'string'),
      ),
      source: plan.source,
    },
    // Only ids that exist in this plan count; a stale id must not make a step look finished.
    completed: Object.freeze(completed.filter((id) => steps.some((step) => step.id === id))),
    updatedAt: raw.updatedAt,
  };
  const checked = checkPlan(checkpoint.plan);
  if (!checked.ok) return checked;
  return ok(checkpoint);
}
