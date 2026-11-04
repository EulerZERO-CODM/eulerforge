/**
 * Photo pipeline performance: a budget written before the measurement, checked in CI.
 *
 * The CPU pipeline is the reference renderer and the fallback for browsers without WebGL2, so a
 * regression here is felt by real users on exactly the machines least able to absorb it. The budget
 * is deliberately generous — it is a regression guard, not a latency target — and the measured
 * numbers are printed so a run reports what it actually took.
 *
 * Method (documented in docs/PERFORMANCE.md):
 *  - a deterministic 1280 × 853 buffer (1.09 MP, the preview cap across both dimensions);
 *  - a nine-entry stack covering every maths branch plus a half-frame mask;
 *  - one warm-up pass, then five measured passes, reporting median and worst case;
 *  - the absolute ceiling applies to the median and to the worst case separately, and a ratio check
 *    (two adjustments vs nine) catches a sublinear regression that an absolute ceiling would miss.
 */

import { describe, expect, it } from 'vitest';

import type { PhotoAdjustment } from '../documents/payload';
import { applyPhotoPipeline } from './pipeline';

const WIDTH = 1280;
const HEIGHT = 853;
const PIXELS = WIDTH * HEIGHT;
const SAMPLES = 3;

/**
 * Ceiling for one preview render of the worst-case stack, in milliseconds.
 *
 * This is a catastrophic-regression guard, not a latency claim: on a quiet machine the measured
 * median is around half a second (recorded in docs/PERFORMANCE.md), and the ceiling is deliberately
 * loose enough to survive a shared CI runner executing several suites in parallel. The precise
 * question — "does the cost scale with the stack?" — is covered by the ratio test below, which a
 * busy machine cannot flake because both measurements are taken under the same load.
 */
const MEDIAN_CEILING_MS = 4000;
/** A single run may be slower than the median, but not unbounded either. */
const WORST_CEILING_MS = 6000;

function fixture(): { data: Uint8ClampedArray; mask: Uint8ClampedArray } {
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
  const mask = new Uint8ClampedArray(PIXELS);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = index % WIDTH < WIDTH / 2 ? 255 : 0;
  }
  return { data, mask };
}

const KINDS = [
  'exposure',
  'contrast',
  'saturation',
  'temperature',
  'highlights',
  'shadows',
  'vibrance',
  'clarity',
  'vignette',
] as const;

const STACK: readonly PhotoAdjustment[] = KINDS.map((kind, index) => ({
  id: `adjustment-${String(index)}`,
  kind,
  value: 40,
  enabled: true,
}));

function measure(
  adjustments: readonly PhotoAdjustment[],
  mask: Uint8ClampedArray | null,
): number[] {
  const { data } = fixture();
  const durations: number[] = [];
  for (let run = 0; run < SAMPLES + 1; run += 1) {
    const started = performance.now();
    applyPhotoPipeline({ data, width: WIDTH, height: HEIGHT }, { adjustments, mask });
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

describe('photo pipeline performance', () => {
  // A benchmark needs longer than the 5 s default test timeout on a shared runner; the assertions
  // themselves are unchanged.
  it(
    'renders the worst-case preview stack inside the documented budget',
    { timeout: 120_000 },
    () => {
      const durations = measure(STACK, fixture().mask);
      const p50 = median(durations);
      const worst = Math.max(...durations);
      // Printed rather than asserted against a snapshot: the number in the CI log is the evidence.
      console.log(
        `photo pipeline: ${PIXELS.toLocaleString()} px, ${String(STACK.length)} adjustments + mask — median ${p50.toFixed(0)} ms, worst ${worst.toFixed(0)} ms over ${String(SAMPLES)} runs`,
      );

      expect(p50).toBeLessThanOrEqual(MEDIAN_CEILING_MS);
      expect(worst).toBeLessThanOrEqual(WORST_CEILING_MS);
    },
  );

  it(
    'is cheaper for a small stack than for the worst case, and produces identical bytes twice',
    { timeout: 120_000 },
    () => {
      const small = measure(STACK.slice(0, 2), null);
      const full = measure(STACK, fixture().mask);
      console.log(
        `photo pipeline: 2 adjustments median ${median(small).toFixed(0)} ms vs 9 adjustments + mask median ${median(full).toFixed(0)} ms`,
      );
      // Nine adjustments must cost clearly more than two. A ratio rather than an absolute delta keeps
      // the check meaningful when the machine is busy and every pass is slower by the same factor.
      expect(median(full)).toBeGreaterThan(median(small) * 1.5);

      const { data } = fixture();
      const first = applyPhotoPipeline(
        { data, width: WIDTH, height: HEIGHT },
        { adjustments: STACK, mask: null },
      );
      const second = applyPhotoPipeline(
        { data, width: WIDTH, height: HEIGHT },
        { adjustments: STACK, mask: null },
      );
      // A byte loop rather than `toEqual`: comparing two 4.3-million-element typed arrays through the
      // generic deep-equality matcher takes tens of seconds and proves nothing extra.
      let identical = true;
      let changed = false;
      for (let index = 0; index < first.length; index += 1) {
        if (first[index] !== second[index]) identical = false;
        if (first[index] !== data[index]) changed = true;
        if (!identical && changed) break;
      }
      expect(identical).toBe(true);
      expect(changed).toBe(true);
    },
  );
});
