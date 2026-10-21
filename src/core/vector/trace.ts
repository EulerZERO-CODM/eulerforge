/**
 * Image tracing: pixels in, editable paths out.
 *
 * The result is deliberately *geometry*, not an embedded bitmap and not a pile of polygons the
 * editor cannot touch. Each palette colour becomes one path whose contours are the boundaries
 * between that colour and everything else, with holes expressed as inner contours and filled with
 * the even-odd rule. That is what makes a traced image editable node by node in Illustration Studio.
 *
 * The algorithm is deterministic and dependency-free:
 *
 *  1. box-average the image down to a working edge (a 12 MP photo is traced at 512 px, not 12 MP);
 *  2. build a palette with median cut, then assign every pixel to its nearest palette colour;
 *  3. walk the pixel lattice and collect every edge where an inside pixel meets an outside one;
 *  4. chain those edges into closed loops, then simplify each loop with Douglas–Peucker;
 *  5. scale the loops back to source coordinates and emit one path per colour.
 *
 * The boundaries are staircase polygons before simplification, not fitted Bézier curves. That is an
 * honest limitation rather than a hidden one: it keeps the output editable and the arithmetic
 * testable, and the detail setting exposes exactly how much smoothing the caller wants. Transparent
 * pixels are not traced at all, so the layer does not gain an opaque rectangle.
 */

import { err, forgeError, ok, type Result } from '../result';
import { createContour, createNode, createPath, type Contour, type VectorPath } from './types';

export const TRACE_LIMITS = Object.freeze({
  minColours: 1,
  maxColours: 16,
  defaultColours: 6,
  /** The long edge of the working copy the tracer walks. */
  workingEdge: 512,
  maxSourcePixels: 24_000_000,
  /** A single traced layer may not exceed the editor's own per-layer node limit. */
  maxNodesPerRegion: 4_000,
  maxRegions: 32,
});

export type TraceOptions = {
  /** Palette size, 1–16. */
  readonly colours?: number;
  /** 0–100; higher keeps more boundary detail. */
  readonly detail?: number;
  /** Regions smaller than this many source pixels are dropped. */
  readonly minArea?: number;
};

export type TraceRegion = {
  readonly colour: string;
  readonly path: VectorPath;
  /** Area in source pixels, holes subtracted. */
  readonly area: number;
  readonly contours: number;
  readonly nodes: number;
};

export type TraceReport = {
  readonly width: number;
  readonly height: number;
  readonly sampleWidth: number;
  readonly sampleHeight: number;
  readonly palette: readonly string[];
  readonly regions: readonly TraceRegion[];
  readonly nodes: number;
  readonly droppedRegions: number;
  /** Simplification tolerance, in working-copy pixels. */
  readonly tolerance: number;
};

type Rgb = { readonly r: number; readonly g: number; readonly b: number };
type BucketEntry = Rgb & { readonly count: number; readonly key: number };
type Bucket = { readonly entries: readonly BucketEntry[] };

type Point = { readonly x: number; readonly y: number };

type Edge = {
  readonly from: Point;
  readonly to: Point;
  readonly dx: number;
  readonly dy: number;
};

