/**
 * SVG import and export.
 *
 * The tests are written as a user of the module would experience it: build artwork, write a file,
 * read the file back, and compare what came out with what went in. The comparison is on geometry
 * and supported styling rather than on strings, because a serialiser is allowed to choose its
 * markup but not to change the drawing.
 */

import { describe, expect, it } from 'vitest';

import { boundsOfPath } from '../vector/bounds';
import { parsePathData } from '../vector/path-data';
import { toPathData } from '../vector/path-data';
import { ellipsePath, rectanglePath } from '../vector/shapes';
import { transformPath } from '../vector/transform';
import { allSegments } from '../vector/path';
import {
  DEFAULT_SHAPE_STYLE,
  artworkBounds,
  createArtwork,
  createShape,
  transformShape,
  validateArtwork,
  type SvgArtwork,
} from './artwork';
import { serializeNaiveSvg } from './naive';
import { parseSvg, parseTransform } from './parse';
import { formatSvgNumber, iconIdFor, serializeIconSprite, serializeSvg } from './serialize';



/** Test fixture helper: a throwing wrapper so a bad literal fails loudly in the test body. */
type ParsedData = Extract<ReturnType<typeof parsePathData>, { ok: true }>['value'];

function pathOf(data: string): ParsedData {
  const parsed = parsePathData(data);
  if (!parsed.ok) throw new Error(`Test fixture is invalid: ${data} — ${parsed.error.message}`);
  return parsed.value;
}

function artworkOfFixture(): SvgArtwork {
  const square = pathOf('M0 0 L100 0 L100 100 L0 100 Z');
  const curve = pathOf('M0 0 C0 100 100 100 100 0 Z');
  return createArtwork({ width: 200, height: 200 }, [
    createShape('Square', square.path, { fill: '#ff0000' }),
    createShape(
      'Ring',
      pathOf('M50 50 L150 50 L150 150 L50 150 Z M75 75 L75 125 L125 125 L125 75 Z').path,
      { fill: '#3366ff', fillRule: 'evenodd', stroke: '#000000', strokeWidth: 2 },
      0.8,
    ),
    createShape('Curve', curve.path, {
      fill: null,
      stroke: '#00aa55',
      strokeWidth: 4,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: [5, 3],
    }),
  ]);
}

function serialized(artwork: SvgArtwork, digits?: number): string {
  const result = serializeSvg(artwork, digits === undefined ? {} : { digits });
  if (!result.ok) throw new Error(`Serialisation failed: ${result.error.message}`);
  return result.value;
}

describe('number formatting', () => {
  it('writes integers without a decimal point and never writes -0', () => {
    expect(formatSvgNumber(10, 3)).toBe('10');
    expect(formatSvgNumber(10.5, 3)).toBe('10.5');
    expect(formatSvgNumber(0.0001, 3)).toBe('0');
    expect(formatSvgNumber(-0.0001, 3)).toBe('0');
    expect(formatSvgNumber(1 / 3, 3)).toBe('0.333');
  });

  it('never writes exponential notation, which SVG does not accept in every attribute', () => {
    expect(formatSvgNumber(0.000123, 3)).toBe('0');
    expect(formatSvgNumber(1234567.891, 3)).toBe('1234567.891');
  });
});

