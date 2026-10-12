'use client';

import { Grid2X2, Maximize2, Ruler, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ForgeDocument } from '../../core/documents/types';
import { aspectRatioLabel, megapixelLabel, orientationOf } from '../../core/documents/geometry';
import { formatLength } from '../../core/documents/units';
import {
  ZOOM_PERCENT_LEVELS,
  computeZoom,
  parseZoomSetting,
  stepZoom,
  type ViewportBox,
  type ZoomSetting,
} from '../../core/documents/zoom';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { DocumentPreview } from '../documents/document-preview';

/** Padding around the canvas inside the scroll area, in pixels (`p-4`); measured space excludes it. */
const STAGE_PADDING_PX = 16 * 2;
/** Smallest sensible scroll area; below this the stage still renders rather than collapsing. */
const MIN_STAGE_HEIGHT_PX = 22 * 16;

/**
 * Document stage.
 *
 * The workspace's main surface. Because no layer tools exist yet, this renders the document's real
 * geometry — background, safe area, bleed, centre lines, grid — at a controllable zoom, and it says
 * plainly that direct manipulation is not part of this build.
 *
 * Zoom is geometry, not styling: `fit` measures the scroll area and scales the document down to it,
 * and an explicit percentage renders the document at exactly that multiple of its declared pixel
 * size. Nothing caps the canvas — at 200% the box is genuinely 200% wide and the stage scrolls, which
 * is the only honest way to offer a zoom level the viewport cannot hold (ADR-0015).
 */
export function DocumentStage({ doc }: { readonly doc: ForgeDocument }) {
  const [showGuides, setShowGuides] = useState(true);
  const [zoom, setZoom] = useState<ZoomSetting>('fit');
  const [viewport, setViewport] = useState<ViewportBox>({ width: 0, height: 0 });
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const { canvas, guides } = doc;

  // Measure the scroll area so `fit` has something real to fit against, and keep it current when the
  // window, the sidebar or the pane divider changes size.
  useEffect(() => {
    const element = scrollAreaRef.current;
    if (!element) return;

    const measure = () => {
      setViewport({
        width: Math.max(0, element.clientWidth - STAGE_PADDING_PX),
        height: Math.max(0, element.clientHeight - STAGE_PADDING_PX),
      });
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => {
        window.removeEventListener('resize', measure);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const scale = computeZoom(canvas, zoom, viewport);
  const unmeasured = scale.setting === 'fit' && scale.unmeasured;

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
              setZoom(stepZoom(zoom, -1, scale.percent));
            }}
          >
            <ZoomOut aria-hidden />
          </IconButton>
          <select
            aria-label="Zoom level"
            value={String(zoom)}
            title="Percentages map document pixels to CSS pixels. On a high-density display one CSS pixel is drawn with more than one device pixel."
            onChange={(event) => {
              setZoom(parseZoomSetting(event.target.value));
            }}
            className="forge-numeric border-line bg-ink-950 text-2xs text-fg-muted h-7 cursor-pointer rounded-sm border px-1.5"
          >
            <option value="fit">Fit</option>
            {ZOOM_PERCENT_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}%
              </option>
            ))}
          </select>
          <span
            data-testid="zoom-readout"
            className="forge-numeric text-2xs text-fg-muted w-[5.5rem] text-right"
          >
            {unmeasured
              ? 'declared size'
              : `${scale.setting === 'fit' ? 'Fit · ' : ''}${String(scale.percent)}%`}
          </span>
          <IconButton
            label="Zoom in"
            size="sm"
            onClick={() => {
              setZoom(stepZoom(zoom, 1, scale.percent));
            }}
          >
            <ZoomIn aria-hidden />
          </IconButton>
        </div>
      </div>

      {/*
        `m-auto` centres the canvas when it fits and still leaves both edges reachable by scrolling
        when it does not — `justify-center` on a scroll container would clip the leading edge.
      */}
      <div
        ref={scrollAreaRef}
        data-testid="stage-scroll-area"
        className="forge-scroll flex flex-1 overflow-auto p-4"
        style={{ minHeight: `${String(MIN_STAGE_HEIGHT_PX)}px` }}
      >
        <DocumentPreview
          canvas={canvas}
          guides={guides}
          showGuides={showGuides}
          sizing={{ kind: 'absolute', width: scale.width, height: scale.height }}
          className="m-auto"
          showCaption={false}
        />
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
          {scale.clipped ? (
            <span data-testid="zoom-clipped-note">
              The canvas is larger than this pane — scroll to reach it all.{' '}
            </span>
          ) : null}
          <span>
            Zoom maps document pixels to CSS pixels; on a high-density display one CSS pixel is
            drawn with more than one device pixel.
          </span>{' '}
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
