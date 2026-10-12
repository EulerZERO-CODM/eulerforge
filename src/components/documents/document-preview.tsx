import type { Canvas, GuideSettings } from '../../core/documents/types';
import { aspectRatioLabel, orientationOf } from '../../core/documents/geometry';
import { toPixels } from '../../core/documents/units';
import { cn } from '../../lib/cn';

/**
 * How the canvas box is sized.
 *
 * - `fluid` fits the container: the caller decides how wide it may become, and the box keeps the
 *   document's aspect ratio. Used where the preview is an illustration (creation flow, project
 *   cards).
 * - `absolute` renders the canvas at an exact CSS-pixel box. Used by the workspace stage, where the
 *   box *is* the zoom level, so no maximum-width rule may shrink it — the stage scrolls instead.
 */
export type DocumentPreviewSizing =
  | { readonly kind: 'fluid'; readonly maxWidthRem?: number }
  | { readonly kind: 'absolute'; readonly width: number; readonly height: number };

export type DocumentPreviewProps = {
  readonly canvas: Canvas;
  readonly guides: GuideSettings;
  /** Whether guide overlays are drawn. Omitted = draw what the document's guides ask for. */
  readonly showGuides?: boolean;
  readonly className?: string;
  readonly caption?: string;
  readonly sizing?: DocumentPreviewSizing;
  /** Set false where the surrounding UI already states the size (the workspace stage does). */
  readonly showCaption?: boolean;
};

/**
 * Canvas preview.
 *
 * Renders the document's *specification*: aspect ratio, background, safe margin, bleed band, centre
 * lines and grid — at whatever size the container gives it, using percentages so no absolute
 * measurement is needed. This is a real render of the document model, not a picture of an editor:
 * no layers exist yet, and the surrounding UI says so (docs/PRODUCT_VISION.md → honesty rules).
 */
export function DocumentPreview({
  canvas,
  guides,
  showGuides = true,
  className,
  caption,
  sizing,
  showCaption = true,
}: DocumentPreviewProps) {
  const absolute = sizing?.kind === 'absolute' ? sizing : null;
  const safeMarginXPx = toPixels(guides.safeMarginMm, 'mm', canvas.dpi);
  const safeMarginYPx = toPixels(guides.safeMarginMm, 'mm', canvas.dpi);
  const bleedPx = toPixels(guides.bleedMm, 'mm', canvas.dpi);
  const gridPx = toPixels(guides.gridMm, 'mm', canvas.dpi);

  const insetX = percent(safeMarginXPx / canvas.width);
  const insetY = percent(safeMarginYPx / canvas.height);
  const bleedX = percent(bleedPx / canvas.width);
  const bleedY = percent(bleedPx / canvas.height);
  const gridX = percent(gridPx / canvas.width);
  const gridY = percent(gridPx / canvas.height);

  // With an absolute size the canvas *is* the zoom: the box is exactly the requested CSS-pixel size
  // and every surrounding rule must give it room, which is why the frame hugs its content here.
  const frameClassName = absolute
    ? 'bg-ink-1000/80 forge-grid-backdrop relative inline-flex w-max items-center justify-center rounded-sm p-3'
    : 'bg-ink-1000/80 forge-grid-backdrop relative flex items-center justify-center rounded-sm p-3';
  const boxClassName = absolute
    ? cn(
        'relative overflow-hidden rounded-xs border',
        canvas.transparent ? 'border-line-strong' : 'border-line',
      )
    : cn(
        'relative max-h-full max-w-full overflow-hidden rounded-xs border',
        canvas.transparent ? 'border-line-strong' : 'border-line',
      );
  const boxStyle = absolute
    ? {
        width: `${String(absolute.width)}px`,
        height: `${String(absolute.height)}px`,
      }
    : {
        aspectRatio: `${String(canvas.width)} / ${String(canvas.height)}`,
        width:
          sizing?.kind === 'fluid' && sizing.maxWidthRem !== undefined
            ? `min(100%, ${String(sizing.maxWidthRem)}rem)`
            : orientationOf(canvas) === 'portrait'
              ? 'min(100%, 14rem)'
              : '100%',
      };

  return (
    <figure className={cn('min-w-0', absolute && 'w-max', className)}>
      <div className={frameClassName}>
        <div
          data-testid="document-canvas"
          data-canvas-width={canvas.width}
          data-canvas-height={canvas.height}
          className={boxClassName}
          style={{
            ...boxStyle,
            backgroundColor: canvas.transparent ? 'transparent' : canvas.background,
            backgroundImage: canvas.transparent
              ? 'linear-gradient(45deg, oklch(30% 0 0 / 0.5) 25%, transparent 25%, transparent 75%, oklch(30% 0 0 / 0.5) 75%), linear-gradient(45deg, oklch(30% 0 0 / 0.5) 25%, transparent 25%, transparent 75%, oklch(30% 0 0 / 0.5) 75%)'
              : undefined,
            backgroundSize: canvas.transparent ? '12px 12px' : undefined,
            backgroundPosition: canvas.transparent ? '0 0, 6px 6px' : undefined,
          }}
        >
          {showGuides && guides.bleedMm > 0 ? (
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-xs border border-dashed border-rose-400/50"
              style={{
                top: `-${bleedY}%`,
                bottom: `-${bleedY}%`,
                left: `-${bleedX}%`,
                right: `-${bleedX}%`,
              }}
            />
          ) : null}

          {showGuides && guides.showGrid ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{
                backgroundImage: `repeating-linear-gradient(to right, oklch(100% 0 0 / 0.14) 0 1px, transparent 1px ${gridX}%), repeating-linear-gradient(to bottom, oklch(100% 0 0 / 0.14) 0 1px, transparent 1px ${gridY}%)`,
              }}
            />
          ) : null}

          {showGuides ? (
            <span
              aria-hidden
              className="border-arc-400/70 pointer-events-none absolute border border-dashed"
              style={{
                top: `${insetY}%`,
                bottom: `${insetY}%`,
                left: `${insetX}%`,
                right: `${insetX}%`,
              }}
            />
          ) : null}

          {showGuides && guides.showCentreLines ? (
            <>
              <span
                aria-hidden
                className="bg-arc-400/40 pointer-events-none absolute inset-y-0 left-1/2 w-px"
              />
              <span
                aria-hidden
                className="bg-arc-400/40 pointer-events-none absolute inset-x-0 top-1/2 h-px"
              />
            </>
          ) : null}
        </div>
      </div>
      {showCaption ? (
        <figcaption className="text-2xs text-fg-subtle mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="forge-numeric">
            {canvas.width} × {canvas.height} px
          </span>
          <span className="forge-numeric">
            {aspectRatioLabel(canvas)} · {orientationOf(canvas)}
          </span>
          {caption ? <span className="truncate">{caption}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function percent(ratio: number): string {
  return (Math.max(0, Math.min(0.5, ratio)) * 100).toFixed(4);
}