describe('serialization', () => {
  it('writes a valid document with a viewBox matching the artwork', () => {
    const svg = serialized(artworkOfFixture());
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="200"');
    expect(svg).toContain('viewBox="0 0 200 200"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('omits every attribute that equals the SVG default', () => {
    const plain = createArtwork({ width: 10, height: 10 }, [
      createShape('Plain', pathOf('M0 0 L10 0 L10 10 Z').path, {}),
    ]);
    const svg = serialized(plain);
    // Black fill is the SVG default; nothing else is stated.
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 0 10 10Z"/></svg>',
    );
  });

  it('writes fills, rules, strokes, caps, joins and dashes when they differ from the default', () => {
    const svg = serialized(artworkOfFixture());
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('fill="#3366ff"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('opacity="0.8"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#00aa55"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('stroke-dasharray="5 3"');
  });

  it('writes a background rectangle only when the artwork declares one', () => {
    const withBackground = createArtwork({ width: 20, height: 20 }, [], { background: '#ffcc00' });
    expect(serialized(withBackground)).toContain('<path d="M0 0L20 0 20 20 0 20Z" fill="#ffcc00"/>');
    expect(serialized(createArtwork({ width: 20, height: 20 }, []))).not.toContain('#ffcc00');
  });

  it('is byte-identical for identical input', () => {
    const first = serialized(artworkOfFixture());
    for (let repeat = 0; repeat < 5; repeat += 1) {
      expect(serialized(artworkOfFixture())).toBe(first);
    }
  });

  it('writes the same geometry at a lower coordinate precision, rounded', () => {
    const awkward = createArtwork({ width: 100, height: 100 }, [
      createShape('Awkward', pathOf('M0.12345 0.6789 L99.999 0.0001 L50.5 99.5 Z').path, {}),
    ]);
    expect(serialized(awkward, 3)).toContain('d="M0.123 0.679L99.999 0 50.5 99.5Z"');
    // Six digits keeps more of the original, so the file is larger but more faithful.
    expect(serialized(awkward, 6)).toContain('d="M0.12345 0.6789L99.999 0.0001 50.5 99.5Z"');
  });

  it('refuses to write a file for artwork whose size is not positive', () => {
    const broken = { ...createArtwork({ width: 10, height: 10 }, []), width: 0 };
    const result = serializeSvg(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('must be positive');
  });

  it('refuses to write a file for artwork whose geometry is invalid', () => {
    const bad = createArtwork({ width: 10, height: 10 }, [
      createShape('Broken', pathOf('M0 0 L10 10 L10 0 L0 10 Z').path, {}),
    ]);
    const result = serializeSvg(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('cannot be exported');
  });

  it('reports an empty layer as a non-blocking issue instead of failing the whole export', () => {
    const artwork = createArtwork({ width: 10, height: 10 }, [
      createShape('Nothing', { contours: [] }, {}),
      createShape('Something', pathOf('M0 0 L10 0 L10 10 Z').path, {}),
    ]);
    const report = validateArtwork(artwork);
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.issues).toHaveLength(1);
      expect(report.value.issues[0]?.code).toBe('empty');
      expect(report.value.issues[0]?.severity).toBe('warning');
    }
    // The empty shape contributes nothing to the file, and the marker path still writes.
    expect(serialized(artwork)).toContain('<path d="M0 0L10 0 10 10Z"/>');
  });

  it('names shapes in <title> elements on request, without changing geometry', () => {
    const named = serialized(artworkOfFixture(), undefined);
    expect(named).not.toContain('<title>');
    const result = serializeSvg(artworkOfFixture(), { includeNames: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('<title>Square</title>');
      expect(result.value).toContain('<title>Ring</title>');
    }
  });

  it('escapes names so a layer called <script> cannot inject markup', () => {
    const artwork = createArtwork({ width: 10, height: 10 }, [
      createShape('</svg><script>alert(1)</script>', pathOf('M0 0 L10 0 L10 10 Z').path, {}),
    ]);
    const result = serializeSvg(artwork, { includeNames: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toContain('<script>');
      expect(result.value).toContain('&lt;script&gt;');
    }
  });
});

describe('icons and sprites', () => {
  it('derives stable, XML-safe ids from icon names', () => {
    expect(iconIdFor('Star Icon')).toBe('star-icon');
    expect(iconIdFor('  Arrow / Up  ')).toBe('arrow-up');
    expect(iconIdFor('###')).toBe('icon');
  });

  it('writes one symbol per icon with its own viewBox, de-duplicating ids', () => {
    const artwork = createArtwork({ width: 24, height: 24 }, [
      createShape('Plus', pathOf('M0 0 L24 0 L24 24 L0 24 Z').path, {}),
    ]);
    const result = serializeIconSprite([
      { name: 'Plus', artwork },
      { name: 'plus', artwork },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('<symbol id="plus" viewBox="0 0 24 24">');
      expect(result.value).toContain('<symbol id="plus-2" viewBox="0 0 24 24">');
      expect(result.value).toContain('<title>Plus</title>');
      expect(result.value).toContain('xmlns="http://www.w3.org/2000/svg"');
    }
  });

  it('refuses an empty icon set rather than writing an empty sprite', () => {
    const result = serializeIconSprite([]);
    expect(result.ok).toBe(false);
  });

  it('refuses a sprite when one icon is invalid', () => {
    const result = serializeIconSprite([
      {
        name: 'Bad',
        artwork: createArtwork({ width: 10, height: 10 }, [
          createShape('Bowtie', pathOf('M0 0 L10 10 L10 0 L0 10 Z').path, {}),
        ]),
      },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('compact output versus the naive baseline', () => {
  it('is materially smaller for the same artwork', () => {
    const artwork = artworkOfFixture();
    const compact = serialized(artwork);
    const naive = serializeNaiveSvg(artwork);
    expect(compact.length).toBeLessThan(naive.length);
    // The threshold is a floor, not a target: anything below this means the compact serialiser has
    // stopped removing defaults and should be investigated.
    expect(compact.length).toBeLessThan(naive.length * 0.75);
  });

  it('describes the same drawing, so the size win cannot come from dropping content', () => {
    const artwork = artworkOfFixture();
    const compact = serialized(artwork);
    const naive = serializeNaiveSvg(artwork);

    // `\sd="` rather than `d="` so the pattern cannot also match the tail of `id="…"`.
    const compactData = [...compact.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1] ?? '');
    const naiveData = [...naive.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(compactData).toHaveLength(naiveData.length);
    expect(compactData).toHaveLength(artwork.shapes.length);

    compactData.forEach((data, index) => {
      const compactPath = parsePathData(data);
      const naivePath = parsePathData(naiveData[index] ?? '');
      expect(compactPath.ok).toBe(true);
      expect(naivePath.ok).toBe(true);
      if (!compactPath.ok || !naivePath.ok) return;

      // Same bounds to a thousandth of a unit, and the same number of segments and contours.
      const compactBounds = boundsOfPath(compactPath.value.path);
      const naiveBounds = boundsOfPath(naivePath.value.path);
      expect(compactBounds?.minX).toBeCloseTo(naiveBounds?.minX ?? Number.NaN, 3);
      expect(compactBounds?.maxX).toBeCloseTo(naiveBounds?.maxX ?? Number.NaN, 3);
      expect(compactBounds?.minY).toBeCloseTo(naiveBounds?.minY ?? Number.NaN, 3);
      expect(compactBounds?.maxY).toBeCloseTo(naiveBounds?.maxY ?? Number.NaN, 3);
      expect(allSegments(compactPath.value.path)).toHaveLength(allSegments(naivePath.value.path).length);
    });

    // Styling survives too: the naive file states every property, this one states what differs.
    expect(naive).toContain('fill:#ff0000');
    expect(compact).toContain('fill="#ff0000"');
    expect(compact).toContain('stroke-dasharray="5 3"');
  });

  it('keeps its size advantage on a realistic icon-set document', () => {
    const shapes = Array.from({ length: 12 }, (_value, index) =>
      createShape(`Shape ${String(index + 1)}`, rectanglePath({ minX: index * 10, minY: 0, maxX: index * 10 + 8, maxY: 8 }), {
        fill: index % 2 === 0 ? '#123456' : null,
        ...(index % 3 === 0 ? { stroke: '#654321', strokeWidth: 1.5 } : {}),
      }),
    );
    const artwork = createArtwork({ width: 128, height: 128 }, shapes);
    const compact = serialized(artwork);
    const naive = serializeNaiveSvg(artwork);
    expect(compact.length).toBeLessThan(naive.length * 0.6);
  });
});

describe('transform parsing', () => {
  it('reads the transforms SVG defines', () => {
    const translate = parseTransform('translate(10, 20)');
    expect(translate).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });

    const scale = parseTransform('scale(2)');
    expect(scale).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });

    const rotate = parseTransform('rotate(90)');
    expect(rotate?.a).toBeCloseTo(0, 9);
    expect(rotate?.b).toBeCloseTo(1, 9);
    expect(rotate?.c).toBeCloseTo(-1, 9);
  });

  it('composes a transform list left to right, like SVG', () => {
    const matrix = parseTransform('translate(10 0) scale(2)');
    expect(matrix?.a).toBe(2);
    expect(matrix?.e).toBe(10);
  });

  it('returns null for a transform it does not understand', () => {
    expect(parseTransform('wobble(3)')).toBeNull();
    expect(parseTransform('matrix(1 2 3)')).toBeNull();
  });
});

describe('import: supported elements', () => {
  it('imports a path with fills, strokes and a viewBox', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
        `<path d="M2 2 L22 2 L22 22 L2 22 Z" fill="#ff8800" stroke="#001122" stroke-width="2"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { artwork } = result.value;
    expect(artwork.width).toBe(24);
    expect(artwork.height).toBe(24);
    expect(artwork.viewBox).toEqual({ minX: 0, minY: 0, maxX: 24, maxY: 24 });
    expect(artwork.shapes).toHaveLength(1);
    expect(artwork.shapes[0]?.style.fill).toBe('#ff8800');
    expect(artwork.shapes[0]?.style.stroke).toBe('#001122');
    expect(artwork.shapes[0]?.style.strokeWidth).toBe(2);
    expect(toPathData(artwork.shapes[0]!.path)).toBe('M2 2L22 2 22 22 2 22Z');
    expect(result.value.issues).toEqual([]);
  });

  it('reads shapes from a style attribute as well as presentation attributes', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" style="fill:#abcdef;stroke:none;stroke-width:3"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shape = result.value.artwork.shapes[0];
    expect(shape?.style.fill).toBe('#abcdef');
    expect(shape?.style.stroke).toBeNull();
    expect(shape?.style.strokeWidth).toBe(3);
  });

  it('inherits presentation attributes from a group', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" fill="#112233" stroke="#445566" stroke-width="4">` +
        `<g fill-rule="evenodd"><path d="M0 0 L10 0 L10 10 Z"/></g></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artwork.shapes[0]?.style.fill).toBe('#112233');
    expect(result.value.artwork.shapes[0]?.style.stroke).toBe('#445566');
    expect(result.value.artwork.shapes[0]?.style.strokeWidth).toBe(4);
    expect(result.value.artwork.shapes[0]?.style.fillRule).toBe('evenodd');
  });

  it('converts rect, circle, ellipse, line, polyline and polygon into paths', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
        `<rect x="0" y="0" width="10" height="20"/>` +
        `<rect x="20" y="0" width="20" height="20" rx="5"/>` +
        `<circle cx="10" cy="50" r="5"/>` +
        `<ellipse cx="40" cy="50" rx="10" ry="5"/>` +
        `<line x1="0" y1="90" x2="10" y2="80"/>` +
        `<polyline points="20,90 30,80 40,90"/>` +
        `<polygon points="50,90 60,80 70,90"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shapes = result.value.artwork.shapes;
    expect(shapes).toHaveLength(7);
    expect(shapes[0]?.path.contours[0]?.nodes).toHaveLength(4);
    expect(shapes[1]?.path.contours[0]?.nodes).toHaveLength(8);
    expect(allSegments(shapes[2]!.path).every((segment) => segment.kind === 'cubic')).toBe(true);
    expect(shapes[3]?.path.contours[0]?.nodes).toHaveLength(4);
    expect(shapes[4]?.path.contours[0]?.closed).toBe(false);
    expect(shapes[5]?.path.contours[0]?.nodes).toHaveLength(3);
    expect(shapes[6]?.path.contours[0]?.closed).toBe(true);
    // The curve-less elements have exact geometry.
    expect(boundsOfPath(shapes[0]!.path)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 20 });
    expect(boundsOfPath(shapes[5]!.path)).toEqual({ minX: 20, minY: 80, maxX: 40, maxY: 90 });
  });

  it('applies transforms from groups and elements, in order', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(10 20)">` +
        `<rect width="10" height="10" transform="scale(2)"/></g></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(boundsOfPath(result.value.artwork.shapes[0]!.path)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 30,
      maxY: 40,
    });
  });

  it('reports arcs as approximated and still keeps their geometry close', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path d="M100 0 A100 100 0 0 1 0 100" fill="none" stroke="#000"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.approximated).toBe(true);
    expect(result.value.issues.some((issue) => issue.code === 'path.arcs')).toBe(true);
    const bounds = boundsOfPath(result.value.artwork.shapes[0]!.path);
    expect(bounds?.minX).toBeCloseTo(0, 1);
    expect(bounds?.maxY).toBeCloseTo(100, 1);
  });

  it('falls back to 100 × 100 when the file declares no size at all', () => {
    const result = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 0 L10 10 Z"/></svg>`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artwork.width).toBe(100);
    expect(result.value.issues.some((issue) => issue.code === 'size.missing')).toBe(true);
  });

  it('converts physical units to CSS pixels', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="72pt"><path d="M0 0 L1 0 L1 1 Z"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artwork.width).toBe(96);
    expect(result.value.artwork.height).toBe(96);
  });
});

