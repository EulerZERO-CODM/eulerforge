/**
 * Deterministic SVG serialisation.
 *
 * Three properties matter, in this order:
 *
 * 1. **Correct.** The file is a valid SVG document whose geometry is exactly the artwork's, with a
 *    `viewBox` that matches the shapes. Nothing is dropped to make the output smaller.
 * 2. **Deterministic.** The same artwork produces byte-identical output, always. That is what lets
 *    the export panel say "identical input, identical file", lets a test compare two serialisers
 *    and lets a user diff two exports.
 * 3. **Compact.** Attributes that equal their SVG default are omitted; a shape that needs no
 *    transform is written as a bare `<path>` rather than wrapped in a `<g>`; numbers are written
 *    with the least precision that still reproduces the geometry (three decimals by default, which
 *    is a thousandth of a unit — well below a pixel at any supported zoom).
 *
 * The naive serializer in `./naive.ts` exists purely to be a comparison target: the tests assert
 * that this one is smaller for representative artwork *and* that both files describe the same
 * geometry.
 */

import { toPathData } from '../vector/path-data';
import { boundsOfPath } from '../vector/bounds';
import type { VectorBox as Box } from '../vector/types';
import { resolveGradient, resolvePattern, type PaintSpec } from '../vector/paint';
import { stylePaintsSomething } from '../vector/style';
import { roundCoordinate } from '../vector/tolerance';
import type { SvgArtwork, SvgShape, SvgShapeStyle } from './artwork';
import { validateArtwork } from './artwork';
import { err, forgeError, ok, type Result } from '../result';

export type SerializeOptions = {
  /** Decimal places for coordinates and lengths. 3 keeps a thousandth of a unit. */
  readonly digits?: number;
  /** Write each shape's name in a `<title>` element inside its own `<g>`. Off by default. */
  readonly includeNames?: boolean;
  /** Write a background rectangle. Defaults to the artwork's own background. */
  readonly background?: string | null;
  /** Pretty-print with newlines and indentation. Off by default: smaller files win. */
  readonly pretty?: boolean;
};

