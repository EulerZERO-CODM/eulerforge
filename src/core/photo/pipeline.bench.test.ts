/**
 * A reproducible measurement of the CPU reference pipeline.
 *
 * It is **not** part of the normal suite: the 12 MP case allocates tens of megabytes and takes
 * seconds, so running it on every push would slow the gate without proving anything a unit test
 * cannot. It is skipped unless `FORGE_BENCH=1`, and `docs/PERFORMANCE.md` records how to run it, the
 * environment its numbers came from, and the fact that it measures the Canvas 2D reference rather
 * than the WebGL2 path a GPU user gets.
 *
 * The point is to answer one question with a number instead of an adjective: can the fallback render
 * a 12 MP photograph within the roadmap's 16 ms interaction budget? (It cannot; that is why previews
 * are capped at 1280 px and the answer is written down.)
 */

import { describe, expect, it } from 'vitest';

import { applyPhotoPipeline } from './pipeline';
import type { PhotoAdjustment } from '../documents/payload';

const enabled = process.env.FORGE_BENCH === '1';

function adjustment(kind: string, value: number): PhotoAdjustment {
  return {
    id: `bench-${kind}`,
    kind,
    value,
    enabled: true,
    bypassed: false,
  } as unknown as PhotoAdjustment;
}

function image(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = (index * 7) % 256;
    data[index + 1] = (index * 13) % 256;
    data[index + 2] = (index * 31) % 256;
    data[index + 3] = 255;
  }
  return data;
}

function measure(
  width: number,
  height: number,
  adjustments: readonly PhotoAdjustment[],
): { readonly median: number; readonly best: number; readonly worst: number } {
  const data = image(width, height);
  const pixels = { data, width, height };
  // One unrecorded pass: the first run pays for JIT compilation and a cold allocation.
  applyPhotoPipeline(pixels, { adjustments });
  const samples: number[] = [];
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    applyPhotoPipeline(pixels, { adjustments });
    samples.push(performance.now() - started);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    best: sorted[0] ?? 0,
    worst: sorted[sorted.length - 1] ?? 0,
  };
}

describe.skipIf(!enabled)('photo pipeline at 12 MP (CPU reference)', () => {
  it('measures the stack and reports it', () => {
    const stacks = {
      'one adjustment': [adjustment('exposure', 12)],
      'four adjustments': [
        adjustment('exposure', 12),
        adjustment('contrast', 15),
        adjustment('saturation', 10),
        adjustment('warmth', 8),
      ],
      'twelve adjustments': [
        adjustment('exposure', 12),
        adjustment('contrast', 15),
        adjustment('saturation', 10),
        adjustment('warmth', 8),
        adjustment('tint', 5),
        adjustment('highlights', -10),
        adjustment('shadows', 10),
        adjustment('whites', 4),
        adjustment('blacks', -4),
        adjustment('clarity', 6),
        adjustment('vibrance', 8),
        adjustment('sharpness', 5),
      ],
    } as const;

    const rows: string[] = [];
    for (const [label, stack] of Object.entries(stacks)) {
      const full = measure(4000, 3000, stack);
      const preview = measure(1280, 853, stack);
      rows.push(
        `${label}: 12 MP median ${full.median.toFixed(0)} ms (best ${full.best.toFixed(0)}, worst ${full.worst.toFixed(0)}); ` +
          `1280 px preview median ${preview.median.toFixed(0)} ms (best ${preview.best.toFixed(0)}, worst ${preview.worst.toFixed(0)})`,
      );
    }
    // The output is the artefact; this always passes so a machine-specific number cannot fail CI.
    console.log(`PHOTO BENCH (CPU reference)\n${rows.join('\n')}`);
    expect(rows).toHaveLength(3);
  }, 120_000);
});
