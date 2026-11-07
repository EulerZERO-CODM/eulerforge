'use client';

import { Download, Radio } from 'lucide-react';
import { useState } from 'react';

import type { VideoPayload } from '../../core/documents/payload';
import type { ForgeDocument } from '../../core/documents/types';
import type { MediaStore } from '../../core/video/media-store';
import {
  MAX_VIDEO_CAPTURE_SECONDS,
  MAX_VIDEO_EXPORT_FRAMES,
  planVideoCapture,
  planVideoExport,
  videoArchiveName,
  videoExportBlockers,
  type VideoExportPlan,
} from '../../core/video/export';
import { formatByteSize } from '../../core/photo/export';
import { downloadBlob, downloadBytes } from '../../lib/browser/download';
import {
  captureTimeline,
  exportVideoFrames,
  pickCaptureMimeType,
  type VideoCaptureOutcome,
} from '../../lib/browser/video-engine';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/field';
import { InlineNote } from '../ui/states';

type FrameReport = {
  readonly fileName: string;
  readonly bytes: number;
  readonly frames: number;
  readonly width: number;
  readonly height: number;
  readonly skipped: readonly string[];
  readonly durationMs: number;
};

type CaptureReport = {
  readonly fileName: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly durationSeconds: number;
  readonly audioIncluded: boolean;
};

/**
 * Export.
 *
 * Two real outputs, each labelled for what it is. The frame sequence is a deterministic render at
 * the exact planned times and carries a manifest. The capture is a real-time `MediaRecorder` take of
 * the same composition, so it produces an actual video file but is not frame-exact — the panel says
 * both things, and reports the container the browser negotiated rather than a guessed one.
 */