/** Formats a number for an SVG attribute: no exponent, no trailing zeros, never "-0". */
export function formatSvgNumber(value: number, digits: number): string {
  const rounded = roundCoordinate(value, digits);
  if (Number.isInteger(rounded)) return String(rounded);
  return String(Number(rounded.toFixed(digits)));
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

function isDefaultFill(style: SvgShapeStyle): boolean {
  return style.fill !== null && style.fill.toLowerCase() === '#000000';
}

/**
 * Presentation attributes for a shape, omitting every value that equals the SVG default.
 *
 * The omissions are the whole of the "clean output" requirement, and each one is checked against
 * the specification's initial value rather than against what our own default happens to be — which
 * is why the defaults are spelled out next to the comparisons.
 */
function styleAttributes(
  style: SvgShapeStyle,
  digits: number,
  paintIds: { readonly fill: string | null; readonly stroke: string | null } = {
    fill: null,
    stroke: null,
  },
): readonly string[] {
  const attributes: string[] = [];

  if (paintIds.fill !== null) attributes.push(`fill="url(#${paintIds.fill})"`);
  else if (style.fill === null) attributes.push('fill="none"');
  else if (!isDefaultFill(style)) attributes.push(`fill="${escapeXmlAttribute(style.fill)}"`);

  if (style.fillRule !== 'nonzero') attributes.push(`fill-rule="${style.fillRule}"`);
  if (style.fillOpacity !== 1)
    attributes.push(`fill-opacity="${formatSvgNumber(style.fillOpacity, digits)}"`);

  if (paintIds.stroke !== null) {
    attributes.push(`stroke="url(#${paintIds.stroke})"`);
    if (style.strokeWidth !== 1)
      attributes.push(`stroke-width="${formatSvgNumber(style.strokeWidth, digits)}"`);
    if (style.strokeOpacity !== 1) {
      attributes.push(`stroke-opacity="${formatSvgNumber(style.strokeOpacity, digits)}"`);
    }
    if (style.lineCap !== 'butt') attributes.push(`stroke-linecap="${style.lineCap}"`);
    if (style.lineJoin !== 'miter') attributes.push(`stroke-linejoin="${style.lineJoin}"`);
    if (style.dashArray.length > 0) {
      attributes.push(
        `stroke-dasharray="${style.dashArray.map((entry) => formatSvgNumber(entry, digits)).join(' ')}"`,
      );
    }
  } else if (style.stroke !== null) {
    attributes.push(`stroke="${escapeXmlAttribute(style.stroke)}"`);
    if (style.strokeWidth !== 1)
      attributes.push(`stroke-width="${formatSvgNumber(style.strokeWidth, digits)}"`);
    if (style.strokeOpacity !== 1) {
      attributes.push(`stroke-opacity="${formatSvgNumber(style.strokeOpacity, digits)}"`);
    }
    if (style.lineCap !== 'butt') attributes.push(`stroke-linecap="${style.lineCap}"`);
    if (style.lineJoin !== 'miter') attributes.push(`stroke-linejoin="${style.lineJoin}"`);
    if (style.dashArray.length > 0) {
      attributes.push(
        `stroke-dasharray="${style.dashArray.map((entry) => formatSvgNumber(entry, digits)).join(' ')}"`,
      );
    }
  }

  return attributes;
}

function shapeElement(
  shape: SvgShape,
  options: Required<Pick<SerializeOptions, 'digits' | 'pretty' | 'includeNames'>>,
  indent: string,
  paintIds: { readonly fill: string | null; readonly stroke: string | null } = {
    fill: null,
    stroke: null,
  },
): string {
  const data = toPathData(shape.path, { digits: options.digits });
  const attributes = [`d="${data}"`, ...styleAttributes(shape.style, options.digits, paintIds)];
  if (shape.opacity !== 1)
    attributes.push(`opacity="${formatSvgNumber(shape.opacity, options.digits)}"`);

  const element = `${indent}<path ${attributes.join(' ')}/>`;
  if (!options.includeNames) return element;
  const title = `${indent}<title>${escapeXmlText(shape.name)}</title>`;
  return options.pretty
    ? `${indent}<g>\n${title}\n${element}\n${indent}</g>`
    : `${indent}<g>${title}${element}</g>`;
}

/**
 * Serialises artwork to a complete SVG document.
 *
 * Fails rather than writing a file when the artwork has a non-finite or non-positive size, or a
 * shape whose geometry is structurally invalid: "a file was produced" is not the same claim as
 * "the file is correct".
 */
export function serializeSvg(artwork: SvgArtwork, options: SerializeOptions = {}): Result<string> {
  const validated = validateArtwork(artwork);
  if (!validated.ok) return err(validated.error);

  const digits = options.digits ?? 3;
  const pretty = options.pretty ?? false;
  const includeNames = options.includeNames ?? false;
  const background = options.background === undefined ? artwork.background : options.background;
  const { minX, minY, maxX, maxY } = artwork.viewBox;

  const header =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatSvgNumber(artwork.width, digits)}" ` +
    `height="${formatSvgNumber(artwork.height, digits)}" viewBox="${formatSvgNumber(minX, digits)} ` +
    `${formatSvgNumber(minY, digits)} ${formatSvgNumber(maxX - minX, digits)} ${formatSvgNumber(maxY - minY, digits)}">`;

  const parts: string[] = [header];
  const backgroundShape: SvgShape | null =
    background === null
      ? null
      : {
          name: 'Background',
          path: {
            contours: [
              {
                nodes: [
                  { point: { x: minX, y: minY }, handleIn: null, handleOut: null },
                  { point: { x: maxX, y: minY }, handleIn: null, handleOut: null },
                  { point: { x: maxX, y: maxY }, handleIn: null, handleOut: null },
                  { point: { x: minX, y: maxY }, handleIn: null, handleOut: null },
                ],
                closed: true,
              },
            ],
          },
          style: {
            fill: background,
            fillRule: 'nonzero',
            fillOpacity: 1,
            stroke: null,
            strokeWidth: 1,
            strokeOpacity: 1,
            lineCap: 'butt',
            lineJoin: 'miter',
            dashArray: [],
          },
          opacity: 1,
        };

  const shapes = backgroundShape === null ? artwork.shapes : [backgroundShape, ...artwork.shapes];
  const indent = pretty ? '  ' : '';
  /* Gradients and patterns are written once, into `<defs>`, and referenced by id from the shapes that
     use them. Ids are positional (`paint-1`, `paint-2`, …) so two exports of the same artwork are
     byte-identical, and the reference is a same-document `url(#…)` — never a URL, so an exported file
     cannot ask a viewer to fetch anything. */
  const definitions: string[] = [];
  let paintCount = 0;
  const allocate = (paint: PaintSpec | null | undefined, box: Box): string | null => {
    if (!paint || paint.kind === 'solid') return null;
    paintCount += 1;
    const id = `paint-${String(paintCount)}`;
    definitions.push(paintDefinition(id, paint, box, { digits, pretty }, pretty ? '  ' : ''));
    return id;
  };

  const geometry: string[] = [];
  for (const shape of shapes) {
    // A shape with no geometry is skipped with the same outcome as an empty `<path>`: nothing painted.
    if (shape.path.contours.length === 0) continue;
    if (!stylePaintsSomething(shape.style)) continue;
    const box = boundsOfPath(shape.path);
    const valid = box ?? { minX, minY, maxX, maxY };
    const fillId = allocate(shape.style.fillPaint, valid);
    const strokeId = allocate(shape.style.strokePaint, valid);
    geometry.push(
      shapeElement(shape, { digits, pretty, includeNames }, indent, {
        fill: fillId,
        stroke: strokeId,
      }),
    );
  }

  if (definitions.length > 0) {
    parts.push(pretty ? '<defs>' : '<defs>');
    parts.push(...definitions);
    parts.push('</defs>');
  }
  parts.push(...geometry);
  parts.push('</svg>');

  return ok(pretty ? parts.join('\n') : parts.join(''));
}