function fail(message: string, detail?: string): Result<never> {
  return err(forgeError('validation-failed', message, { detail, retryable: false }));
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function hexOf(colour: Rgb): string {
  const part = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${part(colour.r)}${part(colour.g)}${part(colour.b)}`;
}

/* -------------------------------------------------------------------------------------------- */
/* Sampling and palette                                                                           */
/* -------------------------------------------------------------------------------------------- */

type Sample = {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
};

function sampleImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  edge: number,
): Sample {
  const scale = Math.min(1, edge / Math.max(width, height));
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));
  if (sw === width && sh === height) return { width, height, pixels };

  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y += 1) {
    const y0 = Math.floor((y * height) / sh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / sh));
    for (let x = 0; x < sw; x += 1) {
      const x0 = Math.floor((x * width) / sw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / sw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const at = (sy * width + sx) * 4;
          r += pixels[at] ?? 0;
          g += pixels[at + 1] ?? 0;
          b += pixels[at + 2] ?? 0;
          a += pixels[at + 3] ?? 0;
          count += 1;
        }
      }
      const target = (y * sw + x) * 4;
      out[target] = Math.round(r / count);
      out[target + 1] = Math.round(g / count);
      out[target + 2] = Math.round(b / count);
      out[target + 3] = Math.round(a / count);
    }
  }
  return { width: sw, height: sh, pixels: out };
}

function histogram(sample: Sample): Map<number, BucketEntry> {
  const counts = new Map<number, number>();
  for (let index = 0; index < sample.width * sample.height; index += 1) {
    const at = index * 4;
    if ((sample.pixels[at + 3] ?? 0) < 128) continue;
    const r = sample.pixels[at] ?? 0;
    const g = sample.pixels[at + 1] ?? 0;
    const b = sample.pixels[at + 2] ?? 0;
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries = new Map<number, BucketEntry>();
  for (const key of [...counts.keys()].sort((a, b) => a - b)) {
    entries.set(key, {
      key,
      r: (key >> 16) & 0xff,
      g: (key >> 8) & 0xff,
      b: key & 0xff,
      count: counts.get(key) ?? 0,
    });
  }
  return entries;
}

function spread(bucket: Bucket): { channel: 'r' | 'g' | 'b'; range: number; score: number } {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  let count = 0;
  for (const entry of bucket.entries) {
    minR = Math.min(minR, entry.r);
    maxR = Math.max(maxR, entry.r);
    minG = Math.min(minG, entry.g);
    maxG = Math.max(maxG, entry.g);
    minB = Math.min(minB, entry.b);
    maxB = Math.max(maxB, entry.b);
    count += entry.count;
  }
  const ranges: readonly (readonly ['r' | 'g' | 'b', number])[] = [
    ['r', maxR - minR],
    ['g', maxG - minG],
    ['b', maxB - minB],
  ];
  let channel: 'r' | 'g' | 'b' = 'r';
  let range = -1;
  for (const [name, value] of ranges) {
    if (value > range) {
      channel = name;
      range = value;
    }
  }
  return { channel, range, score: range * count };
}

function averageColour(entries: readonly BucketEntry[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const entry of entries) {
    r += entry.r * entry.count;
    g += entry.g * entry.count;
    b += entry.b * entry.count;
    count += entry.count;
  }
  const safe = Math.max(1, count);
  return { r: Math.round(r / safe), g: Math.round(g / safe), b: Math.round(b / safe) };
}

/** Median cut: split the widest, busiest bucket until the palette is full. */
function buildPalette(entries: Map<number, BucketEntry>, colours: number): readonly Rgb[] {
  if (entries.size === 0) return [];
  const buckets: Bucket[] = [{ entries: [...entries.values()] }];
  while (buckets.length < colours) {
    let target = -1;
    let best = 0;
    for (const [index, bucket] of buckets.entries()) {
      if (bucket.entries.length < 2) continue;
      const { score } = spread(bucket);
      if (score > best) {
        best = score;
        target = index;
      }
    }
    if (target < 0) break;
    const bucket = buckets[target];
    if (!bucket) break;
    const { channel } = spread(bucket);
    const sorted = [...bucket.entries].sort((a, b) => {
      const delta = a[channel] - b[channel];
      if (delta !== 0) return delta;
      return a.key - b.key;
    });
    const total = sorted.reduce((sum, entry) => sum + entry.count, 0);
    let running = 0;
    let split = 1;
    for (let index = 0; index < sorted.length - 1; index += 1) {
      running += sorted[index]?.count ?? 0;
      split = index + 1;
      if (running * 2 >= total) break;
    }
    const left = sorted.slice(0, split);
    const right = sorted.slice(split);
    if (left.length === 0 || right.length === 0) break;
    buckets.splice(target, 1, { entries: left }, { entries: right });
  }
  return buckets.map((bucket) => averageColour(bucket.entries));
}

/** Assigns each sampled pixel an index into the palette, or -1 for a transparent pixel. */
function assign(sample: Sample, palette: readonly Rgb[]): Int16Array {
  const out = new Int16Array(sample.width * sample.height).fill(-1);
  for (let index = 0; index < sample.width * sample.height; index += 1) {
    const at = index * 4;
    if ((sample.pixels[at + 3] ?? 0) < 128) continue;
    const r = sample.pixels[at] ?? 0;
    const g = sample.pixels[at + 1] ?? 0;
    const b = sample.pixels[at + 2] ?? 0;
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [paletteIndex, colour] of palette.entries()) {
      const dr = r - colour.r;
      const dg = g - colour.g;
      const db = b - colour.b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = paletteIndex;
      }
    }
    out[index] = best;
  }
  return out;
}

/* -------------------------------------------------------------------------------------------- */
/* Boundary walking                                                                               */
/* -------------------------------------------------------------------------------------------- */

function pointKey(x: number, y: number, stride: number): number {
  return y * stride + x;
}

/**
 * Chains lattice edges into closed loops.
 *
 * Every edge is directed so that the filled pixels lie on one side of it, which means following
 * outgoing edges at each lattice point always closes a loop. At a diagonal pinch four edges meet at
 * one point and the pairing is ambiguous; the tie-break is a fixed turn preference, so the same
 * pixels always produce the same loops. Determinism matters more here than elegance: two traces of
 * the same file must be byte-identical for the history and the tests.
 */
function boundaryLoops(
  assignment: Int16Array,
  width: number,
  height: number,
  colour: number,
): Point[][] {
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && assignment[y * width + x] === colour;
  const stride = width + 1;
  const outgoing = new Map<number, Edge[]>();
  const add = (from: Point, to: Point): void => {
    const key = pointKey(from.x, from.y, stride);
    const list = outgoing.get(key);
    const edge: Edge = { from, to, dx: to.x - from.x, dy: to.y - from.y };
    if (list) list.push(edge);
    else outgoing.set(key, [edge]);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add({ x, y }, { x: x + 1, y });
      if (!inside(x + 1, y)) add({ x: x + 1, y }, { x: x + 1, y: y + 1 });
      if (!inside(x, y + 1)) add({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
      if (!inside(x - 1, y)) add({ x, y: y + 1 }, { x, y });
    }
  }

  const used = new Set<Edge>();
  const loops: Point[][] = [];
  const edges = [...outgoing.values()].flat();

  for (const seed of edges) {
    if (used.has(seed)) continue;
    const startKey = pointKey(seed.from.x, seed.from.y, stride);
    const loop: Point[] = [{ ...seed.from }];
    let current = seed;
    let closed = false;
    for (;;) {
      used.add(current);
      loop.push({ ...current.to });
      if (pointKey(current.to.x, current.to.y, stride) === startKey) {
        closed = true;
        break;
      }
      const nextKey = pointKey(current.to.x, current.to.y, stride);
      const candidates = (outgoing.get(nextKey) ?? []).filter((edge) => !used.has(edge));
      if (candidates.length === 0) break;
      const turn = current;
      candidates.sort(
        (a, b) =>
          turn.dx * a.dy - turn.dy * a.dx - (turn.dx * b.dy - turn.dy * b.dx) ||
          b.dx - a.dx ||
          b.dy - a.dy,
      );
      const next = candidates[0];
      if (!next) break;
      current = next;
    }
    // The walk pushes every edge's end, so a closed loop ends with a copy of its first point.
    // Dropping it keeps "one node per lattice point" true, which the node counts and corner
    // detection both rely on.
    if (closed && loop.length >= 5) {
      loop.pop();
      loops.push(loop);
    }
  }
  return loops;
  return loops;
}

function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (!a || !b) continue;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function segmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  let t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / length;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

function simplifyOpen(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [...points];
  let index = -1;
  let distance = tolerance;
  for (let at = 1; at < points.length - 1; at += 1) {
    const point = points[at];
    if (!point) continue;
    const candidate = segmentDistance(point, first, last);
    if (candidate > distance) {
      distance = candidate;
      index = at;
    }
  }
  if (index < 0) return [first, last];
  const head = simplifyOpen(points.slice(0, index + 1), tolerance);
  const tail = simplifyOpen(points.slice(index), tolerance);
  return [...head.slice(0, -1), ...tail];
}

/**
 * A vertex whose direction changes sharply over a wide window is a real corner.
 *
 * Every index within a window of a corner registers the same turn, so candidates are collapsed to
 * the sharpest one in each contiguous group. Without that step a square would report five corners
 * per corner and simplification would keep the whole staircase.
 */
function cornerIndices(points: readonly Point[], window: number): number[] {
  const n = points.length;
  const sharp = new Array<boolean>(n).fill(false);
  const cosine = new Array<number>(n).fill(1);

  for (let index = 0; index < n; index += 1) {
    const before = points[(index - window + n) % n];
    const here = points[index];
    const after = points[(index + window) % n];
    if (!before || !here || !after) continue;
    const ax = here.x - before.x;
    const ay = here.y - before.y;
    const bx = after.x - here.x;
    const by = after.y - here.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) continue;
    // cos < 0.5 is a turn sharper than 60 degrees. The window is deliberately wide so that the
    // 90-degree steps of a pixel staircase average out and only authored corners survive.
    const value = (ax * bx + ay * by) / (la * lb);
    if (value < 0.5) {
      sharp[index] = true;
      cosine[index] = value;
    }
  }

  const first = sharp.indexOf(false);
  if (first < 0) return [];
  const corners: number[] = [];
  let group: { readonly index: number; readonly step: number; readonly value: number }[] = [];

  const flush = (): void => {
    if (group.length === 0) return;
    let sharpest = 2;
    for (const entry of group) sharpest = Math.min(sharpest, entry.value);
    let pick: (typeof group)[number] | undefined;
    let reach = -1;
    for (const entry of group) {
      if (Math.abs(entry.value - sharpest) > 1e-9) continue;
      // All the indices inside a corner's window register the same cosine, so the cosine cannot
      // say *which* lattice point is the corner. The corner is the point that stands furthest
      // from the chord joining the two ends of the window, which is exactly where the two edges
      // meet. Without this, a square's corners land one pixel into an edge and its area is off.
      const before = points[(entry.index - window + n) % n];
      const here = points[entry.index];
      const after = points[(entry.index + window) % n];
      if (!before || !here || !after) continue;
      const deviation = segmentDistance(here, before, after);
      if (deviation > reach) {
        reach = deviation;
        pick = entry;
      }
    }
    if (pick) corners.push(pick.index);
    group = [];
  };

  for (let step = 0; step <= n; step += 1) {
    const index = (first + step) % n;
    if (step < n && sharp[index] === true) {
      group = [...group, { index, step, value: cosine[index] ?? 1 }];
    } else {
      flush();
    }
  }

  return corners.sort((a, b) => a - b);
}

/**
 * Simplifies a closed loop.
 *
 * Douglas–Peucker alone is not enough here: started at an arbitrary mid-edge point it can shave a
 * rectangle's corner when the corner happens to sit within the tolerance of the chord, turning a
 * square into a skewed quadrilateral. Corners are therefore detected first, with a wide window so
 * that pixel staircases do not read as corners, and each run *between* corners is simplified on its
 * own. A traced rectangle comes back as exactly four nodes.
 */
function simplifyLoop(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 4) return [...points];
  const window = Math.max(2, Math.min(6, Math.floor(n / 8)));
  const corners = n >= 16 ? cornerIndices(points, window) : [];
  if (corners.length === 0) return simplifyLoopWithoutCorners(points, tolerance);

  const start = corners[0];
  if (start === undefined) return simplifyLoopWithoutCorners(points, tolerance);
  const rotated = [...points.slice(start), ...points.slice(0, start)];
  const first = rotated[0];
  if (first) rotated.push({ x: first.x, y: first.y });

  const breaks = corners.map((index) => (index - start + n) % n).sort((a, b) => a - b);
  breaks.push(n);

  const out: Point[] = [];
  for (let k = 0; k + 1 < breaks.length; k += 1) {
    const from = breaks[k] ?? 0;
    const to = breaks[k + 1] ?? n;
    const run = simplifyOpen(rotated.slice(from, to + 1), tolerance);
    out.push(...(k === 0 ? run : run.slice(1)));
  }
  const last = out[out.length - 1];
  if (out.length > 1 && last && first && last.x === first.x && last.y === first.y) out.pop();
  return out.length >= 3 ? out : simplifyLoopWithoutCorners(points, tolerance);
}

function simplifyLoopWithoutCorners(points: readonly Point[], tolerance: number): Point[] {
  const first = points[0];
  if (!first) return [...points];
  let far = 0;
  let best = -1;
  for (const [index, point] of points.entries()) {
    const distance = Math.hypot(point.x - first.x, point.y - first.y);
    if (distance > best) {
      best = distance;
      far = index;
    }
  }
  if (far < 2) return [...points];
  const closed = [...points, first];
  const head = simplifyOpen(closed.slice(0, far + 1), tolerance);
  const tail = simplifyOpen(closed.slice(far), tolerance);
  const merged = [...head.slice(0, -1), ...tail.slice(0, -1)];
  return merged.length >= 3 ? merged : [...points];
}

/* -------------------------------------------------------------------------------------------- */
/* The public entry point                                                                         */
/* -------------------------------------------------------------------------------------------- */

export function traceImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: TraceOptions = {},
): Result<TraceReport> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return fail('The image has no usable size.');
  }
  if (width * height > TRACE_LIMITS.maxSourcePixels) {
    return fail(
      'That image is too large to trace in one step.',
      'Import a copy at most 24 megapixels.',
    );
  }
  if (pixels.length !== width * height * 4) {
    return fail(
      'The pixel buffer does not match the image size.',
      'Pass RGBA bytes, four per pixel.',
    );
  }

  const colours = clampInt(
    options.colours,
    TRACE_LIMITS.defaultColours,
    TRACE_LIMITS.minColours,
    TRACE_LIMITS.maxColours,
  );
  const detail = clampInt(options.detail, 50, 0, 100);
  const minArea = Math.max(1, options.minArea ?? 12);
  const tolerance = 0.15 + (1 - detail / 100) * 3;

  const sample = sampleImage(pixels, width, height, TRACE_LIMITS.workingEdge);
  const hist = histogram(sample);
  if (hist.size === 0) {
    return fail('The image is fully transparent, so there is nothing to trace.');
  }
  const palette = buildPalette(hist, colours);
  const assignment = assign(sample, palette);

  const scaleX = width / sample.width;
  const scaleY = height / sample.height;
  const regions: { colour: string; contours: Contour[]; area: number; nodes: number }[] = [];
  let dropped = 0;

  for (const [paletteIndex, colour] of palette.entries()) {
    const loops = boundaryLoops(assignment, sample.width, sample.height, paletteIndex);
    const contours: Contour[] = [];
    let area = 0;
    let nodes = 0;
    for (const loop of loops) {
      const sampleArea = Math.abs(signedArea(loop)) * scaleX * scaleY;
      if (sampleArea < minArea) {
        dropped += 1;
        continue;
      }
      const simplified = simplifyLoop(loop, tolerance);
      if (simplified.length < 3) {
        dropped += 1;
        continue;
      }
      const points = simplified.map((point) =>
        createNode({
          x: Math.round(point.x * scaleX * 100) / 100,
          y: Math.round(point.y * scaleY * 100) / 100,
        }),
      );
      contours.push(createContour(points, true));
      nodes += points.length;
      area += signedArea(simplified) * scaleX * scaleY;
    }
    if (contours.length === 0) {
      dropped += 1;
      continue;
    }
    if (nodes > TRACE_LIMITS.maxNodesPerRegion) {
      return fail(
        `One colour needs ${String(nodes)} nodes, more than the ${String(TRACE_LIMITS.maxNodesPerRegion)} a layer may hold.`,
        'Lower the detail or the number of colours and trace again.',
      );
    }
    regions.push({ colour: hexOf(colour), contours, area: Math.abs(area), nodes });
  }

  if (regions.length === 0) {
    return fail(
      'Nothing in this image is large enough to trace.',
      'Increase the detail, lower the minimum area, or check that the image is not blank.',
    );
  }
  if (regions.length > TRACE_LIMITS.maxRegions) {
    return fail(`That trace produced more than ${String(TRACE_LIMITS.maxRegions)} layers.`);
  }

  regions.sort((a, b) => b.area - a.area || a.colour.localeCompare(b.colour));
  const built: TraceRegion[] = regions.map((region) => ({
    colour: region.colour,
    path: createPath(region.contours),
    area: Math.round(region.area),
    contours: region.contours.length,
    nodes: region.nodes,
  }));

  return ok({
    width,
    height,
    sampleWidth: sample.width,
    sampleHeight: sample.height,
    palette: palette.map(hexOf),
    regions: Object.freeze(built),
    nodes: built.reduce((sum, region) => sum + region.nodes, 0),
    droppedRegions: dropped,
    tolerance,
  });
}
