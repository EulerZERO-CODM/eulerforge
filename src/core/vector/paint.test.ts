import { describe, expect, it } from 'vitest';

import {
  describePaint,
  isPaintColour,
  motifPrimitives,
  normalisePaint,
  normaliseStops,
  PAINT_LIMITS,
  representativeColour,
  resolveGradient,
  resolvePattern,
  type LinearGradientPaint,
  type PatternPaint,
  type RadialGradientPaint,
} from './paint';

const box = { minX: 10, minY: 20, maxX: 110, maxY: 70 } as const; // 100 × 50

const linear: LinearGradientPaint = {
  kind: 'linear-gradient',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 1 },
  stops: [
    { offset: 0, color: '#ff0000' },
    { offset: 1, color: '#0000ff' },
  ],
};

const radial: RadialGradientPaint = {
  kind: 'radial-gradient',
  centre: { x: 0.5, y: 0.5 },
  radius: 0.5,
  stops: [
    { offset: 0, color: '#ffffff' },
    { offset: 1, color: '#000000' },
  ],
};

const pattern: PatternPaint = {
  kind: 'pattern',
  motif: 'stripes',
  foreground: '#112233',
  background: '#ffffff',
  scale: 0.2,
  rotation: 0,
};

describe('normaliseStops', () => {
  it('sorts stops by offset, because SVG requires non-decreasing offsets', () => {
    const normalised = normaliseStops([
      { offset: 1, color: '#ff0000' },
      { offset: 0, color: '#0000ff' },
      { offset: 0.5, color: '#00ff00' },
    ]);
    expect(normalised.map((stop) => stop.offset)).toEqual([0, 0.5, 1]);
    expect(normalised.map((stop) => stop.color)).toEqual(['#0000ff', '#00ff00', '#ff0000']);
  });

  it('clamps offsets outside 0–1 rather than dropping the stop', () => {
    const normalised = normaliseStops([
      { offset: -3, color: '#000000' },
      { offset: 4, color: '#ffffff' },
    ]);
    expect(normalised.map((stop) => stop.offset)).toEqual([0, 1]);
  });

  it('rejects colours the kernel cannot store and lowercases the rest', () => {
    const normalised = normaliseStops([
      { offset: 0, color: 'RED' },
      { offset: 0.5, color: 'rgb(1,2,3)' },
      { offset: 1, color: '#AABBCC' },
    ]);
    // Only the hex stop survives; a lone stop is duplicated so the gradient still has two.
    expect(normalised).toEqual([
      { offset: 1, color: '#aabbcc' },
      { offset: 1, color: '#aabbcc' },
    ]);
  });

  it('turns a single surviving stop into a flat two-stop gradient', () => {
    expect(normaliseStops([{ offset: 0.25, color: '#123456' }])).toEqual([
      { offset: 0.25, color: '#123456' },
      { offset: 1, color: '#123456' },
    ]);
  });

  it('falls back to black and white when no stop is usable', () => {
    expect(normaliseStops([{ offset: 0, color: 'url(#x)' }])).toEqual([
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ]);
  });

  it('caps the stop count at the documented limit', () => {
    const many = Array.from({ length: PAINT_LIMITS.maxStops + 4 }, (_, index) => ({
      offset: index / (PAINT_LIMITS.maxStops + 3),
      color: '#000000',
    }));
    expect(normaliseStops(many)).toHaveLength(PAINT_LIMITS.maxStops);
  });
});

describe('normalisePaint', () => {
  it('returns null for no paint and can never invent one', () => {
    expect(normalisePaint(null)).toBeNull();
    expect(normalisePaint(undefined)).toBeNull();
  });

  it('accepts only hex for a solid colour', () => {
    expect(normalisePaint({ kind: 'solid', color: '#ABCDEF' })).toEqual({
      kind: 'solid',
      color: '#abcdef',
    });
    expect(normalisePaint({ kind: 'solid', color: 'tomato' })).toBeNull();
  });

  it('clamps gradient endpoints into the supported range', () => {
    const normalised = normalisePaint({
      ...linear,
      from: { x: -99, y: 99 },
    });
    expect(normalised).toMatchObject({ kind: 'linear-gradient', from: { x: -4, y: 5 } });
  });

  it('clamps radial radius and pattern scale and rotation', () => {
    expect(normalisePaint({ ...radial, radius: 0 })).toMatchObject({ radius: 0.01 });
    expect(normalisePaint({ ...radial, radius: 100 })).toMatchObject({ radius: 4 });
    expect(normalisePaint({ ...pattern, scale: 0 })).toMatchObject({
      scale: PAINT_LIMITS.minPatternScale,
    });
    expect(normalisePaint({ ...pattern, scale: 10 })).toMatchObject({
      scale: PAINT_LIMITS.maxPatternScale,
    });
    expect(normalisePaint({ ...pattern, rotation: -1000 })).toMatchObject({
      rotation: -PAINT_LIMITS.maxRotationDegrees,
    });
  });

  it('falls back to a supported motif instead of storing an unknown one', () => {
    const unknown = { ...pattern, motif: 'zigzag' } as unknown as PatternPaint;
    expect(normalisePaint(unknown)).toMatchObject({ motif: 'stripes' });
  });

  it('keeps a pattern background only when it is a real colour', () => {
    expect(normalisePaint({ ...pattern, background: null })).toMatchObject({ background: null });
    const invalid = { ...pattern, background: 'transparent' } as unknown as PatternPaint;
    expect(normalisePaint(invalid)).toMatchObject({ background: null });
  });

  it('is idempotent, so re-saving a document cannot drift', () => {
    const once = normalisePaint({ ...linear, stops: [...linear.stops].reverse() });
    expect(normalisePaint(once)).toEqual(once);
  });
});