export function VideoExportPanel({
  doc,
  payload,
  store,
}: {
  readonly doc: ForgeDocument;
  readonly payload: VideoPayload;
  readonly store: MediaStore | null;
}) {
  const [from, setFrom] = useState('0');
  const [to, setTo] = useState(String(payload.duration));
  const [scale, setScale] = useState('1');
  const [step, setStep] = useState('1');
  const [plan, setPlan] = useState<VideoExportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ rendered: number; total: number } | null>(null);
  const [report, setReport] = useState<FrameReport | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureElapsed, setCaptureElapsed] = useState(0);
  const [captureReport, setCaptureReport] = useState<CaptureReport | null>(null);
  const [error, setError] = useState<{ message: string; detail: string | null } | null>(null);

  const blockers = videoExportBlockers(payload);
  const captureMimeType = pickCaptureMimeType();
  const loadMedia = async (mediaId: string) =>
    store ? store.get(mediaId) : Promise.resolve({ ok: true as const, value: null });

  function planNow(): VideoExportPlan | null {
    const result = planVideoExport({
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
    try {
      const outcome = await exportVideoFrames({
        document: doc,
        payload,
        plan: planned,
        loadMedia,
        onProgress: setProgress,
      });
      if (outcome.status === 'cancelled') return;
      if (outcome.status === 'failed') {
        setError({ message: outcome.error.message, detail: outcome.error.detail ?? null });
        return;
      }
      const fileName = videoArchiveName(doc.title);
      const delivered = downloadBytes(outcome.zip, fileName, 'application/zip');
      if (!delivered) {
        setError({
          message: 'The archive was built but the browser refused the download.',
          detail: 'Object URLs are unavailable in this context, so no file was delivered.',
        });
        return;
      }
      setReport({
        fileName,
        bytes: outcome.zip.byteLength,
        frames: outcome.frames,
        width: outcome.width,
        height: outcome.height,
        skipped: outcome.skipped,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      setBusy(false);
    }
  }

  async function runCapture(): Promise<void> {
    setCaptureReport(null);
    setError(null);
    const planned = planVideoCapture({
      document: doc,
      payload,
      from: Number(from),
      to: Number(to),
    });
    if (!planned.ok) {
      setError({ message: planned.error.message, detail: planned.error.detail ?? null });
      return;
    }
    setCaptureBusy(true);
    setCaptureElapsed(0);
    try {
      const outcome: VideoCaptureOutcome = await captureTimeline({
        document: doc,
        payload,
        plan: planned.value,
        loadMedia,
        onProgress: ({ elapsed }) => {
          setCaptureElapsed(elapsed);
        },
      });
      if (outcome.status === 'cancelled') return;
      if (outcome.status === 'unsupported' || outcome.status === 'failed') {
        setError({ message: outcome.error.message, detail: outcome.error.detail ?? null });
        return;
      }
      const delivered = downloadBlob(outcome.blob, outcome.fileName);
      if (!delivered) {
        setError({
          message: 'The recording finished but the browser refused the download.',
          detail: 'Object URLs are unavailable in this context, so no file was delivered.',
        });
        return;
      }
      setCaptureReport({
        fileName: outcome.fileName,
        bytes: outcome.bytes,
        mimeType: outcome.mimeType,
        durationSeconds: outcome.durationSeconds,
        audioIncluded: outcome.audioIncluded,
      });
    } finally {
      setCaptureBusy(false);
    }
  }

  return (
    <section aria-labelledby="video-export-heading" className="space-y-3">
      <div>
        <h3
          id="video-export-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Export
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          A PNG sequence with a manifest, rendered frame by frame, or a real-time WebM capture. No
          other codec is claimed.
        </p>
      </div>

      {blockers.length > 0 ? (
        <InlineNote tone="warning" title="This timeline cannot be exported yet">
          <ul className="list-disc space-y-1 pl-4">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </InlineNote>
      ) : null}

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
          disabled={blockers.length > 0}
          onClick={() => {
            void runExport();
          }}
        >
          Export frames
        </Button>
        <Button
          variant="outline"
          size="sm"
          iconLeft={<Radio aria-hidden />}
          loading={captureBusy}
          loadingLabel={`Recording ${captureElapsed.toFixed(1)} s`}
          disabled={blockers.length > 0 || captureMimeType === null}
          onClick={() => {
            void runCapture();
          }}
        >
          Record WebM
        </Button>
      </div>

      {plan ? (
        <p className="text-fg-subtle text-xs" data-testid="video-export-plan">
          {plan.frameCount} frames at {plan.width} × {plan.height}, {plan.fps} fps. The limit is{' '}
          {MAX_VIDEO_EXPORT_FRAMES} frames per export.
        </p>
      ) : null}

      <p className="text-fg-subtle text-2xs">
        {captureMimeType
          ? `This browser records ${captureMimeType}, in real time — a ${Math.min(
              Number(to) - Number(from) || payload.duration,
              MAX_VIDEO_CAPTURE_SECONDS,
            ).toFixed(1)} s take takes about that long.`
          : 'This browser has no MediaRecorder support for WebM, so only the frame sequence is available.'}
      </p>

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
        <InlineNote tone="tip" title="Exported frames">
          <p data-testid="video-export-report">
            {report.fileName} · {report.frames} frames at {report.width} × {report.height} ·{' '}
            {formatByteSize(report.bytes)}
          </p>
          <p className="text-fg-subtle text-xs">
            Rendered in {report.durationMs} ms. The manifest records every frame time.
          </p>
          {report.skipped.length > 0 ? (
            <p className="text-fg-subtle text-xs">
              Some frames could not be decoded in time: {report.skipped.join(', ')}. Those frames
              show the last decoded picture.
            </p>
          ) : null}
        </InlineNote>
      ) : null}

      {captureReport ? (
        <InlineNote tone="tip" title="Recorded">
          <p data-testid="video-capture-report">
            {captureReport.fileName} · {captureReport.durationSeconds.toFixed(1)} s ·{' '}
            {formatByteSize(captureReport.bytes)} · {captureReport.mimeType}
          </p>
          <p className="text-fg-subtle text-xs">
            {captureReport.audioIncluded
              ? 'Audio from the timeline was mixed into the recording.'
              : 'No audio track was recorded: this browser routed no audio into the capture.'}
          </p>
        </InlineNote>
      ) : null}
    </section>
  );
}
