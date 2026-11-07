'use client';

import { Check, CircleAlert, Download, Info, XCircle } from 'lucide-react';
import { useState } from 'react';

import { buildExportChecklist, type CheckStatus } from '../../core/export/checklist';
import { svgExportPayload } from '../../core/export/svg-export';
import { downloadBlob, downloadText } from '../../lib/browser/download';
import { EXPORT_FORMATS, PROJECT_FILE_FORMAT_ID, getExportFormat } from '../../core/export/formats';
import { projectFilePayload } from '../../core/export/project-file';
import {
  DEFAULT_JPEG_QUALITY,
  JPEG_BACKGROUND_LABELS,
  JPEG_BACKGROUNDS,
  MAX_JPEG_QUALITY,
  MIN_JPEG_QUALITY,
  RASTER_SCALES,
  exportRasterImage,
  type JpegBackground,
  type RasterExport,
} from '../../core/export/raster';
import { createBrowserCanvas, canRasteriseHere } from '../../lib/browser/canvas';
import { cn } from '../../lib/cn';
import { useForgeServices } from '../../state/forge-provider';
import { Button } from '../ui/button';
import { Checkbox, Field, Select } from '../ui/field';
import { InlineNote } from '../ui/states';
import type { SceneImages } from './use-scene-images';
import type { WorkspaceApi } from './workspace-api';

const STATUS_ICONS: Record<CheckStatus, typeof Check> = {
  pass: Check,
  warning: CircleAlert,
  blocked: XCircle,
};

