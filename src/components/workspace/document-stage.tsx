'use client';

import { Grid2X2, Maximize2, Ruler, ZoomIn, ZoomOut } from 'lucide-react';
import { useState } from 'react';

import type { ForgeDocument } from '../../core/documents/types';
import { aspectRatioLabel, megapixelLabel, orientationOf } from '../../core/documents/geometry';
import { formatLength } from '../../core/documents/units';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { DocumentPreview } from '../documents/document-preview';

const ZOOM_LEVELS = [25, 50, 100, 200] as const;
type ZoomLevel = 'fit' | (typeof ZOOM_LEVELS)[number];

/**
 * Document stage.
 *
 * The workspace's main surface. Because no layer tools exist yet, this renders the document's real
 * geometry — background, safe area, bleed, centre lines, grid — at a controllable zoom, and it says
 * plainly that direct manipulation is not part of this build.
 */
export function DocumentStage({ doc }: { readonly doc: ForgeDocument }) {
  const [showGuides, setShowGuides] = useState(true);
  const [zoom, setZoom] = useState<ZoomLevel>('fit');

  const { canvas, guides } = doc;
  // `fit` lets the preview fill the available width; an explicit level renders at true pixel size,
  // which is what "100%" has to mean in a document tool.
  const stageWidth =
    zoom === 'fit' ? undefined : `${String(Math.round((canvas.width * zoom) / 100))}px`;

  return (
    <section
      aria-label="Document stage"
      className="border-line bg-surface-raised/50 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border"
    >
      <div className="border-line-subtle flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <IconButton
            label={showGuides ? 'Hide guides' : 'Show guides'}
            size="sm"
            onClick={() => {
              setShowGuides((previous) => !previous);
            }}
            aria-pressed={showGuides}
            variant="quiet"
          >
            {guides.showGrid ? <Grid2X2 aria-hidden /> : <Ruler aria-hidden />}
          </IconButton>
          <span className="text-2xs text-fg-subtle">
            {showGuides ? 'Guides visible' : 'Guides hidden'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <IconButton
            label="Zoom out"
            size="sm"
            onClick={() => {
              setZoom(previousZoom(zoom, -1));
            }}
          >
            <ZoomOut aria-hidden />
          </IconButton>
          <select
            aria-label="Zoom level"
            value={String(zoom)}
            onChange={(event) => {
              const next = event.target.value;
              setZoom(next === 'fit' ? 'fit' : (Number(next) as (typeof ZOOM_LEVELS)[number]));
            }}
            className="forge-numeric border-line bg-ink-950 text-2xs text-fg-muted h-7 cursor-pointer rounded-sm border px-1.5"
          >
            <option value="fit">Fit</option>
            {ZOOM_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}%
              </option>
            ))}
          </select>
          <IconButton
            label="Zoom in"
            size="sm"
            onClick={() => {
              setZoom(previousZoom(zoom, 1));
            }}
          >
            <ZoomIn aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="forge-scroll flex min-h-[22rem] flex-1 items-center justify-center overflow-auto p-4">
        <div
          className="flex w-full justify-center"
          style={stageWidth ? { width: stageWidth } : undefined}
        >
          <DocumentPreview
            canvas={canvas}
            guides={guides}
            showGuides={showGuides}
            className="w-full max-w-3xl"
          />
        </div>
      </div>

      <dl className="border-line-subtle text-2xs grid grid-cols-2 gap-x-4 gap-y-1.5 border-t px-3 py-2.5 sm:grid-cols-4">
        <Spec label="Canvas" value={`${String(canvas.width)} × ${String(canvas.height)} px`} />
        <Spec label="Ratio" value={`${aspectRatioLabel(canvas)} · ${orientationOf(canvas)}`} />
        <Spec label="Density" value={megapixelLabel(canvas)} />
        <Spec
          label="Physical"
          value={
            canvas.unit === 'px'
              ? `screen (${String(canvas.dpi)} dpi ref)`
              : formatLength(canvas.width, canvas.unit, canvas.dpi)
          }
        />
      </dl>

      <div className="border-line-subtle flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
        <p className="text-2xs text-fg-subtle">
          Direct manipulation — selection, text, shapes, images — is{' '}
          <strong className="text-fg-muted font-medium">not</strong> implemented in this build. What
          you can change today is the document itself.
        </p>
        <Button
          variant="link"
          size="sm"
          className="text-2xs"
          onClick={() => {
            globalThis.document
              .getElementById('contextual-help')
              ?.scrollIntoView({ block: 'start' });
          }}
          iconLeft={<Maximize2 aria-hidden />}
        >
          Explain these settings
        </Button>
      </div>
    </section>
  );
}

function Spec({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-subtle uppercase">{label}</dt>
      <dd className={cn('forge-numeric text-fg-muted truncate')}>{value}</dd>
    </div>
  );
}

function previousZoom(current: ZoomLevel, direction: 1 | -1): ZoomLevel {
  if (current === 'fit') return direction === 1 ? 50 : 25;
  const index = ZOOM_LEVELS.indexOf(current);
  const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + direction))];
  return next ?? 'fit';
}
