'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

import type { MotionPayload } from '../../core/documents/payload';
import type { ForgeDocument } from '../../core/documents/types';
import {
  MAX_MOTION_EXPORT_FRAMES,
  motionArchiveName,
  planMotionExport,
  type MotionExportPlan,
} from '../../core/motion/export';
import { formatByteSize } from '../../core/photo/export';
import { exportMotionFrames } from '../../lib/browser/motion-engine';
import { downloadBytes } from '../../lib/browser/download';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/field';
import { InlineNote } from '../ui/states';

type ExportReport = {
  readonly fileName: string;
  readonly bytes: number;
  readonly frames: number;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
};

/**
 * Frame export.
 *
 * The panel renders the saved document at the planned times, zips the PNGs with a manifest and
 * downloads them. It reports the frame count and the archive size that were actually produced —
 * there is no "processing" state that ends in a success message without a file.
 */
export function MotionExportPanel({
  doc,
  payload,
}: {
  readonly doc: ForgeDocument;
  readonly payload: MotionPayload;
}) {
  const [from, setFrom] = useState('0');
  const [to, setTo] = useState(String(payload.duration));
  const [scale, setScale] = useState('1');
  const [step, setStep] = useState('1');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ rendered: number; total: number } | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [error, setError] = useState<{ message: string; detail: string | null } | null>(null);
  const [plan, setPlan] = useState<MotionExportPlan | null>(null);

  function planNow(): MotionExportPlan | null {
    const result = planMotionExport({
      document: doc,
      payload,
      from: Number(from),
      to: Number(to),
      scale: Number(scale),
      frameStep: Number(step),
    });
    if (!result.ok) {
      setPlan(null);
      setError({ message: result.error.message, detail: result.error.detail ?? null });
      return null;
    }
    setError(null);
    setPlan(result.value);
    return result.value;
  }

  async function runExport(): Promise<void> {
    setReport(null);
    setProgress(null);
    const planned = planNow();
    if (!planned) return;
    setBusy(true);
    const started = performance.now();
    const outcome = await exportMotionFrames({
      document: doc,
      payload,
      plan: planned,
      resolveImage: () => undefined,
      onProgress: setProgress,
    });
    setBusy(false);
    if (outcome.status === 'cancelled') return;
    if (outcome.status === 'failed') {
      setError({ message: outcome.error.message, detail: outcome.error.detail ?? null });
      return;
    }
    const delivered = downloadBytes(outcome.zip, motionArchiveName(doc.title), 'application/zip');
    if (!delivered) {
      setError({
        message: 'The archive was built but the browser refused the download.',
        detail: 'Object URLs are unavailable in this context, so no file was delivered.',
      });
      return;
    }
    setReport({
      fileName: motionArchiveName(doc.title),
      bytes: outcome.zip.byteLength,
      frames: outcome.frames,
      width: outcome.width,
      height: outcome.height,
      durationMs: Math.round(performance.now() - started),
    });
  }

  return (
    <section aria-labelledby="motion-export-heading" className="space-y-3">
      <div>
        <h3
          id="motion-export-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Frame export
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          A PNG sequence plus a JSON manifest, zipped. Frames are rendered from the saved document
          at the exact times the timeline shows — this is not a video codec, and the archive does
          not claim to be one.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Start (seconds)">
          <Input
            type="number"
            min={0}
            step={0.1}
            value={from}
            aria-label="Export start"
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field label="End (seconds)">
          <Input
            type="number"
            min={0}
            step={0.1}
            value={to}
            aria-label="Export end"
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </Field>
        <Field label="Scale" labelSuffix="× document">
          <Input
            type="number"
            min={0.1}
            max={4}
            step={0.1}
            value={scale}
            aria-label="Export scale"
            onChange={(event) => {
              setScale(event.target.value);
            }}
          />
        </Field>
        <Field label="Frame step" labelSuffix="1 = every frame">
          <Input
            type="number"
            min={1}
            max={60}
            step={1}
            value={step}
            aria-label="Frame step"
            onChange={(event) => {
              setStep(event.target.value);
            }}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            planNow();
          }}
        >
          Check range
        </Button>
        <Button
          variant="primary"
          size="sm"
          iconLeft={<Download aria-hidden />}
          loading={busy}
          loadingLabel={
            progress
              ? `Rendering frame ${String(progress.rendered)} of ${String(progress.total)}`
              : 'Rendering frames'
          }
          onClick={() => {
            void runExport();
          }}
        >
          Export frames
        </Button>
      </div>

      {plan ? (
        <p className="text-fg-subtle text-xs" data-testid="motion-export-plan">
          {plan.frameCount} frames at {plan.width} × {plan.height}, {plan.fps} fps. The limit is{' '}
          {MAX_MOTION_EXPORT_FRAMES} frames per export.
        </p>
      ) : null}

      {busy && progress ? (
        <p className="forge-numeric text-fg-subtle text-xs" aria-live="polite">
          Rendered {progress.rendered} of {progress.total} frames.
        </p>
      ) : null}

      {error ? (
        <InlineNote tone="danger" title="The export did not run">
          <p>{error.message}</p>
          {error.detail ? <p className="text-fg-subtle text-xs">{error.detail}</p> : null}
        </InlineNote>
      ) : null}

      {report ? (
        <InlineNote tone="tip" title="Exported">
          <p data-testid="motion-export-report">
            {report.fileName} · {report.frames} frames at {report.width} × {report.height} ·{' '}
            {formatByteSize(report.bytes)}
          </p>
          <p className="text-fg-subtle text-xs">
            Rendered and encoded in {report.durationMs} ms. The manifest records every frame time.
          </p>
        </InlineNote>
      ) : null}
    </section>
  );
}
