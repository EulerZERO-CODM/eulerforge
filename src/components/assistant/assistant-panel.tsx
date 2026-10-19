'use client';

import { useEffect, useRef, useState } from 'react';

import { ok } from '../../core/result';
import type { AssistantStudio } from '../../core/assistant/registry';
import { toolsForStudio, STUDIO_LABELS } from '../../core/assistant/registry';
import { planNatively } from '../../core/assistant/planner';
import {
  executePlan,
  type AssistantEnvironment,
  type RunReport,
  type StepReport,
} from '../../core/assistant/executor';
import type { Result } from '../../core/result';
import { Button } from '../ui/button';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';

type DownloadKind = 'svg' | 'png' | 'jpeg' | 'webp';

export type AssistantPanelProps = {
  readonly api: WorkspaceApi;
  readonly studio: AssistantStudio;
  readonly selection: readonly string[];
  /** Undo the run's last edit, from the same history the editor uses. */
  readonly onUndo: () => void;
  readonly canUndo: boolean;
  /** Produces a real file for an export step; without it, export steps refuse rather than pretend. */
  readonly download?: (kind: DownloadKind) => Promise<Result<{ fileName: string; bytes: number }>>;
};

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

  const compiled = planNatively(studio, request);
  const tools = toolsForStudio(studio);

  const plan = (): void => {
    cancel.current = false;
    pause.current = false;
    setReports([]);
    setSummary(null);
    setError(null);
    if (!compiled.ok) {
      setError(compiled.error.message);
      return;
    }
    setPhase(compiled.value.steps.length > 0 ? 'planned' : 'finished');
    if (compiled.value.steps.length === 0) {
      setSummary('Nothing can run: the request is explained below.');
    }
  };

  const run = async (): Promise<void> => {
    if (!compiled.ok || compiled.value.steps.length === 0) return;
    cancel.current = false;
    pause.current = false;
    setPhase('running');
    setError(null);
    setSummary(null);

    const environment: AssistantEnvironment = {
      studio,
      current: () => latest.current.document,
      selection: () => latest.current.selection,
      commit: async (command) => api.run(ok(command)),
      download: async (kind) => {
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
        return download(kind);
      },
    };

    const report: RunReport = await executePlan(compiled.value, environment, {
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
  };

  const pending = phase === 'running';
  const hasSteps = compiled.ok && compiled.value.steps.length > 0;

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
          Native planner — no external model is configured. It understands a documented vocabulary
          for {STUDIO_LABELS[studio]} and refuses the rest instead of guessing.
        </p>
      </div>

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
          variant="primary"
          size="sm"
          data-testid="assistant-run"
          disabled={pending || !hasSteps || phase === 'idle'}
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
