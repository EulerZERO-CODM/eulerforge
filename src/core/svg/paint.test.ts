import { describe, expect, it } from 'vitest';

import { createArtwork, createShape } from './artwork';
import { parseSvg } from './parse';
import { serializeSvg } from './serialize';
import { rectanglePath } from '../vector/shapes';
import { normaliseVectorStyle, type PaintSpec } from '../vector';

const box = { minX: 0, minY: 0, maxX: 200, maxY: 100 } as const;

const linear: PaintSpec = {
  kind: 'linear-gradient',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 0 },
  stops: [
    { offset: 0, color: '#ff0000' },
    { offset: 0.5, color: '#00ff00' },
    { offset: 1, color: '#0000ff' },
  ],
};

const radial: PaintSpec = {
  kind: 'radial-gradient',
  centre: { x: 0.5, y: 0.5 },
  radius: 0.25,
  stops: [
    { offset: 0, color: '#ffffff' },
    { offset: 1, color: '#101010' },
  ],
};

const pattern: PaintSpec = {
  kind: 'pattern',
  motif: 'checks',
  foreground: '#224466',
  background: '#f0f0f0',
  scale: 0.1,
  rotation: 30,
};

function artworkWith(fillPaint: PaintSpec, strokePaint: PaintSpec | null = null) {
  return createArtwork(
    { width: 200, height: 100 },
    [
      createShape('Card', rectanglePath(box), {
        fill: null,
        fillPaint,
        strokePaint,
        stroke: strokePaint === null ? null : '#000000',
      }),
    ],
    { viewBox: box },
  );
}

/** Writes, reads back and returns the single shape's style, asserting both steps succeeded. */
function roundTrip(fillPaint: PaintSpec, strokePaint: PaintSpec | null = null) {
  const written = serializeSvg(artworkWith(fillPaint, strokePaint));
  if (!written.ok) throw new Error(written.error.message);
  const read = parseSvg(written.value);
  if (!read.ok) throw new Error(read.error.message);
  const shape = read.value.artwork.shapes[0];
  if (!shape) throw new Error('The round trip lost the shape.');
  return { svg: written.value, style: shape.style, issues: read.value.issues };
}

function expectPaintClose(actual: PaintSpec | null | undefined, expected: PaintSpec): void {
  expect(actual).not.toBeNull();
  expect(actual).not.toBeUndefined();
  if (!actual || !expected) throw new Error('unreachable');
  expect(actual.kind).toBe(expected.kind);

  if (actual.kind === 'linear-gradient' && expected.kind === 'linear-gradient') {
    expect(actual.from.x).toBeCloseTo(expected.from.x, 3);
    expect(actual.from.y).toBeCloseTo(expected.from.y, 3);
    expect(actual.to.x).toBeCloseTo(expected.to.x, 3);
    expect(actual.to.y).toBeCloseTo(expected.to.y, 3);
    expect(actual.stops).toEqual(expected.stops);
    return;
  }
  if (actual.kind === 'radial-gradient' && expected.kind === 'radial-gradient') {
    expect(actual.centre.x).toBeCloseTo(expected.centre.x, 3);
    expect(actual.centre.y).toBeCloseTo(expected.centre.y, 3);
    expect(actual.radius).toBeCloseTo(expected.radius, 3);
    expect(actual.stops).toEqual(expected.stops);
    return;
  }
  if (actual.kind === 'pattern' && expected.kind === 'pattern') {
    expect(actual).toEqual(expected);
    return;
  }
  throw new Error(`Expected ${expected.kind}, read ${actual.kind}.`);
}

