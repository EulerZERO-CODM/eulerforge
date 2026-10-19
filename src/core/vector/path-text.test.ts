import { describe, expect, it } from 'vitest';

import { createContour, createNode, createPath } from './types';
import { layoutPathText, pathCanCarryText } from './path-text';

/** Every glyph is ten units wide, so the arithmetic in a test can be done in the head. */
const tenWide = (): number => 10;

function line(fromX: number, fromY: number, toX: number, toY: number) {
  return createPath([
    createContour([createNode({ x: fromX, y: fromY }), createNode({ x: toX, y: toY })], false),
  ]);
}

function square(size: number) {
  return createPath([
    createContour(
      [
        createNode({ x: 0, y: 0 }),
        createNode({ x: size, y: 0 }),
        createNode({ x: size, y: size }),
        createNode({ x: 0, y: size }),
      ],
      true,
    ),
  ]);
}

describe('layoutPathText', () => {
  it('places glyphs at the midpoint of their own advance on a straight line', () => {
    const layout = layoutPathText(
      line(0, 0, 100, 0),
      { content: 'ABCDE', fontSize: 10, letterSpacing: 0, startOffset: 0 },
      tenWide,
    );
    expect(layout.pathLength).toBe(100);
    expect(layout.glyphs.map((glyph) => glyph.x)).toEqual([5, 15, 25, 35, 45]);
    expect(layout.glyphs.every((glyph) => glyph.y === 0)).toBe(true);
    expect(layout.glyphs.every((glyph) => glyph.angle === 0)).toBe(true);
    expect(layout.tooLong).toBe(false);
    expect(layout.dropped).toBe(0);
  });

  it('starts where startOffset says, as a fraction of the contour length', () => {
    const layout = layoutPathText(
      line(0, 0, 100, 0),
      { content: 'AB', fontSize: 10, letterSpacing: 0, startOffset: 0.5 },
      tenWide,
    );
    layout.glyphs.forEach((glyph, index) => {
      expect(glyph.x).toBeCloseTo([55, 65][index] as number, 6);
    });
  });

  it('adds letter spacing between glyphs but not before the first', () => {
    const layout = layoutPathText(
      line(0, 0, 100, 0),
      { content: 'ABC', fontSize: 10, letterSpacing: 2, startOffset: 0 },
      tenWide,
    );
    // Glyph 0 occupies 0–10; glyph 1 starts at 12 and is centred at 17; glyph 2 at 24 → 29.
    layout.glyphs.forEach((glyph, index) => {
      expect(glyph.x).toBeCloseTo([5, 17, 29][index] as number, 6);
    });
  });

  it('drops the characters that do not fit and says how many', () => {
    const layout = layoutPathText(
      line(0, 0, 100, 0),
      { content: 'ABCDEFGHIJKL', fontSize: 10, letterSpacing: 0, startOffset: 0 },
      tenWide,
    );
    expect(layout.glyphs).toHaveLength(10);
    expect(layout.dropped).toBe(2);
    expect(layout.tooLong).toBe(true);
    // Nothing is placed past the end of the contour.
    expect(Math.max(...layout.glyphs.map((glyph) => glyph.x))).toBeLessThanOrEqual(100);
  });

  it('follows a curve: anchors stay on the flattened line and the tangent turns', () => {
    const curve = createPath([
      createContour(
        [
          { point: { x: 0, y: 0 }, handleIn: null, handleOut: { x: 40, y: -60 } },
          { point: { x: 120, y: 0 }, handleIn: { x: 80, y: -60 }, handleOut: null },
        ],
        false,
      ),
    ]);
    const layout = layoutPathText(
      curve,
      { content: 'a'.repeat(24), fontSize: 12, letterSpacing: 0, startOffset: 0 },
      tenWide,
    );
    expect(layout.glyphs.length).toBeGreaterThan(10);
    const first = layout.glyphs[0];
    const last = layout.glyphs.at(-1);
    // The tangent turns through zero along the arc: up-right at the start (negative screen angle)
    // and down-right once the curve comes back down.
    const angles = layout.glyphs.map((glyph) => glyph.angle);
    expect(first?.angle).toBeLessThan(-0.5);
    expect(Math.max(...angles)).toBeGreaterThan(0.2);
    expect(Math.min(...angles)).toBeLessThan(-0.5);
    expect(last?.angle).toBeGreaterThan(first?.angle ?? 0);
    // The apex of the curve is above the chord, so the middle glyphs sit above the end glyphs.
    const apex = layout.glyphs[Math.floor(layout.glyphs.length / 2)];
    expect(apex?.y).toBeLessThan(-10);
    expect(first?.y).toBeGreaterThan(-5);
    expect(last?.y).toBeGreaterThan(-5);
  });

  it('continues around a closed contour instead of stopping at the last node', () => {
    const layout = layoutPathText(
      square(100),
      { content: 'x'.repeat(12), fontSize: 20, letterSpacing: 0, startOffset: 0 },
      tenWide,
    );
    // Perimeter 400; the eleventh glyph starts at 200, which is the end of the second side.
    expect(layout.pathLength).toBe(400);
    expect(layout.glyphs).toHaveLength(12);
    // Glyph 10 starts at arclength 100 on the first corner and is centred five units down side two.
    expect(layout.glyphs[10]?.x).toBeCloseTo(100, 6);
    expect(layout.glyphs[10]?.y).toBeCloseTo(5, 6);
  });

  it('returns an empty layout for empty content or a path with no length', () => {
    expect(
      layoutPathText(
        line(0, 0, 100, 0),
        { content: '', fontSize: 10, letterSpacing: 0, startOffset: 0 },
        tenWide,
      ).glyphs,
    ).toHaveLength(0);
    const dot = createPath([createContour([createNode({ x: 5, y: 5 })], false)]);
    expect(
      layoutPathText(
        dot,
        { content: 'abc', fontSize: 10, letterSpacing: 0, startOffset: 0 },
        tenWide,
      ).glyphs,
    ).toHaveLength(0);
  });

  it('is deterministic: the same inputs give the same glyphs', () => {
    const path = square(60);
    const settings = { content: 'Euler', fontSize: 14, letterSpacing: 1.5, startOffset: 0.2 };
    expect(layoutPathText(path, settings, tenWide)).toEqual(
      layoutPathText(path, settings, tenWide),
    );
  });

  it('reports whether a path can carry text at all', () => {
    expect(pathCanCarryText(line(0, 0, 10, 0))).toBe(true);
    expect(pathCanCarryText(createPath([createContour([createNode({ x: 1, y: 1 })], false)]))).toBe(
      false,
    );
  });
});