describe('resolveGradient', () => {
  it('maps linear fractions onto absolute coordinates of the given bounds', () => {
    const resolved = resolveGradient(linear, box);
    expect(resolved).toMatchObject({ kind: 'linear', x1: 10, y1: 20, x2: 110, y2: 70 });
  });

  it('maps a radial gradient using the shorter side for the radius', () => {
    const resolved = resolveGradient(radial, box);
    expect(resolved).toMatchObject({ kind: 'radial', cx: 60, cy: 45, radius: 25 });
  });

  it('gives a degenerate box a direction instead of producing NaN', () => {
    const resolved = resolveGradient(linear, { minX: 5, minY: 5, maxX: 5, maxY: 5 });
    expect(resolved).toMatchObject({ kind: 'linear' });
    for (const value of Object.values(resolved).filter((entry) => typeof entry === 'number')) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('normalises the stops it hands to a renderer', () => {
    const resolved = resolveGradient(
      {
        ...linear,
        stops: [
          { offset: 1, color: '#ffffff' },
          { offset: 0, color: '#000000' },
        ],
      },
      box,
    );
    expect(resolved.stops.map((stop) => stop.color)).toEqual(['#000000', '#ffffff']);
  });
});

describe('resolvePattern', () => {
  it('sizes the tile from the shorter side and anchors the grid at the bounds origin', () => {
    const resolved = resolvePattern({ ...pattern, scale: 0.2 }, box);
    expect(resolved.tile).toBe(10); // 50 × 0.2
    expect(resolved.grid).toEqual({ x: 10, y: 20 });
    expect(resolved.pivot).toEqual({ x: 60, y: 45 });
    expect(resolved.area).toEqual(box);
  });

  it('floors the tile so a tiny shape still has drawable primitives', () => {
    const resolved = resolvePattern(pattern, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(resolved.tile).toBeGreaterThanOrEqual(0.5);
  });

  it('carries rotation through unchanged for the painter to apply', () => {
    expect(resolvePattern({ ...pattern, rotation: 45 }, box).rotation).toBe(45);
  });

  it('describes every motif with primitives that stay inside one tile', () => {
    for (const motif of ['stripes', 'dots', 'grid', 'checks'] as const) {
      const resolved = resolvePattern({ ...pattern, motif }, box);
      expect(resolved.primitives.length).toBeGreaterThan(0);
      for (const primitive of resolved.primitives) {
        expect(primitive.color).toBe('#112233');
        if (primitive.kind === 'rect') {
          expect(primitive.x).toBeGreaterThanOrEqual(0);
          expect(primitive.y).toBeGreaterThanOrEqual(0);
          expect(primitive.x + primitive.width).toBeLessThanOrEqual(resolved.tile + 1e-9);
          expect(primitive.y + primitive.height).toBeLessThanOrEqual(resolved.tile + 1e-9);
        } else {
          expect(primitive.cx - primitive.radius).toBeGreaterThanOrEqual(-1e-9);
          expect(primitive.cx + primitive.radius).toBeLessThanOrEqual(resolved.tile + 1e-9);
        }
      }
    }
  });
});

describe('motifPrimitives', () => {
  it('draws half-width stripes', () => {
    expect(motifPrimitives('stripes', 8, '#000000')).toEqual([
      { kind: 'rect', x: 0, y: 0, width: 4, height: 8, color: '#000000' },
    ]);
  });

  it('draws a dot centred in the tile', () => {
    expect(motifPrimitives('dots', 8, '#000000')).toEqual([
      { kind: 'circle', cx: 4, cy: 4, radius: 2, color: '#000000' },
    ]);
  });
});

describe('representativeColour and describePaint', () => {
  it('picks the middle normalised stop for a gradient', () => {
    expect(representativeColour(linear, '#000000')).toBe('#0000ff');
  });

  it('uses the foreground for a pattern and the fallback for no paint', () => {
    expect(representativeColour(pattern, '#000000')).toBe('#112233');
    expect(representativeColour(null, '#abcdef')).toBe('#abcdef');
  });

  it('describes each paint in one line', () => {
    expect(describePaint(null, 'none')).toBe('none');
    expect(describePaint({ kind: 'solid', color: '#123456' }, 'none')).toBe('#123456');
    expect(describePaint(linear, 'none')).toBe('linear gradient, 2 stops');
    expect(describePaint(radial, 'none')).toBe('radial gradient, 2 stops');
    expect(describePaint(pattern, 'none')).toBe('stripes pattern');
  });
});

describe('isPaintColour', () => {
  it('accepts six-digit hex only', () => {
    expect(isPaintColour('#000000')).toBe(true);
    expect(isPaintColour('#ABCDEF')).toBe(true);
    expect(isPaintColour('#fff')).toBe(false);
    expect(isPaintColour('url(#gradient)')).toBe(false);
    expect(isPaintColour('currentColor')).toBe(false);
  });
});