describe('paint serialisation', () => {
  it('writes a linear gradient as a userSpaceOnUse definition referenced by the shape', () => {
    const written = serializeSvg(artworkWith(linear));
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value).toContain('<defs>');
    expect(written.value).toContain(
      '<linearGradient id="paint-1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="200" y2="0">',
    );
    expect(written.value.match(/<stop /g)).toHaveLength(3);
    expect(written.value).toContain('fill="url(#paint-1)"');
  });

  it('writes a radial gradient with an absolute radius from the shorter side', () => {
    const written = serializeSvg(artworkWith(radial));
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value).toContain(
      '<radialGradient id="paint-1" gradientUnits="userSpaceOnUse" cx="100" cy="50" r="25">',
    );
  });

  it('writes a pattern with the tile, the transform and the round-trip annotation', () => {
    const written = serializeSvg(artworkWith(pattern));
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value).toContain('<pattern id="paint-1" patternUnits="userSpaceOnUse"');
    expect(written.value).toContain('patternTransform="rotate(30 100 50)"');
    expect(written.value).toContain('data-forge-pattern="');
    // The annotation is XML-escaped JSON, so the quotes are entities.
    expect(written.value).toContain('&quot;kind&quot;:&quot;pattern&quot;');
  });

  it('uses positional ids so exporting the same artwork twice is byte-identical', () => {
    const first = serializeSvg(artworkWith(linear));
    const second = serializeSvg(artworkWith(linear));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).toBe(second.value);
  });

  it('numbers each definition in shape order and never reuses an id', () => {
    const artwork = createArtwork(
      { width: 200, height: 100 },
      [
        createShape('A', rectanglePath(box), { fillPaint: linear, fill: null }),
        createShape('B', rectanglePath({ minX: 0, minY: 0, maxX: 50, maxY: 50 }), {
          fillPaint: radial,
          fill: null,
        }),
      ],
      { viewBox: box },
    );
    const written = serializeSvg(artwork);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value).toContain('id="paint-1"');
    expect(written.value).toContain('id="paint-2"');
    expect(written.value).toContain('fill="url(#paint-1)"');
    expect(written.value).toContain('fill="url(#paint-2)"');
  });

  it('does not write a definition for a shape that paints nothing', () => {
    const artwork = createArtwork(
      { width: 200, height: 100 },
      [createShape('Invisible', rectanglePath(box), { fill: null, fillPaint: null, stroke: null })],
      { viewBox: box },
    );
    const written = serializeSvg(artwork);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value).not.toContain('<defs>');
    expect(written.value).not.toContain('<path');
  });
});

describe('paint round trip', () => {
  it('keeps a linear gradient’s geometry and stops', () => {
    const { style, issues } = roundTrip(linear);
    expect(style.fill).toBeNull();
    expectPaintClose(style.fillPaint, linear);
    expect(issues.some((issue) => issue.code.startsWith('paint.'))).toBe(false);
  });

  it('keeps a radial gradient’s centre, radius and stops', () => {
    const { style } = roundTrip(radial);
    expectPaintClose(style.fillPaint, radial);
  });

  it('keeps a pattern exactly, including the motif and rotation', () => {
    const { style } = roundTrip(pattern);
    expectPaintClose(style.fillPaint, pattern);
  });

  it('keeps a stroke paint alongside the solid stroke it replaces', () => {
    const { style } = roundTrip(linear, radial);
    expectPaintClose(style.fillPaint, linear);
    expectPaintClose(style.strokePaint, radial);
  });

  it('converts absolute coordinates back to fractions against the shape bounds', () => {
    // The shape and the artwork share a bounds origin here, so the fractions must be exactly the
    // stored ones; a different origin is covered by the importer's doc comment and by the icon-set
    // fixture below.
    const { style } = roundTrip(linear);
    if (style.fillPaint?.kind !== 'linear-gradient') throw new Error('expected a gradient');
    expect(style.fillPaint.from).toEqual({ x: 0, y: 0 });
    expect(style.fillPaint.to).toEqual({ x: 1, y: 0 });
  });

  it('re-imports its own export for a shape whose bounds are translated', () => {
    const translated = createArtwork(
      { width: 200, height: 100 },
      [
        createShape('Shifted', rectanglePath({ minX: 40, minY: 20, maxX: 140, maxY: 70 }), {
          fill: null,
          fillPaint: linear,
        }),
      ],
      { viewBox: box },
    );
    const written = serializeSvg(translated);
    if (!written.ok) throw new Error(written.error.message);
    const read = parseSvg(written.value);
    if (!read.ok) throw new Error(read.error.message);
    const style = read.value.artwork.shapes[0]?.style;
    if (style?.fillPaint?.kind !== 'linear-gradient') throw new Error('expected a gradient');
    expect(style.fillPaint.from.x).toBeCloseTo(0, 3);
    expect(style.fillPaint.to.x).toBeCloseTo(1, 3);
    expect(style.fillPaint.from.y).toBeCloseTo(0, 3);
    expect(style.fillPaint.to.y).toBeCloseTo(0, 3);
  });
});

