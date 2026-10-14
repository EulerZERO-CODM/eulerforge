/**
 * Pixel and geometry analysis for the browser suite.
 *
 * Two kinds of evidence live here, and both are deliberately measured from what the browser really
 * painted rather than from the values the application says it used:
 *
 * 1. `readInkBands` reads the artboard's own canvas — the same buffer the user is looking at — and
 *    reports where the ink is, in document pixels. Text wrapping is then asserted on the rows the
 *    browser drew, not on the layout function's return value.
 * 2. `strongestVerticalLine` looks for a drawn line in a screenshot of the artboard, so "the guide
 *    is on the right pixel" is a statement about pixels rather than about a CSS property.
 *
 * Everything converts with the scale the canvas itself reports (`canvas.width / document width`), so
 * neither device pixel ratio nor the viewport offset can influence a result.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Page } from '@playwright/test';

export type DocumentRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** One run of painted pixels, in document pixels. */
export type InkBand = {
  readonly top: number;
  readonly bottom: number;
  readonly centre: number;
  readonly left: number;
  readonly right: number;
};

export type InkReading = {
  readonly bands: readonly InkBand[];
  /** Device pixels per document pixel in the canvas that was read. */
  readonly scale: number;
  /** The canvas background the analysis treated as "nothing here", as `[r, g, b]`. */
  readonly background: readonly number[];
  /** Rows that held ink, for a readable failure message. */
  readonly inkRows: number;
};

/** How far a pixel must differ from the background before it counts as ink, summed over RGB. */
const INK_TOLERANCE = 24;

/**
 * Rows of ink in a region of the artboard, as document-space bands.
 *
 * A band is a run of rows containing ink, with runs closer than a couple of device rows joined: a
 * glyph row can be antialiased into a thin gap, and no text line is one device pixel tall.
 */
export async function readInkBands(page: Page, region: DocumentRect): Promise<InkReading> {
  return page.evaluate(
    ({ region, inkTolerance, maxGap }) => {
      const artboard = document.querySelector('[data-testid="artboard"]');
      const canvas = document.querySelector('[data-testid="document-canvas"]');
      if (!(artboard instanceof HTMLElement)) throw new Error('the artboard is not on the page');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('the canvas is not on the page');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('the document canvas has no 2d context');

      const documentWidth = Number(artboard.dataset.canvasWidth);
      if (!Number.isFinite(documentWidth) || documentWidth <= 0) {
        throw new Error('the artboard does not report its document width');
      }
      // The canvas is painted at `zoom * devicePixelRatio`, and its own width is the truth about how
      // many device pixels one document pixel occupies - whatever the display is doing.
      const scale = canvas.width / documentWidth;

      const corner = context.getImageData(1, 1, 1, 1).data;
      const background: number[] = [corner[0] ?? 0, corner[1] ?? 0, corner[2] ?? 0];

      const x0 = Math.max(0, Math.floor(region.x * scale));
      const y0 = Math.max(0, Math.floor(region.y * scale));
      const x1 = Math.min(canvas.width, Math.ceil((region.x + region.width) * scale));
      const y1 = Math.min(canvas.height, Math.ceil((region.y + region.height) * scale));
      const width = x1 - x0;
      const height = y1 - y0;
      if (width <= 0 || height <= 0) throw new Error('the requested region is empty');

      const pixels = context.getImageData(x0, y0, width, height).data;
      const isInk = (index: number): boolean =>
        Math.abs((pixels[index] ?? 0) - (background[0] ?? 0)) +
          Math.abs((pixels[index + 1] ?? 0) - (background[1] ?? 0)) +
          Math.abs((pixels[index + 2] ?? 0) - (background[2] ?? 0)) >
        inkTolerance;

      type Row = { readonly count: number; readonly left: number; readonly right: number };
      const rows: Row[] = [];
      for (let row = 0; row < height; row += 1) {
        let count = 0;
        let left = -1;
        let right = -1;
        for (let column = 0; column < width; column += 1) {
          if (!isInk((row * width + column) * 4)) continue;
          count += 1;
          if (left === -1) left = column;
          right = column;
        }
        rows.push({ count, left, right });
      }

      type Run = { first: number; last: number; left: number; right: number };
      const runs: Run[] = [];
      let gap = 0;
      for (let row = 0; row < rows.length; row += 1) {
        const current = rows[row];
        if (!current || current.count === 0) {
          gap += 1;
          continue;
        }
        const open = runs[runs.length - 1];
        // A run stays open across a gap of a couple of device rows; anything longer is a new line.
        if (open && gap <= maxGap) {
          open.last = row;
          open.left = Math.min(open.left, current.left);
          open.right = Math.max(open.right, current.right);
        } else {
          runs.push({
            first: row,
            last: row,
            left: current.left === -1 ? 0 : current.left,
            right: current.right,
          });
        }
        gap = 0;
      }

      const bands = runs.map((run) => {
        const top = (y0 + run.first) / scale;
        const bottom = (y0 + run.last + 1) / scale;
        return {
          top,
          bottom,
          centre: (top + bottom) / 2,
          left: (x0 + run.left) / scale,
          right: (x0 + run.right + 1) / scale,
        };
      });

      return {
        bands,
        scale,
        background,
        inkRows: rows.filter((row) => row.count > 0).length,
      };
    },
    { region, inkTolerance: INK_TOLERANCE, maxGap: 2 },
  );
}

