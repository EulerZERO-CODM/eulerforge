/**
 * Canvas zoom semantics.
 *
 * The workspace stage renders a document's *specification* (background, safe area, bleed, grid,
 * centre lines), so "zoom" is a statement about geometry: an explicit percentage maps document
 * pixels to CSS pixels at that ratio, and `fit` scales the document down until it fits the space the
 * stage was given.
 *
 * Keeping the arithmetic here — framework-free and viewport-independent — is what makes the
 * behaviour testable and stops the layout from quietly capping a zoom level that the control offers.
 *
 * Honest limit: a percentage maps document pixels to *CSS* pixels. On a display with a device pixel
 * ratio above 1, one CSS pixel is drawn with more than one device pixel, so 100% is a 1:1 mapping in
 * CSS-pixel terms and only pixel-identical on standard-density displays. The workspace says this.
 */

export const ZOOM_PERCENT_LEVELS = [25, 50, 100, 200] as const;

export type ZoomPercentLevel = (typeof ZOOM_PERCENT_LEVELS)[number];

export type ZoomSetting = 'fit' | ZoomPercentLevel;

/** Fit never magnifies: a document is shown at 100% at most, so 100% keeps a single meaning. */
export const MAX_FIT_SCALE = 1;

/** Floor for `fit`, so an unusable viewport measurement still produces a visible box. */
export const MIN_FIT_PERCENT = 2;

export type CanvasSize = { readonly width: number; readonly height: number };

/** Space available to the canvas, already reduced by the stage's own padding. */
export type ViewportBox = { readonly width: number; readonly height: number };

export type ZoomScale = {
  /** The requested setting, echoed so the interface can label the control. */
  readonly setting: ZoomSetting;
  /** Effective scale factor; 1 means one document pixel per CSS pixel. */
  readonly scale: number;
  /** Effective percentage, rounded for display. */
  readonly percent: number;
  /** Exact CSS-pixel box the canvas occupies. */
  readonly width: number;
  readonly height: number;
  /** True when the box is larger than the viewport, so the stage must scroll to reach it all. */
  readonly clipped: boolean;
  /**
   * True when the viewport could not be measured (zero width or height), so `fit` fell back to the
   * document's declared size instead of guessing.
   */
  readonly unmeasured: boolean;
};

function clampPercent(percent: number): number {
  return Math.min(100, Math.max(MIN_FIT_PERCENT, percent));
}

function isUsable(viewport: ViewportBox): boolean {
  return viewport.width > 0 && viewport.height > 0;
}

/**
 * Resolves a zoom setting into an exact pixel box.
 *
 * - An explicit percentage scales the document's declared pixel dimensions; portrait and landscape
 *   documents are treated identically, so a vertical canvas is never capped to fit a horizontal
 *   container.
 * - `fit` uses the smaller of the two axis ratios and never exceeds 100%.
 * - An unmeasurable viewport (server render, or the first frame in a browser before measurement)
 *   resolves to the declared size rather than to a guess.
 */
export function computeZoom(
  canvas: CanvasSize,
  setting: ZoomSetting,
  viewport: ViewportBox,
): ZoomScale {
  const measured = isUsable(viewport);

  if (setting === 'fit') {
    if (!measured) {
      // Nothing to fit against yet: show the document at its declared size, and let the caller say
      // that the viewport has not been measured rather than implying a computed fit.
      return {
        setting,
        scale: 1,
        percent: 100,
        width: canvas.width,
        height: canvas.height,
        clipped: false,
        unmeasured: true,
      };
    }

    const ratio = Math.min(
      viewport.width / canvas.width,
      viewport.height / canvas.height,
      MAX_FIT_SCALE,
    );
    return finalise(canvas, setting, clampPercent(ratio * 100), viewport, false);
  }

  return finalise(canvas, setting, setting, viewport, !measured);
}

function finalise(
  canvas: CanvasSize,
  setting: ZoomSetting,
  percent: number,
  viewport: ViewportBox,
  unmeasured: boolean,
): ZoomScale {
  const scale = percent / 100;
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));

  return {
    setting,
    scale,
    percent: Math.round(percent),
    width,
    height,
    clipped: isUsable(viewport) ? width > viewport.width || height > viewport.height : false,
    unmeasured,
  };
}

/**
 * Next/previous level for the zoom-in / zoom-out buttons.
 *
 * Stepping from `fit` uses the *effective* percentage, so zooming out of a 42% fit lands on 25% and
 * zooming in lands on 50% — the control never jumps somewhere unrelated to what is on screen.
 */
export function stepZoom(
  setting: ZoomSetting,
  direction: 1 | -1,
  effectivePercent: number,
): ZoomSetting {
  if (setting !== 'fit') {
    const index = ZOOM_PERCENT_LEVELS.indexOf(setting);
    const next =
      ZOOM_PERCENT_LEVELS[Math.min(ZOOM_PERCENT_LEVELS.length - 1, Math.max(0, index + direction))];
    return next ?? setting;
  }

  if (direction === 1) {
    return ZOOM_PERCENT_LEVELS.find((level) => level > effectivePercent) ?? 200;
  }

  const below = ZOOM_PERCENT_LEVELS.filter((level) => level < effectivePercent);
  return below[below.length - 1] ?? 25;
}

/** Narrows an arbitrary `select` value to a zoom setting the stage understands. */
export function parseZoomSetting(value: string): ZoomSetting {
  if (value === 'fit') return 'fit';
  const parsed = Number(value);
  const match = ZOOM_PERCENT_LEVELS.find((level) => level === parsed);
  return match ?? 'fit';
}
