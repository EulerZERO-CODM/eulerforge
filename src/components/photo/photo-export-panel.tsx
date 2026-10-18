'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

import {
  PHOTO_EXPORT_FORMATS,
  PHOTO_EXPORT_INFO,
  formatByteSize,
  planPhotoExport,
  type PhotoExportFormat,
} from '../../core/photo/export';
import {
  canEncodeImage,
  canvasToBytes,
  decodePhotoSource,
  renderPhoto,
} from '../../lib/browser/photo-engine';
import { downloadBytes } from '../../lib/browser/download';
import type { PhotoPayload } from '../../core/documents/payload';
import { Button } from '../ui/button';
import { Field, Select } from '../ui/field';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';

type ExportReport = {
  readonly fileName: string;
  readonly bytes: number;
  readonly engine: string;
  readonly fallbackReason: string | null;
  readonly width: number;
  readonly height: number;
};

/**
 * Export.
 *
 * The bytes come from a full-resolution render of the saved document, encoded by the browser, and
 * handed to the download adapter. The panel reports the size and engine that actually produced the
 * file, so the claim can be checked against the file in the download folder.
 */
export function PhotoExportPanel({
  api,
  payload,
}: {
  readonly api: WorkspaceApi;
  readonly payload: PhotoPayload;
}) {
  const [format, setFormat] = useState<PhotoExportFormat>('png');
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [error, setError] = useState<{ message: string; detail: string | null } | null>(null);
  const document = api.doc;

  async function runExport(): Promise<void> {
    setError(null);
    setReport(null);
    if (!payload.source) {
      setError({ message: 'There is no imported photo to export.', detail: null });
      return;
    }
    const plan = planPhotoExport(
      {
        documentTitle: document.title,
        payload,
        width: document.canvas.width,
        height: document.canvas.height,
        format,
        quality: quality / 100,
      },
      { mimeTypeSupported: canEncodeImage(PHOTO_EXPORT_INFO[format].mimeType) },
    );
    if (!plan.ok) {
      setError({ message: plan.error.message, detail: plan.error.detail ?? null });
      return;
    }
    if (!plan.value.mimeTypeSupported) {
      setError({
        message: `This browser cannot encode ${PHOTO_EXPORT_INFO[format].label}.`,
        detail: 'Choose PNG or JPEG; the check is made by asking the browser’s own encoder.',
      });
      return;
    }

    setBusy(true);
    const decoded = await decodePhotoSource(payload.source.href);
    if (!decoded.ok) {
      setBusy(false);
      setError({ message: decoded.error.message, detail: decoded.error.detail ?? null });
      return;
    }
    const rendered = await renderPhoto({
      image: decoded.value.image,
      payload,
      width: plan.value.width,
      height: plan.value.height,
    });
    if (!rendered.ok) {
      setBusy(false);
      setError({ message: rendered.error.message, detail: rendered.error.detail ?? null });
      return;
    }
    const bytes = await canvasToBytes(
      rendered.value.canvas,
      plan.value.mimeType,
      plan.value.quality,
    );
    setBusy(false);
    if (!bytes.ok) {
      setError({ message: bytes.error.message, detail: bytes.error.detail ?? null });
      return;
    }
    const delivered = downloadBytes(bytes.value, plan.value.fileName, plan.value.mimeType);
    if (!delivered) {
      setError({
        message: 'The file was encoded but the browser refused the download.',
        detail: 'Object URLs are unavailable in this context, so no file was delivered.',
      });
      return;
    }
    setReport({
      fileName: plan.value.fileName,
      bytes: bytes.value.byteLength,
      engine: rendered.value.engine,
      fallbackReason: rendered.value.fallbackReason,
      width: plan.value.width,
      height: plan.value.height,
    });
  }

  return (
    <section aria-labelledby="photo-export-heading" className="space-y-3">
      <div>
        <h3
          id="photo-export-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Export
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          Rendered from the saved document at {document.canvas.width} × {document.canvas.height} —
          the full working copy, not the preview.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Format">
          <Select
            value={format}
            onChange={(event) => {
              const next = PHOTO_EXPORT_FORMATS.find(
                (candidate) => candidate === event.target.value,
              );
              if (next) setFormat(next);
            }}
            options={PHOTO_EXPORT_FORMATS.map((candidate) => ({
              value: candidate,
              label: `${PHOTO_EXPORT_INFO[candidate].label} · .${PHOTO_EXPORT_INFO[candidate].extension}`,
            }))}
          />
        </Field>
        <Field
          label="Quality"
          labelSuffix={PHOTO_EXPORT_INFO[format].quality ? `${String(quality)}%` : 'lossless'}
        >
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            value={quality}
            disabled={!PHOTO_EXPORT_INFO[format].quality}
            aria-label="Export quality"
            className="accent-accent w-full"
            onChange={(event) => {
              setQuality(Number(event.target.value));
            }}
          />
        </Field>
      </div>
      <p className="text-fg-subtle text-xs">{PHOTO_EXPORT_INFO[format].description}</p>

      <Button
        variant="primary"
        size="sm"
        iconLeft={<Download aria-hidden />}
        loading={busy}
        loadingLabel="Rendering export"
        disabled={!payload.source}
        onClick={() => {
          void runExport();
        }}
      >
        Export {PHOTO_EXPORT_INFO[format].label}
      </Button>

      {report ? (
        <InlineNote tone="tip" title="Exported">
          <p data-testid="photo-export-report">
            <span className="forge-numeric">{report.fileName}</span> ·{' '}
            <span className="forge-numeric">
              {report.width} × {report.height}
            </span>{' '}
            · <span className="forge-numeric">{formatByteSize(report.bytes)}</span> ·{' '}
            {report.engine === 'webgl2' ? 'WebGL2 renderer' : 'Canvas 2D renderer'}
          </p>
          {report.fallbackReason ? (
            <p className="text-fg-subtle text-xs">
              Fell back to Canvas 2D: {report.fallbackReason}
            </p>
          ) : null}
        </InlineNote>
      ) : null}

      {error ? (
        <InlineNote tone="danger" title="Export failed">
          <p>{error.message}</p>
          {error.detail ? <p className="text-2xs">{error.detail}</p> : null}
        </InlineNote>
      ) : null}
    </section>
  );
}
