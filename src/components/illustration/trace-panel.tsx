'use client';

import { useId, useState } from 'react';

import { traceLayersCommand } from '../../core/editor/trace-commands';
import { TRACE_LIMITS, type TraceReport } from '../../core/vector/trace';
import { TRACE_ACCEPT_ATTRIBUTE, traceFile } from '../../lib/browser/image-trace';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/field';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';

const DEFAULT_COLOURS = TRACE_LIMITS.defaultColours;
const DEFAULT_DETAIL = 60;
const DEFAULT_MIN_AREA = 12;

/**
 * Image tracing.
 *
 * "Turn this picture into vectors" is the Illustrator feature people actually reach for, so it gets
 * a real control panel rather than an internal function: choose a file, dial the palette and detail,
 * and one press turns the image into editable paths. The alternative — leaving the tracer in core
 * with no entry point — would be exactly the kind of capability this project refuses to claim.
 *
 * Every trace is one document change with one undo label, so a trace that looks wrong can be undone
 * with a single Ctrl+Z. The panel says how many regions were dropped as specks, because a trace that
 * silently ignored half the image would be a confident lie.
 */
export function TracePanel({ api }: { readonly api: WorkspaceApi }) {
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [colours, setColours] = useState<number>(DEFAULT_COLOURS);
  const [detail, setDetail] = useState<number>(DEFAULT_DETAIL);
  const [minArea, setMinArea] = useState(DEFAULT_MIN_AREA);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [report, setReport] = useState<TraceReport | null>(null);

  const canTrace = file !== null && !busy;

  async function trace(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError(null);
    setStatus(null);

    const traced = await traceFile(file, { colours, detail, minArea });
    if (!traced.ok) {
      setBusy(false);
      setReport(null);
      setError(traced.error.detail ?? traced.error.message);
      return;
    }

    const command = traceLayersCommand(api.doc, traced.value.report);
    if (!command.ok) {
      setBusy(false);
      setReport(null);
      setError(command.error.detail ?? command.error.message);
      return;
    }

    const applied = await api.run(command);
    setBusy(false);
    if (!applied) {
      setReport(null);
      setError('The trace could not be added to this document.');
      return;
    }

    const { regions, nodes, droppedRegions } = traced.value.report;
    setReport(traced.value.report);
    setStatus(
      `Traced “${traced.value.fileName}” into ${String(regions.length)} editable ${
        regions.length === 1 ? 'layer' : 'layers'
      } with ${String(nodes)} nodes` +
        (droppedRegions > 0
          ? `; ${String(droppedRegions)} region${droppedRegions === 1 ? '' : 's'} below ${String(minArea)} px² were left out.`
          : '.'),
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="trace-heading">
      <div className="space-y-1">
        <h2 id="trace-heading" className="text-sm font-medium">
          Trace an image
        </h2>
        <p className="text-fg-subtle text-xs">
          Turns a PNG, JPEG or WebP into editable paths — one filled layer per colour. Transparent
          pixels are not traced. A photograph becomes shapes, not a hand-drawn illustration, so
          expect staircase edges at low detail.
        </p>
      </div>

      <Field label="Image" hint="PNG, JPEG or WebP, up to 25 MB.">
        <input
          id={fileId}
          type="file"
          accept={TRACE_ACCEPT_ATTRIBUTE}
          data-testid="trace-file"
          className="text-fg-muted file:border-line-strong file:bg-ink-900 file:text-fg border-line-strong bg-ink-950 w-full rounded-sm border px-2 py-1.5 text-xs file:mr-2 file:rounded-sm file:border file:px-2 file:py-1 file:text-xs"
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            setFile(chosen);
            setReport(null);
            setStatus(null);
            setError(null);
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Colours" labelSuffix={String(colours)}>
          <input
            type="range"
            min={TRACE_LIMITS.minColours}
            max={TRACE_LIMITS.maxColours}
            step={1}
            value={colours}
            aria-label="Colours in the traced palette"
            className="accent-accent w-full"
            onChange={(event) => {
              setColours(Number(event.target.value));
            }}
          />
        </Field>
        <Field label="Detail" labelSuffix={`${String(detail)}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={detail}
            aria-label="Tracing detail"
            className="accent-accent w-full"
            onChange={(event) => {
              setDetail(Number(event.target.value));
            }}
          />
        </Field>
      </div>

      <Field
        label="Ignore specks below"
        labelSuffix="px²"
        hint="Regions smaller than this are dropped instead of becoming noise layers."
      >
        <Input
          type="number"
          min={1}
          max={100_000}
          step={1}
          value={minArea}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value >= 1) setMinArea(Math.round(value));
          }}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          data-testid="trace-run"
          disabled={!canTrace}
          onClick={() => {
            void trace();
          }}
        >
          {busy ? 'Tracing…' : 'Trace image'}
        </Button>
        {report ? (
          <span className="text-fg-muted text-2xs" data-testid="trace-summary">
            {report.regions.length} layers · {report.nodes} nodes · palette of{' '}
            {report.palette.length}
          </span>
        ) : null}
      </div>

      {report ? (
        <div className="flex flex-wrap gap-1" aria-label="Traced palette">
          {report.palette.map((colour) => (
            <span
              key={colour}
              title={colour}
              className="border-line-strong h-4 w-4 rounded-xs border"
              style={{ backgroundColor: colour }}
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <div data-testid="trace-error">
          <InlineNote tone="warning">{error}</InlineNote>
        </div>
      ) : null}
      {status ? (
        <div data-testid="trace-status">
          <InlineNote tone="info">{status}</InlineNote>
        </div>
      ) : null}
    </section>
  );
}
