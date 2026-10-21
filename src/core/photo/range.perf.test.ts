/**
 * Range-selection performance: a budget written before the measurement.
 *
 * Range selections run on the CPU even when the adjustment stack runs on the GPU, because they are
 * evaluated from the source pixels once per render. The cost is linear in pixels × ranges, so the
 * acceptance thresholds are stated per range and for a full eight-range mask at the preview cap
 * (1280 × 853). These are catastrophic-regression guards in the same spirit as the pipeline budget,
 * not latency targets: the numbers are printed so a run reports what it actually took.
 *
 * Method:
 *  - a deterministic 1280 × 853 source buffer and a painted map that is half-covered, so the
 *    already-painted early exit is exercised but does not dominate;
 *  - one warm-up pass, then three measured passes per case;
 *  - the median and worst case are asserted separately.
 */

import { describe, expect, it } from 'vitest';

import type { PhotoRangeSelection } from '../documents/payload';
import { applyRangeSelections } from './range';

const WIDTH = 1280;
const HEIGHT = 853;
const PIXELS = WIDTH * HEIGHT;
const SAMPLES = 3;

/** One feathered luminance range over the preview cap. */
const ONE_RANGE_MEDIAN_MS = 150;
const ONE_RANGE_WORST_MS = 400;
/** The document limit: eight ranges of mixed kinds, the worst case a mask can describe. */
const EIGHT_RANGES_MEDIAN_MS = 900;
const EIGHT_RANGES_WORST_MS = 2000;
/** Preparing a range must not happen per pixel: eight ranges may not cost twenty times one. */
const SCALING_RATIO = 20;

function source(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(PIXELS * 4);
  for (let index = 0; index < data.length; index += 4) {
    const pixel = index / 4;
    const x = pixel % WIDTH;
    const y = Math.floor(pixel / WIDTH);
    data[index] = (x * 7 + y * 3) % 256;
    data[index + 1] = (x * 3 + y * 11) % 256;
    data[index + 2] = (x ^ y) % 256;
    data[index + 3] = 255;
  }
  return data;
}

function painted(): Uint8ClampedArray {
  const map = new Uint8ClampedArray(PIXELS);
  for (let index = 0; index < map.length; index += 1) {
    map[index] = index % WIDTH < WIDTH / 2 ? 255 : 0;
  }
  return map;
}

const LUMINANCE: PhotoRangeSelection = {
  id: 'range-1',
  kind: 'luminance',
  min: 0.2,
  max: 0.7,
  feather: 0.3,
};

const EIGHT: readonly PhotoRangeSelection[] = [
  LUMINANCE,
  { id: 'range-2', kind: 'colour', colour: '#336699', tolerance: 0.2, feather: 0.2 },
  { id: 'range-3', kind: 'colour', colour: '#aa44ff', tolerance: 0.1, feather: 0.1 },
  { id: 'range-4', kind: 'luminance', min: 0.6, max: 0.9, feather: 0.2 },
  { id: 'range-5', kind: 'colour', colour: '#00ff88', tolerance: 0.3, feather: 0 },
  { id: 'range-6', kind: 'luminance', min: 0, max: 0.1, feather: 0 },
  { id: 'range-7', kind: 'colour', colour: '#ff0000', tolerance: 0.05, feather: 0.5 },
  { id: 'range-8', kind: 'luminance', min: 0.4, max: 0.6, feather: 0.4 },
];

function measure(ranges: readonly PhotoRangeSelection[]): number[] {
  const pixels = source();
  const map = painted();
  const durations: number[] = [];
  for (let run = 0; run < SAMPLES + 1; run += 1) {
    const started = performance.now();
    applyRangeSelections(map, ranges, pixels, WIDTH, HEIGHT);
    const elapsed = performance.now() - started;
    if (run > 0) durations.push(elapsed); // run 0 is the warm-up
  }
  return durations;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted[middle] ?? 0;
}

describe('range selection performance', () => {
  it(
    'evaluates one range over the preview cap inside the documented budget',
    { timeout: 120_000 },
    () => {
      const durations = measure([LUMINANCE]);
      const p50 = median(durations);
      const worst = Math.max(...durations);
      console.log(
        `range selection: ${PIXELS.toLocaleString()} px, 1 range — median ${p50.toFixed(0)} ms, worst ${worst.toFixed(0)} ms over ${String(SAMPLES)} runs`,
      );
      expect(p50).toBeLessThanOrEqual(ONE_RANGE_MEDIAN_MS);
      expect(worst).toBeLessThanOrEqual(ONE_RANGE_WORST_MS);
    },
  );

  it(
    'evaluates the eight-range limit inside the documented budget and scales sub-quadratically',
    { timeout: 120_000 },
    () => {
      const single = median(measure([LUMINANCE]));
      const eight = measure(EIGHT);
      const p50 = median(eight);
      const worst = Math.max(...eight);
      console.log(
        `range selection: 8 ranges — median ${p50.toFixed(0)} ms, worst ${worst.toFixed(0)} ms, 1 range median ${single.toFixed(0)} ms`,
      );
      expect(p50).toBeLessThanOrEqual(EIGHT_RANGES_MEDIAN_MS);
      expect(worst).toBeLessThanOrEqual(EIGHT_RANGES_WORST_MS);
      expect(p50).toBeLessThan(single * SCALING_RATIO);
    },
  );
});