const STATUS_COLORS: Record<CheckStatus, string> = {
  pass: 'text-mint-400',
  warning: 'text-amber-400',
  blocked: 'text-rose-400',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Export panel.
 *
 * Runs the real readiness checks for the selected format and then does the work: `.forge.json` writes
 * the document definition, PNG and JPEG rasterise the actual scene through the same renderer the
 * artboard uses (ADR-0016). Planned formats stay listed so a user can read what each will require, and
 * the panel states plainly that they produce no file.
 */
export function ExportPanel({
  api,
  images,
}: {
  readonly api: WorkspaceApi;
  readonly images: SceneImages;
}) {
  const { toasts } = useForgeServices();
  const [formatId, setFormatId] = useState<string>(PROJECT_FILE_FORMAT_ID);
  const [scale, setScale] = useState<number>(1);
  const [quality, setQuality] = useState<number>(DEFAULT_JPEG_QUALITY);
  const [jpegBackground, setJpegBackground] = useState<JpegBackground>('white');
  const [busy, setBusy] = useState(false);
  const [lastExport, setLastExport] = useState<RasterExport | null>(null);
  const [lastSvg, setLastSvg] = useState<{
    readonly fileName: string;
    readonly bytes: number;
    readonly omitted: number;
  } | null>(null);
  const [allowPartial, setAllowPartial] = useState(false);

  const selected = getExportFormat(formatId);
  const isRaster = selected?.kind === 'raster';
  const isVector = selected?.kind === 'vector';
  // Built from the document, so the readiness checks and the download agree about what the file
  // will contain: the panel offers the partial export only after the checks have named the layers.
  const svgPayload = isVector ? svgExportPayload(api.doc, { allowPartial }) : null;
  const rasteriserAvailable = canRasteriseHere();
  const checklist = buildExportChecklist(api.doc, formatId, {
    rasteriserAvailable,
    // The user's own choice about a lossy SVG is part of what the checks describe: the same document
    // is blocked by default and a named warning once the omission is deliberate.
    allowPartialSvg: allowPartial,
    scale,
    jpegBackground,
    // A graphic the browser could not decode blocks the export: it would otherwise be missing from
    // the file while the export reported success.
    renderIssues: images.errors.map((href) => ({
      message: `“${href}” could not be loaded.`,
      blocking: true,
    })),
  });
  // The opt-in has to survive being used. It is shown whenever the *document* has layers SVG cannot
  // hold, not only while the payload is refused — otherwise ticking it would remove the control that
  // ticks it, and the choice could not be undone.
  const svgGap = isVector
    ? checklist.checks.find(
        (candidate) => candidate.id === 'svg-support' && candidate.status !== 'pass',
      )
    : undefined;

  const runSvg = (): void => {
    if (!svgPayload?.ok) {
      if (svgPayload) {
        toasts.error('The SVG was not written', svgPayload.error.message);
      }
      return;
    }
    const payload = svgPayload.value;
    const started = downloadText(payload.contents, payload.fileName, payload.mimeType);
    if (!started) {
      setLastSvg(null);
      toasts.error(
        'The file could not be handed to the browser',
        'The SVG was generated, but this environment has nowhere to save it.',
      );
      return;
    }
    setLastSvg({
      fileName: payload.fileName,
      bytes: payload.bytes,
      omitted: payload.unsupported.length,
    });
    toasts.success(
      'SVG exported',
      payload.unsupported.length > 0
        ? `${payload.fileName} — ${formatBytes(payload.bytes)}. ${String(payload.unsupported.length)} layer(s) were left out.`
        : `${payload.fileName} — ${formatBytes(payload.bytes)}.`,
    );
  };

  const runRaster = async () => {
    if (!selected || !isRaster) return;
    setBusy(true);
    const result = await exportRasterImage({
      document: api.doc,
      format: selected.id === 'jpg' ? 'jpeg' : 'png',
      scale,
      createCanvas: createBrowserCanvas,
      resolveImage: images.resolver,
      quality,
      jpegBackground,
    });
    setBusy(false);

    if (!result.ok) {
      setLastExport(null);
      toasts.error(
        'The image was not exported',
        result.error.detail
          ? `${result.error.message} ${result.error.detail}`
          : result.error.message,
      );
      return;
    }

    const exported = result.value;
    const downloaded = downloadBlob(exported.blob, exported.fileName);
    if (!downloaded) {
      setLastExport(null);
      toasts.error(
        'The file could not be handed to the browser',
        'The image was rendered, but this environment has nowhere to save it.',
      );
      return;
    }

    setLastExport(exported);
    toasts.success(
      `${selected.label} exported`,
      `${exported.fileName} — ${String(exported.width)} × ${String(exported.height)} px, ${formatBytes(exported.bytes)}.`,
    );
  };

  return (
    <section aria-labelledby="export-panel-heading" className="space-y-4">
      <div id="export-panel-heading">
        <h3 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">Export</h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          Checks are evaluated against the selected format, because requirements genuinely differ.
        </p>
      </div>

      <Field label="Format">
        <Select
          value={formatId}
          onChange={(event) => {
            setFormatId(event.target.value);
            setLastExport(null);
          }}
          options={EXPORT_FORMATS.map((format) => ({
            value: format.id,
            label: `${format.label} (.${format.extension})${format.status === 'planned' ? ' — planned' : ''}`,
          }))}
        />
      </Field>

      {isRaster ? (
        <div className="space-y-3">
          <Field
            label="Output scale"
            hint="Multiplies the canvas pixel size; it is not the zoom level."
          >
            <Select
              value={String(scale)}
              onChange={(event) => {
                setScale(Number(event.target.value));
              }}
              options={RASTER_SCALES.map((value) => ({
                value: String(value),
                label: `${String(value)}x — ${String(
                  Math.max(1, Math.round(api.doc.canvas.width * value)),
                )} × ${String(Math.max(1, Math.round(api.doc.canvas.height * value)))} px`,
              }))}
            />
          </Field>

          {selected.id === 'jpg' ? (
            <>
              <Field label="Quality" hint={`${String(Math.round(quality * 100))}%`}>
                <input
                  type="range"
                  min={MIN_JPEG_QUALITY * 100}
                  max={MAX_JPEG_QUALITY * 100}
                  step={1}
                  value={Math.round(quality * 100)}
                  onChange={(event) => {
                    setQuality(Number(event.target.value) / 100);
                  }}
                  className="accent-mint-400 w-full"
                  aria-label="JPEG quality"
                />
              </Field>
              <Field
                label="Transparent areas"
                hint="JPEG has no alpha channel, so alpha is flattened onto this colour."
              >
                <Select
                  value={jpegBackground}
                  onChange={(event) => {
                    setJpegBackground(event.target.value as JpegBackground);
                  }}
                  options={JPEG_BACKGROUNDS.map((value) => ({
                    value,
                    label: JPEG_BACKGROUND_LABELS[value],
                  }))}
                />
              </Field>
            </>
          ) : null}
        </div>
      ) : null}

      {svgGap ? (
        <InlineNote
          tone="warning"
          icon={<CircleAlert aria-hidden />}
          title="SVG would leave layers out"
        >
          <p>{svgGap.detail}</p>
          <Checkbox
            className="mt-1.5"
            label="Export the rest anyway and name what was left out"
            checked={allowPartial}
            data-testid="export-allow-partial"
            onChange={(event) => {
              setAllowPartial(event.target.checked);
            }}
          />
          {svgPayload && !svgPayload.ok && allowPartial ? (
            <p className="text-2xs">{svgPayload.error.message}</p>
          ) : null}
        </InlineNote>
      ) : null}

      {selected ? (
        <InlineNote
          tone={selected.status === 'available' ? 'tip' : 'neutral'}
          icon={<Info aria-hidden />}
        >
          <p>{selected.notes}</p>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <Capability label="Transparency" value={selected.capabilities.transparency} />
            <Capability label="Animation" value={selected.capabilities.animation} />
            <Capability label="Print ready" value={selected.capabilities.printReady} />
            <Capability label="Lossy" value={selected.capabilities.lossy} />
          </dl>
        </InlineNote>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
            Readiness checks
          </p>
          <p
            className={cn(
              'text-2xs font-medium',
              checklist.ready ? 'text-mint-400' : 'text-rose-400',
            )}
          >
            {checklist.summary}
          </p>
        </div>

        <ul className="space-y-2">
          {checklist.checks.map((entry) => {
            const Icon = STATUS_ICONS[entry.status];
            return (
              <li
                key={entry.id}
                className="border-line-subtle bg-ink-950/60 flex gap-2.5 rounded-sm border px-2.5 py-2"
              >
                <Icon
                  aria-hidden
                  className={cn('mt-0.5 size-3.5 shrink-0', STATUS_COLORS[entry.status])}
                />
                <div className="min-w-0">
                  <p className="text-fg text-sm">{entry.label}</p>
                  <p className="text-fg-muted text-xs">{entry.detail}</p>
                  {entry.remedy ? (
                    <p className="text-fg-subtle mt-0.5 text-xs">→ {entry.remedy}</p>
                  ) : null}
                  <span className="sr-only">Status: {entry.status}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-line-subtle flex flex-col gap-2 border-t pt-3">
        <Button
          variant="primary"
          fullWidth
          iconLeft={<Download aria-hidden />}
          disabled={busy || !checklist.ready}
          onClick={() => {
            if (formatId === PROJECT_FILE_FORMAT_ID) {
              // The core builds the payload; handing it to the browser happens here, through the
              // download adapter, so no DOM call sits behind a core module (ADR-0019).
              const payload = projectFilePayload(api.doc);
              const started = downloadBlob(
                new Blob([payload.contents], { type: payload.mimeType }),
                payload.fileName,
              );
              if (started) {
                toasts.success(
                  'Project file downloaded',
                  'It contains the document definition, not a rendered image.',
                );
              } else {
                toasts.warning(
                  'The download could not start',
                  'This environment cannot save files.',
                );
              }
              return;
            }
            if (isVector) {
              runSvg();
              return;
            }
            void runRaster();
          }}
        >
          {busy
            ? 'Rendering…'
            : formatId === PROJECT_FILE_FORMAT_ID
              ? 'Download project file'
              : checklist.ready
                ? `Export ${selected?.label ?? 'image'}`
                : 'Export blocked'}
        </Button>

        {lastExport ? (
          <dl
            data-testid="last-export"
            className="text-fg-subtle forge-numeric border-line-subtle text-2xs space-y-0.5 rounded-sm border px-2.5 py-2"
          >
            <div className="flex justify-between gap-2">
              <dt>File</dt>
              <dd className="truncate">{lastExport.fileName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Size</dt>
              <dd>
                {lastExport.width} × {lastExport.height} px · {formatBytes(lastExport.bytes)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Scale</dt>
              <dd>{lastExport.scale}x</dd>
            </div>
          </dl>
        ) : null}

        {lastSvg ? (
          <dl
            data-testid="last-svg-export"
            className="text-fg-subtle forge-numeric border-line-subtle text-2xs space-y-0.5 rounded-sm border px-2.5 py-2"
          >
            <div className="flex justify-between gap-2">
              <dt>File</dt>
              <dd className="truncate">{lastSvg.fileName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Size</dt>
              <dd>{formatBytes(lastSvg.bytes)} of SVG text</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Layers left out</dt>
              <dd>{String(lastSvg.omitted)}</dd>
            </div>
          </dl>
        ) : null}

        {lastExport && lastExport.warnings.length > 0 ? (
          <InlineNote
            tone="warning"
            icon={<CircleAlert aria-hidden />}
            title="Rendered with caveats"
          >
            <ul className="list-disc space-y-0.5 pl-4">
              {lastExport.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </InlineNote>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          fullWidth
          onClick={() => {
            void navigator.clipboard
              .writeText(projectFilePayload(api.doc).contents)
              .then(() => {
                toasts.success(
                  'Document definition copied',
                  'Paste it anywhere to inspect the model.',
                );
              })
              .catch(() => {
                toasts.warning(
                  'Copying was blocked',
                  'Your browser refused clipboard access. Use the download instead.',
                );
              });
          }}
        >
          Copy document definition as JSON
        </Button>

        {selected?.status === 'planned' ? (
          <p className="text-2xs text-fg-subtle">
            {selected.label} export is not implemented in this build. PNG, JPEG and the project file
            are the formats it can really produce — the roadmap tracks the rest.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Capability({ label, value }: { readonly label: string; readonly value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={value ? 'text-mint-400' : 'text-fg-subtle'}>{value ? 'yes' : 'no'}</dd>
    </div>
  );
}