describe('importing paint from files this project did not write', () => {
  it('reads a plain SVG linear gradient with objectBoundingBox units', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#87ceeb"/>
          <stop offset="1" stop-color="#ffffff"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="50" fill="url(#sky)"/>
    </svg>`;
    const result = parseSvg(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const style = result.value.artwork.shapes[0]?.style;
    if (style?.fillPaint?.kind !== 'linear-gradient') throw new Error('expected a gradient');
    expect(style.fillPaint.from).toEqual({ x: 0, y: 0 });
    expect(style.fillPaint.to).toEqual({ x: 0, y: 1 });
    expect(style.fillPaint.stops).toEqual([
      { offset: 0, color: '#87ceeb' },
      { offset: 1, color: '#ffffff' },
    ]);
    expect(style.fill).toBeNull();
    expect(result.value.approximated).toBe(false);
  });

  it('maps userSpaceOnUse gradient coordinates through the shape bounds', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="20" y1="20" x2="80" y2="80">
          <stop offset="0" stop-color="#000000"/>
          <stop offset="1" stop-color="#ffffff"/>
        </linearGradient>
      </defs>
      <path d="M20 20 L80 20 L80 80 L20 80 Z" fill="url(#g)"/>
    </svg>`;
    const result = parseSvg(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const style = result.value.artwork.shapes[0]?.style;
    if (style?.fillPaint?.kind !== 'linear-gradient') throw new Error('expected a gradient');
    expect(style.fillPaint.from).toEqual({ x: 0, y: 0 });
    expect(style.fillPaint.to).toEqual({ x: 1, y: 1 });
  });

  it('keeps the solid colour and reports a reference to a missing definition', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <path d="M0 0 L10 0 L10 10 Z" fill="#ff0000" stroke="url(#missing)"/>
    </svg>`;
    const result = parseSvg(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const style = result.value.artwork.shapes[0]?.style;
    expect(style?.fillPaint).toBeNull();
    expect(style?.fill).toBe('#ff0000');
    // The reference names no definition in this file, so it is not paint: it is reported and the
    // stroke keeps the colour the parser falls back to.
    const issue = result.value.issues.find((entry) => entry.code === 'style.unknown-paint');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('url(#missing)');
    expect(style?.strokePaint).toBeNull();
  });

  it('never follows an external paint reference', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <path d="M0 0 L10 0 L10 10 Z" fill="url(https://example.com/paint.svg#g)"/>
    </svg>`;
    const result = parseSvg(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const style = result.value.artwork.shapes[0]?.style;
    expect(style?.fillPaint).toBeNull();
    const issue = result.value.issues.find(
      (entry) =>
        entry.code === 'style.unknown-paint' && entry.message.includes('example.com/paint.svg'),
    );
    expect(issue).toBeDefined();
    expect(result.value.approximated).toBe(false);
  });

  it('reports a gradient with one stop as approximated instead of inventing a second', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <defs>
        <linearGradient id="one">
          <stop offset="0" stop-color="#123456"/>
        </linearGradient>
      </defs>
      <path d="M0 0 L10 0 L10 10 Z" fill="url(#one)"/>
    </svg>`;
    const result = parseSvg(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const style = result.value.artwork.shapes[0]?.style;
    expect(style?.fillPaint).toBeNull();
    expect(result.value.issues.some((issue) => issue.code === 'paint.gradient-too-few-stops')).toBe(
      true,
    );
  });

  it('reads a pattern this project did not write as a warning, not a lie', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <defs>
        <pattern id="p" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="2" height="2" fill="#ffffff"/>
        </pattern>
      </defs>
      <path d="M0 0 L10 0 L10 10 Z" fill="url(#p)"/>
    </svg>`;
    const result = parseSvg(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const style = result.value.artwork.shapes[0]?.style;
    expect(style?.fillPaint).toBeNull();
    expect(style?.fill).not.toBeNull();
    expect(
      result.value.issues.some((issue) => issue.code === 'paint.pattern-unrepresentable'),
    ).toBe(true);
  });
});

describe('style normalisation preserves paint', () => {
  it('keeps paint through normaliseVectorStyle', () => {
    const style = normaliseVectorStyle({ fill: null, fillPaint: pattern });
    expectPaintClose(style.fillPaint, pattern);
  });
});