/**
 * One gradient or pattern, as an SVG definition.
 *
 * `userSpaceOnUse` with absolute coordinates (rather than `objectBoundingBox`) is deliberate: the
 * canvas painter resolves the same fractions against the same bounds, so the file and the preview
 * describe identical geometry, and a viewer that computes bounding boxes differently cannot shift a
 * gradient off its shape.
 */
function paintDefinition(
  id: string,
  paint: PaintSpec,
  box: Box,
  options: Required<Pick<SerializeOptions, 'digits' | 'pretty'>>,
  indent: string,
): string {
  const { digits, pretty } = options;
  const n = (value: number): string => formatSvgNumber(value, digits);

  if (paint.kind === 'linear-gradient') {
    const resolved = resolveGradient(paint, box);
    if (resolved.kind === 'linear') {
      const stops = resolved.stops
        .map(
          (stop) =>
            `${indent}  <stop offset="${n(stop.offset)}" stop-color="${escapeXmlAttribute(stop.color)}"/>`,
        )
        .join(pretty ? '\n' : '');
      return `${indent}<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(resolved.x1)}" y1="${n(resolved.y1)}" x2="${n(resolved.x2)}" y2="${n(resolved.y2)}">${pretty ? `\n${stops}\n${indent}` : stops}</linearGradient>`;
    }
  }

  if (paint.kind === 'radial-gradient') {
    const resolved = resolveGradient(paint, box);
    if (resolved.kind === 'radial') {
      const stops = resolved.stops
        .map(
          (stop) =>
            `${indent}  <stop offset="${n(stop.offset)}" stop-color="${escapeXmlAttribute(stop.color)}"/>`,
        )
        .join(pretty ? '\n' : '');
      return `${indent}<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(resolved.cx)}" cy="${n(resolved.cy)}" r="${n(resolved.radius)}">${pretty ? `\n${stops}\n${indent}` : stops}</radialGradient>`;
    }
  }

  // A pattern: the tile is the motif's primitives, written in the same order the painter draws them.
  const pattern = paint as Extract<PaintSpec, { kind: 'pattern' }>;
  const resolved = resolvePattern(pattern, box);
  const body: string[] = [];
  if (resolved.background !== null) {
    body.push(
      `${indent}  <rect x="0" y="0" width="${n(resolved.tile)}" height="${n(resolved.tile)}" fill="${escapeXmlAttribute(resolved.background)}"/>`,
    );
  }
  for (const primitive of resolved.primitives) {
    if (primitive.kind === 'rect') {
      body.push(
        `${indent}  <rect x="${n(primitive.x)}" y="${n(primitive.y)}" width="${n(primitive.width)}" height="${n(primitive.height)}" fill="${escapeXmlAttribute(primitive.color)}"/>`,
      );
    } else {
      body.push(
        `${indent}  <circle cx="${n(primitive.cx)}" cy="${n(primitive.cy)}" r="${n(primitive.radius)}" fill="${escapeXmlAttribute(primitive.color)}"/>`,
      );
    }
  }
  const transform =
    resolved.rotation === 0
      ? ''
      : ` patternTransform="rotate(${n(resolved.rotation)} ${n(resolved.pivot.x)} ${n(resolved.pivot.y)})"`;
  /* The motif's parameters are also written as an attribute. A pattern drawn as primitives is
     unambiguous to a viewer but ambiguous to an *importer*: stripes, a grid and arbitrary artwork
     can produce the same rectangles. Carrying the model's own description makes a re-import exact,
     and every viewer ignores an attribute it does not know. */
  const annotation = escapeXmlAttribute(
    JSON.stringify({
      kind: 'pattern',
      motif: resolved.motif,
      foreground: pattern.foreground,
      background: pattern.background,
      scale: pattern.scale,
      rotation: resolved.rotation,
    }),
  );
  const viewBox =
    box.maxX - box.minX === 0 && box.maxY - box.minY === 0
      ? ''
      : ` x="${n(resolved.grid.x)}" y="${n(resolved.grid.y)}"`;
  return `${indent}<pattern id="${id}" patternUnits="userSpaceOnUse"${viewBox} width="${n(resolved.tile)}" height="${n(resolved.tile)}" data-forge-pattern="${annotation}"${transform}>${pretty ? `\n${body.join('\n')}\n${indent}` : body.join('')}</pattern>`;
}

