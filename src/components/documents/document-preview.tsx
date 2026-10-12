import type { Canvas, GuideSettings } from '../../core/documents/types';
import { aspectRatioLabel, orientationOf } from '../../core/documents/geometry';
import { toPixels } from '../../core/documents/units';
import { cn } from '../../lib/cn';

export type DocumentPreviewProps = {
  readonly canvas: Canvas;
  readonly guides: GuideSettings;
  /** Whether guide overlays are drawn. Omitted = draw what the document's guides ask for. */
  readonly showGuides?: boolean;
  readonly className?: string;
  readonly caption?: string;
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
}: DocumentPreviewProps) {
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

  return (
    <figure className={cn('min-w-0', className)}>
      <div className="bg-ink-1000/80 forge-grid-backdrop relative flex items-center justify-center rounded-sm p-3">
        <div
          className={cn(
            'relative max-h-full max-w-full overflow-hidden rounded-xs border',
            canvas.transparent ? 'border-line-strong' : 'border-line',
          )}
          style={{
            aspectRatio: `${String(canvas.width)} / ${String(canvas.height)}`,
            width: orientationOf(canvas) === 'portrait' ? 'min(100%, 14rem)' : '100%',
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
      <figcaption className="text-2xs text-fg-subtle mt-2 flex items-center justify-between gap-2">
        <span className="forge-numeric">
          {canvas.width} × {canvas.height} px
        </span>
        <span className="forge-numeric">
          {aspectRatioLabel(canvas)} · {orientationOf(canvas)}
        </span>
        {caption ? <span className="truncate">{caption}</span> : null}
      </figcaption>
    </figure>
  );
}

function percent(ratio: number): string {
  return (Math.max(0, Math.min(0.5, ratio)) * 100).toFixed(4);
}