export type LineHit = {
  /** Column the strongest vertical line sits in, in image pixels from the left of the image. */
  readonly column: number;
  /** How much that column differs from the columns four pixels to either side. */
  readonly contrast: number;
};

/**
 * The strongest vertical line in a screenshot, searched within a column window.
 *
 * "Strongest" means the biggest summed RGB difference between the column's average colour and the
 * average colours four pixels to its left and right, so a one-pixel line wins over a flat background
 * and a soft gradient does not. The line's own colour is irrelevant: what is measured is that
 * *something* is drawn exactly there.
 */
export async function strongestVerticalLine(
  image: Buffer,
  options: {
    readonly minColumn: number;
    readonly maxColumn: number;
    readonly fromRow: number;
    readonly toRow: number;
  },
): Promise<LineHit> {
  const decoded = await loadImage(image);
  const canvas = createCanvas(decoded.width, decoded.height);
  const context = canvas.getContext('2d');
  context.drawImage(decoded, 0, 0);
  const { data } = context.getImageData(0, 0, decoded.width, decoded.height);

  const columnMean = (column: number): readonly number[] => {
    const total = [0, 0, 0];
    let rows = 0;
    for (let row = options.fromRow; row < options.toRow; row += 1) {
      const index = (row * decoded.width + column) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        total[channel] = (total[channel] ?? 0) + (data[index + channel] ?? 0);
      }
      rows += 1;
    }
    return total.map((value) => value / Math.max(1, rows));
  };

  const min = Math.max(4, options.minColumn);
  const max = Math.min(decoded.width - 5, options.maxColumn);
  let best: LineHit = { column: min, contrast: -1 };
  for (let column = min; column <= max; column += 1) {
    const here = columnMean(column);
    const left = columnMean(column - 4);
    const right = columnMean(column + 4);
    let contrast = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      contrast += Math.abs((here[channel] ?? 0) - (left[channel] ?? 0));
      contrast += Math.abs((here[channel] ?? 0) - (right[channel] ?? 0));
    }
    if (contrast > best.contrast) best = { column, contrast };
  }
  return best;
}

/** Image size of a decoded PNG, so a spec can check it captured what it meant to. */
export async function imageSize(image: Buffer): Promise<{ width: number; height: number }> {
  const decoded = await loadImage(image);
  return { width: decoded.width, height: decoded.height };
}