describe('import: unsupported content is reported, never dropped silently', () => {
  it('lists unsupported elements and keeps the rest of the drawing', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` +
        `<text x="0" y="5" font-size="4">Hello</text>` +
        `<linearGradient id="g"><stop offset="0"/></linearGradient>` +
        `<path d="M0 0 L10 0 L10 10 Z"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artwork.shapes).toHaveLength(1);
    const codes = result.value.issues.map((issue) => issue.code);
    expect(codes).toContain('unsupported.text');
    expect(codes).toContain('unsupported.lineargradient');
    expect(result.value.issues.every((issue) => issue.message.length > 0)).toBe(true);
  });

  it('resolves currentColor and says so', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" color="#123456"><path d="M0 0 L10 0 L10 10 Z" fill="currentColor"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artwork.shapes[0]?.style.fill).toBe('#000000');
    expect(result.value.issues.some((issue) => issue.code === 'style.currentColor')).toBe(true);
  });

  it('reports an unknown paint rather than guessing a colour', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z" fill="url(#nope)"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issues.some((issue) => issue.code === 'style.unknown-paint')).toBe(true);
  });

  it('reports an unreadable transform and imports the shape untransformed', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z" transform="wobble(2)"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issues.some((issue) => issue.code === 'transform.unparsed')).toBe(true);
    expect(boundsOfPath(result.value.artwork.shapes[0]!.path)?.maxX).toBe(10);
  });

  it('skips a single malformed path with a message, keeping the valid ones', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` +
        `<path d="M0 0 L K 10"/>` +
        `<path d="M0 0 L10 0 L10 10 Z"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artwork.shapes).toHaveLength(1);
    const issue = result.value.issues.find((entry) => entry.code === 'path.invalid-d');
    expect(issue?.message).toContain('character');
  });

  it('reports skipped degenerate primitives', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` +
        `<rect width="0" height="10"/><circle cx="5" cy="5" r="0"/>` +
        `<path d="M0 0 L10 0 L10 10 Z"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codes = result.value.issues.map((issue) => issue.code);
    expect(codes).toContain('rect.degenerate');
    expect(codes).toContain('circle.degenerate');
  });
});