/**
 * An icon-set sprite: one `<symbol>` per icon, plus a `<view>`-friendly root.
 *
 * A sprite is the artefact an icon set is actually used as — `<use href="sprite.svg#name">` — and it
 * keeps every icon's geometry in one file, which is why it is offered next to the per-icon files
 * rather than instead of them. `id` values are derived from the shape names, sanitised to the
 * XML name rules and de-duplicated deterministically.
 */
export type IconEntry = {
  readonly name: string;
  readonly artwork: SvgArtwork;
};

export function iconIdFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'icon';
}

export function serializeIconSprite(
  entries: readonly IconEntry[],
  options: SerializeOptions = {},
): Result<string> {
  if (entries.length === 0) {
    return err(forgeError('validation-failed', 'An icon set needs at least one icon.'));
  }

  const digits = options.digits ?? 3;
  const used = new Map<string, number>();
  const symbols: string[] = [];

  for (const entry of entries) {
    const validated = validateArtwork(entry.artwork);
    if (!validated.ok) return err(validated.error);

    const base = iconIdFor(entry.name);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${String(seen + 1)}`;

    const { minX, minY, maxX, maxY } = entry.artwork.viewBox;
    const body = entry.artwork.shapes
      .filter((shape) => shape.path.contours.length > 0)
      .map((shape) => shapeElement(shape, { digits, pretty: false, includeNames: false }, ''))
      .join('');
    symbols.push(
      `<symbol id="${escapeXmlAttribute(id)}" viewBox="${formatSvgNumber(minX, digits)} ${formatSvgNumber(minY, digits)} ${formatSvgNumber(maxX - minX, digits)} ${formatSvgNumber(maxY - minY, digits)}"><title>${escapeXmlText(entry.name)}</title>${body}</symbol>`,
    );
  }

  return ok(
    `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join('')}</svg>`,
  );
}
