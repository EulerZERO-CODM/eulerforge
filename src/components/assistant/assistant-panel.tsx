'use client';

import { useEffect, useRef, useState } from 'react';

import { ok } from '../../core/result';
import type { AssistantPlan, AssistantStudio } from '../../core/assistant/registry';
import { toolsForStudio, STUDIO_LABELS } from '../../core/assistant/registry';
import { planNatively } from '../../core/assistant/planner';
import {
  readProviderPlanResponse,
  readProviderStatus,
  type ProviderStatus,
} from '../../core/assistant/provider';
import {
  createCheckpoint,
  markStepCompleted,
  remainingSteps,
  resumePlan,
  type AssistantCheckpoint,
} from '../../core/assistant/checkpoint';
import {
  forgetAssistantRun,
  readAssistantRun,
  writeAssistantRun,
} from '../../lib/browser/assistant-runs';
import {
  executePlan,
  type AssistantEnvironment,
  type RunReport,
  type StepReport,
} from '../../core/assistant/executor';
import type { Result } from '../../core/result';
import { Button } from '../ui/button';
import { InlineNote } from '../ui/states';
import type { ForgeDocument } from '../../core/documents/types';
import type { WorkspaceApi } from '../workspace/workspace-api';

type DownloadKind = 'svg' | 'png' | 'jpeg' | 'webp';

export type AssistantPanelProps = {
  readonly api: WorkspaceApi;
  readonly studio: AssistantStudio;
  readonly selection: readonly string[];
  /** Undo the run's last edit, from the same history the editor uses. */
  readonly onUndo: () => void;
  readonly canUndo: boolean;
  /**
   * Produces a real file for an export step; without it, export steps refuse rather than pretend.
   * The document is the one the run has *now*, after any edits the plan made before this step.
   */
  readonly download?: (
    kind: DownloadKind,
    document: ForgeDocument,
  ) => Promise<Result<{ fileName: string; bytes: number }>>;
};

/**
 * Pulls a sentence out of the planning route's failure envelope.
 *
 * The route returns `{ error: { message, detail? } }`; anything else is a malformed answer from a
 * proxy or a deployment between the browser and this application, and it gets a plain sentence.
 */
function failureText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return 'The planning service could not plan this.';
  }
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return 'The planning service could not plan this.';
  }
  const message = (error as { message?: unknown }).message;
  const detail = (error as { detail?: unknown }).detail;
  const parts = [
    typeof message === 'string' ? message : '',
    typeof detail === 'string' ? detail : '',
  ];
  const text = parts.filter((part) => part.length > 0).join(' ');
  return text.length > 0 ? text : 'The planning service could not plan this.';
}