describe('import: safety', () => {
  const refusals: readonly { readonly name: string; readonly svg: string; readonly why: string }[] = [
    {
      name: 'script element',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><path d="M0 0 L10 0 L10 10 Z"/></svg>`,
      why: 'may not run code',
    },
    {
      name: 'event handler attribute',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z" onload="alert(1)"/></svg>`,
      why: 'may not run code',
    },
    {
      name: 'foreignObject',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject width="10" height="10"><div>hi</div></foreignObject></svg>`,
      why: 'may not run code',
    },
    {
      name: 'external reference',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><image xlink:href="https://example.com/track.png" width="10" height="10"/></svg>`,
      why: 'may not load external content',
    },
    {
      name: 'javascript URL',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z" fill="none" stroke="javascript:alert(1)"/></svg>`,
      why: 'may not contain script',
    },
    {
      name: 'DOCTYPE',
      svg: `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>`,
      why: 'DOCTYPE',
    },
  ];

  for (const refusal of refusals) {
    it(`refuses the whole file for a ${refusal.name}`, () => {
      const result = parseSvg(refusal.svg);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain(refusal.why);
    });
  }

  it('accepts an internal fragment reference, which loads nothing', () => {
    const result = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path id="p" d="M0 0 L10 0 L10 10 Z"/><use href="#p"/></svg>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `<use>` itself is unsupported artwork and is reported, but the file is not rejected.
    expect(result.value.issues.some((issue) => issue.code === 'unsupported.use')).toBe(true);
    expect(result.value.artwork.shapes).toHaveLength(1);
  });
});