const STATUS_LABELS: Readonly<Record<StepReport['status'], string>> = {
  pending: 'Waiting',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

/**
 * The assistant's panel.
 *
 * It shows the plan *before* running it, streams a status per step, and can be cancelled or paused
 * between steps. The executor it calls is the same one the tests drive; the only thing this component
 * adds is a request field and the plumbing to the session that already exists.
 *
 * The disclosure at the top is not decoration: this build ships no model, so the panel says that the
 * plan comes from the deterministic native planner and which tools each studio offers. A deployment
 * with a provider configured replaces the planner, not the guarantee that every step is a typed tool
 * call.
 */
export function AssistantPanel({
  api,
  studio,
  selection,
  onUndo,
  canUndo,
  download,
}: AssistantPanelProps) {
  const [request, setRequest] = useState('');
  const [reports, setReports] = useState<readonly StepReport[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'planned' | 'running' | 'finished'>('idle');
  const cancel = useRef(false);
  const pause = useRef(false);
  // The executor must read the document the *session* has now, not the one captured when the run
  // started: a commit re-renders this panel with a new `api`, and a stale closure would make every
  // verification compare against the state before the edit.
  const latest = useRef({ document: api.doc, selection });
  useEffect(() => {
    // Syncing in an effect (not during render) keeps the executor pointed at the document the
    // session has *now*, including after a commit re-renders this panel.
    latest.current = { document: api.doc, selection };
  }, [api.doc, selection]);

  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  // A model plan is kept as data. The native plan stays live as the request is edited; typing
  // discards the model's plan so a stale one can never be run against a different sentence.
  const [modelPlan, setModelPlan] = useState<{
    readonly plan: AssistantPlan;
    readonly label: string;
  } | null>(null);
  // A resumed run is its own plan: its unfinished steps, not the native planner's reading of the
  // sentence, and not a repeat of the steps that already committed.
  const [resumedPlan, setResumedPlan] = useState<AssistantPlan | null>(null);
  const [resumable, setResumable] = useState<AssistantCheckpoint | null>(null);
  const nativePlan = planNatively(studio, request);
  const compiled: Result<AssistantPlan> = resumedPlan
    ? ok(resumedPlan)
    : modelPlan
      ? ok(modelPlan.plan)
      : nativePlan;
  const tools = toolsForStudio(studio);

  useEffect(() => {
    // A checkpoint belongs to a document and lives in localStorage, which does not exist during the
    // server render. Read it after the first paint, and drop a record from another document rather
    // than offering to resume a run against the wrong picture.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setResumable(readAssistantRun(api.doc.id));
      setResumedPlan(null);
      setModelPlan(null);
      setPhase('idle');
    });
    return () => {
      cancelled = true;
    };
  }, [api.doc.id]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/assistant/plan');
        if (!response.ok) return;
        const status = readProviderStatus(await response.json());
        if (!cancelled && status) setProvider(status);
      } catch {
        // Provider status is an enhancement. Without it the native planner is still the default and
        // the model button explains the failure if it is pressed.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = (): void => {
    cancel.current = false;
    pause.current = false;
    setReports([]);
    setSummary(null);
    setError(null);
    setProviderError(null);
    setModelPlan(null);
    setResumedPlan(null);
    if (!compiled.ok) {
      setError(compiled.error.message);
      return;
    }
    setPhase(compiled.value.steps.length > 0 ? 'planned' : 'finished');
    if (compiled.value.steps.length === 0) {
      setSummary('Nothing can run: the request is explained below.');
    }
  };

  /**
   * Asks the server-side model to plan instead of the native planner.
   *
   * The browser sends the sentence and a six-field document summary; the server keeps the credential
   * and returns a plan. The answer is validated here too, and the executor revalidates every step,
   * so a proxy that mangles the response cannot put an unchecked call into the document.
   */
  const planWithModel = async (): Promise<void> => {
    if (providerBusy || request.trim().length === 0) return;
    cancel.current = false;
    pause.current = false;
    setReports([]);
    setSummary(null);
    setError(null);
    setProviderError(null);
    setModelPlan(null);
    setProviderBusy(true);
    try {
      const response = await fetch('/api/assistant/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studio,
          request,
          document: {
            title: api.doc.title,
            documentType: String(api.doc.documentTypeId),
            width: api.doc.canvas.width,
            height: api.doc.canvas.height,
            layers: api.doc.scene.layers.length,
            selected: selection.length,
          },
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setProviderError(failureText(payload));
        setPhase('idle');
        return;
      }
      const parsed = readProviderPlanResponse(payload);
      if (!parsed.ok) {
        setProviderError(parsed.error.message);
        setPhase('idle');
        return;
      }
      setResumedPlan(null);
      setModelPlan({
        plan: parsed.value.plan,
        label: [parsed.value.provider.label, parsed.value.provider.model]
          .filter((part) => part.length > 0)
          .join(' · '),
      });
      setPhase(parsed.value.plan.steps.length > 0 ? 'planned' : 'finished');
      if (parsed.value.plan.steps.length === 0) {
        setSummary('Nothing can run: the request is explained below.');
      }
    } catch {
      setProviderError('The planning service could not be reached. Native planning still works.');
      setPhase('idle');
    } finally {
      setProviderBusy(false);
    }
  };

  /**
   * Runs a plan and checkpoints it after every finished step.
   *
   * The checkpoint is what makes an interrupted request resumable: the edits already committed are
   * in the document, so a later session continues from the first unfinished step instead of
   * applying the beginning twice.
   */
  const execute = async (
    planToRun: AssistantPlan,
    checkpoint: AssistantCheckpoint | null,
    goal: string,
  ): Promise<void> => {
    cancel.current = false;
    pause.current = false;
    setPhase('running');
    setError(null);
    setSummary(null);

    let current =
      checkpoint ??
      createCheckpoint({
        studio,
        goal,
        plan: planToRun,
        now: new Date().toISOString(),
      });
    writeAssistantRun(api.doc.id, current);

    const environment: AssistantEnvironment = {
      studio,
      current: () => latest.current.document,
      selection: () => latest.current.selection,
      commit: async (command) => api.run(ok(command)),
      download: async (kind, document) => {
        if (!download) {
          return {
            ok: false,
            error: {
              code: 'unsupported',
              message: `This surface has no ${kind.toUpperCase()} exporter wired to the assistant.`,
              retryable: false,
            },
          };
        }
        return download(kind, document);
      },
    };

    const report: RunReport = await executePlan(planToRun, environment, {
      shouldCancel: () => cancel.current,
      shouldPause: () => pause.current,
      onStep: (step, index) => {
        setReports((current) => current.map((entry, at) => (at === index ? step : entry)));
      },
    });
    // Seed the list from the run itself, which is authoritative even when no step streamed.
    setReports(report.steps);
    setSummary(report.summary);
    setError(
      report.status === 'failed'
        ? (report.steps.find((entry) => entry.status === 'failed')?.error ?? null)
        : null,
    );
    setPhase('finished');

    // Trust the final report over the stream: it is the executor's own account of what committed.
    for (const stepReport of report.steps) {
      if (stepReport.status === 'succeeded') {
        current = markStepCompleted(current, stepReport.step.id, new Date().toISOString());
      }
    }
    if (report.status === 'completed' || remainingSteps(current).length === 0) {
      forgetAssistantRun(api.doc.id);
      setResumable(null);
      return;
    }
    writeAssistantRun(api.doc.id, current);
    setResumable(current);
  };

  const run = async (): Promise<void> => {
    if (!compiled.ok || compiled.value.steps.length === 0) return;
    await execute(compiled.value, null, request.trim());
  };

  const resumeRun = async (): Promise<void> => {
    if (!resumable) return;
    const resumed = resumePlan(resumable);
    if (!resumed.ok) {
      forgetAssistantRun(api.doc.id);
      setResumable(null);
      setError(resumed.error.message);
      return;
    }
    setModelPlan(null);
    setResumedPlan(resumed.value);
    setPhase('planned');
    await execute(resumed.value, resumable, resumable.goal);
  };

  const pending = phase === 'running';
  const hasSteps = compiled.ok && compiled.value.steps.length > 0;
  const modelDisabled =
    pending || providerBusy || request.trim().length === 0 || provider?.configured === false;

  return (
    <section aria-labelledby="assistant-heading" className="space-y-3" data-testid="assistant">
      <div>
        <h3
          id="assistant-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Assistant
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs" data-testid="assistant-provider-note">
          {provider?.configured ? (
            <>
              Model-assisted planning is available through {provider.provider}
              {provider.model ? ` (${provider.model})` : ''}. The credential stays on the server,
              and every proposed step still runs as a typed tool call through this studio’s
              registry.
            </>
          ) : (
            <>
              Native planner — no external model is configured. It understands a documented
              vocabulary for {STUDIO_LABELS[studio]} and refuses the rest instead of guessing.
              {provider?.reason ? ` ${provider.reason}` : ''}
            </>
          )}
        </p>
        {providerError ? (
          <p
            className="text-2xs mt-1 text-rose-300"
            role="alert"
            data-testid="assistant-provider-error"
          >
            {providerError}
          </p>
        ) : null}
      </div>

      {resumable && phase !== 'running' ? (
        <InlineNote
          tone="warning"
          title="An unfinished run"
          actions={
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="outline"
                size="sm"
                data-testid="assistant-resume"
                onClick={() => {
                  void resumeRun();
                }}
              >
                Resume run
              </Button>
              <Button
                variant="quiet"
                size="sm"
                data-testid="assistant-discard"
                onClick={() => {
                  forgetAssistantRun(api.doc.id);
                  setResumable(null);
                  setResumedPlan(null);
                  setPhase('idle');
                }}
              >
                Discard
              </Button>
            </div>
          }
        >
          <p data-testid="assistant-checkpoint">
            “{resumable.goal}” stopped after {resumable.completed.length} of{' '}
            {resumable.plan.steps.length} steps. The finished edits are already in the document;
            resuming runs only what is left.
          </p>
        </InlineNote>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-2xs text-fg-muted font-medium tracking-wide uppercase">
          What should change?
        </span>
        <textarea
          value={request}
          data-testid="assistant-request"
          rows={3}
          placeholder={
            studio === 'illustration'
              ? 'e.g. fill the selected paths with #ef4444 and export the artboard as svg'
              : studio === 'photo'
                ? 'e.g. make this cinematic, then export a jpeg'
                : 'e.g. add a 320x180 rectangle'
          }
          onChange={(event) => {
            setRequest(event.target.value);
            setModelPlan(null);
            setResumedPlan(null);
            setProviderError(null);
            setPhase('idle');
          }}
          className="border-line bg-surface-1 text-fg placeholder:text-fg-subtle focus-visible:ring-accent w-full rounded-md border px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:outline-none"
        />
      </label>

      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          data-testid="assistant-plan"
          disabled={pending || request.trim().length === 0}
          onClick={plan}
        >
          Plan
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="assistant-model-plan"
          disabled={modelDisabled}
          title={
            provider?.configured === false
              ? (provider.reason ?? 'No external model is configured.')
              : 'Ask the server-side model to plan this instead of the native planner.'
          }
          onClick={() => {
            void planWithModel();
          }}
        >
          {providerBusy ? 'Asking the model…' : 'Plan with a model'}
        </Button>
        <Button
          variant="primary"
          size="sm"
          data-testid="assistant-run"
          disabled={pending || providerBusy || !hasSteps || phase === 'idle'}
          onClick={() => {
            void run();
          }}
        >
          Run plan
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="assistant-pause"
          disabled={!pending}
          onClick={() => {
            pause.current = true;
          }}
        >
          Pause
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="assistant-cancel"
          disabled={!pending}
          onClick={() => {
            cancel.current = true;
          }}
        >
          Cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="assistant-undo"
          disabled={!canUndo || pending}
          onClick={onUndo}
        >
          Undo last edit
        </Button>
      </div>

      {compiled.ok && (phase !== 'idle' || request.trim().length > 0) ? (
        <div className="space-y-2" data-testid="assistant-plan-view">
          <p className="text-fg-muted text-xs" data-testid="assistant-intent">
            {compiled.value.intent}
          </p>
          <p className="text-2xs text-fg-subtle" data-testid="assistant-plan-source">
            {modelPlan ? `Model plan · ${modelPlan.label || 'provider'}` : 'Native plan'}
          </p>
          <ol className="space-y-1.5">
            {compiled.value.steps.map((step, index) => {
              const report = reports[index];
              return (
                <li
                  key={step.id}
                  className="border-line-subtle rounded-md border px-2 py-1.5"
                  data-testid={`assistant-step-${String(index)}`}
                >
                  <p className="text-2xs text-fg-subtle forge-numeric">
                    {index + 1}. {step.tool}
                    {report ? ` · ${STATUS_LABELS[report.status]}` : ''}
                  </p>
                  <p className="text-fg-muted text-xs">{report?.detail ?? 'Not run yet.'}</p>
                  {report?.inspection ? (
                    <p className="text-2xs text-emerald-300/90">{report.inspection}</p>
                  ) : null}
                  {report?.error ? (
                    <p className="text-2xs text-rose-300" role="alert">
                      {report.error}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {compiled.value.unsupported.length > 0 ? (
            <InlineNote tone="warning" title="Not done, and why">
              <ul className="space-y-1.5" data-testid="assistant-unsupported">
                {compiled.value.unsupported.map((entry) => (
                  <li key={entry.request}>
                    <p className="font-medium">{entry.request}</p>
                    <p>{entry.why}</p>
                    <ul className="list-disc pl-4">
                      {entry.alternatives.map((alternative) => (
                        <li key={alternative}>{alternative}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </InlineNote>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <p className="text-2xs text-fg-muted" data-testid="assistant-summary">
          {summary}
        </p>
      ) : null}
      {error ? (
        <p className="text-2xs text-rose-300" role="alert" data-testid="assistant-error">
          {error}
        </p>
      ) : null}

      <details className="text-2xs text-fg-subtle">
        <summary className="cursor-pointer select-none">Tools this studio offers</summary>
        <ul className="mt-1 space-y-0.5">
          {tools.map((tool) => (
            <li key={tool.id} className="forge-numeric">
              {tool.id} —{' '}
              {tool.availability.kind === 'native'
                ? 'runs locally'
                : tool.availability.kind === 'needs-provider'
                  ? 'needs a provider'
                  : 'unavailable'}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