describe('import: malformed files explain themselves', () => {
  it('rejects an empty string', () => {
    const result = parseSvg('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('empty');
  });

  it('rejects a file that is not SVG', () => {
    const result = parseSvg('<html><body>Hello</body></html>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('<svg>');
  });

  it('reports the position of a syntax error', () => {
    const result = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 0"<</svg>`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/character \d+/);
  });

  it('rejects an unclosed element', () => {
    const result = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0 L10 0"/></svg>`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('closed');
  });

  it('reports a file with nothing it can draw', () => {
    const result = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>x</text></svg>`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unsupported');
      expect(result.error.message).toContain('Nothing');
    }
  });

  it('refuses a file with a zero size', () => {
    const result = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="0" height="10"><path d="M0 0 L1 0 L1 1 Z"/></svg>`);
    expect(result.ok).toBe(false);
  });

  it('rejects a file over the byte limit without parsing it', () => {
    const huge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="${'M0 0 L1 0 '.repeat(300_000)}Z"/></svg>`;
    const result = parseSvg(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('import limit');
  });

  it('stops importing beyond the node budget and says so', () => {
    const block = '<path d="M0 0 L10 0 L10 10 L0 10 Z"/>'.repeat(2_500);
    const result = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${block}</svg>`);
    // Either the shape cap or the node cap fires; both are honest refusals with a message.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/more than|limit/);
  });
});

describe('round trip', () => {
  /** Tolerance the round trip is allowed: 1e-3 of a unit, the serialiser's default precision. */
  const ROUND_TRIP_TOLERANCE = 1e-3;

  /** Writes with shape names included, which is what the document exporter does. */
  function roundTripped(artwork: SvgArtwork): SvgArtwork {
    const written = serializeSvg(artwork, { includeNames: true });
    if (!written.ok) throw new Error(`Serialisation failed: ${written.error.message}`);
    const read = parseSvg(written.value);
    if (!read.ok) throw new Error(`Round trip failed: ${read.error.message}`);
    return read.value.artwork;
  }

  it('keeps the geometry of straight and curved artwork', () => {
    const artwork = artworkOfFixture();
    const back = roundTripped(artwork);
    expect(back.shapes).toHaveLength(artwork.shapes.length);

    artwork.shapes.forEach((shape, index) => {
      const original = boundsOfPath(shape.path);
      const roundTrippedShape = boundsOfPath(back.shapes[index]!.path);
      expect(original).not.toBeNull();
      expect(roundTrippedShape).not.toBeNull();
      expect(roundTrippedShape!.minX).toBeCloseTo(original!.minX, 3);
      expect(roundTrippedShape!.minY).toBeCloseTo(original!.minY, 3);
      expect(roundTrippedShape!.maxX).toBeCloseTo(original!.maxX, 3);
      expect(roundTrippedShape!.maxY).toBeCloseTo(original!.maxY, 3);
      expect(allSegments(back.shapes[index]!.path)).toHaveLength(allSegments(shape.path).length);
      expect(back.shapes[index]!.path.contours.length).toBe(shape.path.contours.length);
    });
  });

  it('keeps the style of straight and curved artwork', () => {
    const artwork = artworkOfFixture();
    const back = roundTripped(artwork);
    artwork.shapes.forEach((shape, index) => {
      const read = back.shapes[index]!.style;
      expect(read.fill).toBe(shape.style.fill);
      expect(read.fillRule).toBe(shape.style.fillRule);
      expect(read.stroke).toBe(shape.style.stroke);
      expect(read.strokeWidth).toBeCloseTo(shape.style.strokeWidth, 3);
      expect(read.lineCap).toBe(shape.style.lineCap);
      expect(read.lineJoin).toBe(shape.style.lineJoin);
      expect(read.dashArray.map((entry) => Math.round(entry * 100) / 100)).toEqual(
        shape.style.dashArray.map((entry) => Math.round(entry * 100) / 100),
      );
      expect(back.shapes[index]!.opacity).toBeCloseTo(shape.opacity, 3);
      expect(back.shapes[index]!.name).toBe(shape.name);
    });
  });

  it('keeps the viewBox and size', () => {
    const artwork = createArtwork(
      { width: 48, height: 32 },
      [createShape('Dot', pathOf('M1 1 L2 1 L2 2 Z').path, {})],
      { viewBox: { minX: -5, minY: -5, maxX: 43, maxY: 27 } },
    );
    const back = roundTripped(artwork);
    expect(back.width).toBe(48);
    expect(back.height).toBe(32);
    expect(back.viewBox).toEqual({ minX: -5, minY: -5, maxX: 43, maxY: 27 });
  });

  it('keeps layer names, so an exported icon set comes back with its own labels', () => {
    const back = roundTripped(artworkOfFixture());
    expect(back.shapes.map((shape) => shape.name)).toEqual(
      artworkOfFixture().shapes.map((shape) => shape.name),
    );
  });

  it('is stable: exporting what was imported twice produces the same bytes', () => {
    const once = roundTripped(artworkOfFixture());
    const first = serializeSvg(once, { includeNames: true });
    const twice = roundTripped(once);
    const second = serializeSvg(twice, { includeNames: true });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value).toBe(first.value);
  });

  it('keeps a circle within the flattening tolerance after export and import', () => {
    const circle = createArtwork({ width: 100, height: 100 }, [
      createShape('Circle', ellipsePath({ minX: 10, minY: 10, maxX: 90, maxY: 90 }), { fill: '#000000' }),
    ]);
    const back = roundTripped(circle);
    const original = back.shapes[0]!.path;
    expect(original.contours[0]?.nodes).toHaveLength(4);
    // The four cubic handles survive with the same precision the serialiser wrote.
    const expected = boundsOfPath(circle.shapes[0]!.path);
    const actual = boundsOfPath(original);
    expect(Math.abs((actual?.maxY ?? 0) - (expected?.maxY ?? 0))).toBeLessThan(ROUND_TRIP_TOLERANCE);
  });

  it('round-trips artwork that has been transformed', () => {
    const rotated = transformShape(
      createShape('Square', pathOf('M0 0 L100 0 L100 100 L0 100 Z').path, { fill: '#ff0000' }),
      { a: Math.cos(0.4), b: Math.sin(0.4), c: -Math.sin(0.4), d: Math.cos(0.4), e: 12, f: -3 },
    );
    const artwork = createArtwork({ width: 200, height: 200 }, [rotated]);
    const back = roundTripped(artwork);
    const before = boundsOfPath(rotated.path);
    const after = boundsOfPath(back.shapes[0]!.path);
    expect(after!.minX).toBeCloseTo(before!.minX, 3);
    expect(after!.maxY).toBeCloseTo(before!.maxY, 3);
    // Bounds of *transformed* geometry live in artwork space, which is what a re-import preserves.
    expect(artworkBounds(back)?.maxX).toBeCloseTo(artworkBounds(artwork)?.maxX ?? 0, 3);
  });

  it('round-trips a multi-contour path with a hole', () => {
    const donut = createArtwork({ width: 100, height: 100 }, [
      createShape(
        'Donut',
        pathOf('M10 10 L90 10 L90 90 L10 90 Z M30 30 L30 70 L70 70 L70 30 Z').path,
        { fill: '#222222', fillRule: 'evenodd' },
      ),
    ]);
    const back = roundTripped(donut);
    expect(back.shapes[0]?.path.contours).toHaveLength(2);
    expect(back.shapes[0]?.path.contours[1]?.nodes).toHaveLength(4);
    expect(back.shapes[0]?.style.fillRule).toBe('evenodd');
    expect(transformPath(back.shapes[0]!.path, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }).contours).toHaveLength(2);
  });

  it('does not round-trip text, and says so rather than pretending', () => {
    const asText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="0" y="5">Hi</text><path d="M0 0 L1 0 L1 1 Z"/></svg>`;
    const read = parseSvg(asText);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.issues.map((issue) => issue.code)).toContain('unsupported.text');
  });
});

describe('defaults are shared, not duplicated', () => {
  it('exports a single default style object', () => {
    expect(DEFAULT_SHAPE_STYLE.fill).toBe('#000000');
    expect(DEFAULT_SHAPE_STYLE.stroke).toBeNull();
    expect(DEFAULT_SHAPE_STYLE.fillOpacity).toBe(1);
    expect(DEFAULT_SHAPE_STYLE.dashArray).toEqual([]);
  });
});
