/**
 * SVG import: a safe, dependency-free reader for the subset this platform supports.
 *
 * ## Why a hand-written parser
 *
 * `DOMParser` is a DOM API and `src/core/**` may not touch one (ADR-0019), and an imported file is
 * untrusted input that must be handled identically in a Node test and in a browser. A small
 * tokeniser over elements and attributes gives both, with error messages that name the element and
 * the position.
 *
 * ## Safety, in order of severity
 *
 * - **Refused outright** (the whole file is rejected): `<script>`, `<foreignObject>`, `<iframe>`,
 *   `<embed>`, `<object>`, any `on*` event-handler attribute, any external reference
 *   (`href`/`xlink:href` with a scheme, a protocol-relative URL or a `//`-rooted path), a
 *   `<!DOCTYPE`/`<!ENTITY` declaration, and a `javascript:`/`data:text/html` value anywhere.
 *   These are the things that turn "import an icon" into "run someone's code", and a partial import
 *   of a file that contains them would be the worst of both worlds.
 * - **Ignored with a report** (the file imports, the feature is listed): unsupported *drawing*
 *   elements (`<text>`, `<image>`, `<use>`, `<filter>`, `<style>`, animation elements …) and
 *   unsupported attributes. Nothing is dropped silently: every one appears in `issues`.
 * - **Approximated with a report**: elliptical arcs become cubics, `currentColor` resolves to the
 *   inherited colour, and unknown paint falls back to black. Each is reported once with a code.
 *
 * ## Limits
 *
 * A file is bounded by bytes, element count, shapes, and total path nodes before parsing, so a
 * hostile file fails fast instead of exhausting the tab.
 */

import {
  PATH_TEXT_LIMITS,
  normalisePathText,
  type FontStackId,
  type PathText,
  type PathTextBaseline,
} from '../documents/layer-types';
import { createPath, MAX_NODES_TOTAL, type VectorPath } from '../vector/types';
import { parsePathData } from '../vector/path-data';
import type { PaintSpec, PatternPaint } from '../vector/paint';
import { boundsOfPath } from '../vector/bounds';
import type { VectorBox } from '../vector/types';
import { createShape, type SvgArtwork, type SvgShape, type SvgShapeStyle } from './artwork';
import { layoutPathText } from '../vector/path-text';
import { ellipsePath, linePath, rectanglePath } from '../vector/shapes';
import { apply, matrix, transformPath, type Matrix } from '../vector/transform';
import { createArtwork } from './artwork';
import { SVG_LIMITS } from './limits';
import { err, forgeError, ok, type Result } from '../result';

export type SvgIssueSeverity = 'info' | 'warning' | 'approximated' | 'ignored';

export type SvgIssue = {
  readonly severity: SvgIssueSeverity;
  /** Stable identifier so the UI can group issues rather than printing a wall of prose. */
  readonly code: string;
  readonly message: string;
};

export type SvgImportResult = {
  readonly artwork: SvgArtwork;
  readonly issues: readonly SvgIssue[];
  /** Element names encountered, for diagnostics and tests. */
  readonly elements: readonly string[];
  /** True when the file contained something that forced an approximation (arcs, currentColor …). */
  readonly approximated: boolean;
};

/** Elements that must never appear in an imported file. */
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'handler',
  'listener',
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
]);

/** Drawing elements that are recognised but not supported: reported, never silently dropped. */
const UNSUPPORTED_ELEMENTS = new Set([
  'image',
  'use',
  'symbol',
  'marker',
  'pattern',
  'filter',
  'mask',
  'clippath',
  'lineargradient',
  'radialgradient',
  'style',
  'switch',
  'flowroot',
  'meshgradient',
  'hatch',
]);

/** Attributes whose value is a reference; a scheme or a rooted path is refused. */
const REFERENCE_ATTRIBUTES = new Set([
  'href',
  'xlink:href',
  'src',
  'xlink:show',
  'from',
  'to',
  'values',
]);

const NAMED_COLOURS: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  navy: '#000080',
  teal: '#008080',
  purple: '#800080',
  orange: '#ffa500',
  transparent: 'transparent',
};

type RawElement = {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly RawElement[];
  /** Text content, used for `<title>` only. */
  readonly text: string;
  readonly position: number;
};

class XmlError extends Error {
  public constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message);
  }
}

class XmlScanner {
  public position = 0;

  public constructor(private readonly source: string) {}

  public parse(): RawElement {
    this.skipProlog();
    const root = this.parseElement();
    if (!root) throw new XmlError('The file has no root element.', 0);
    return root;
  }

  /** Skips the XML declaration, comments, doctypes and processing instructions. */
  private skipProlog(): void {
    for (;;) {
      this.skipWhitespace();
      const rest = this.source.slice(this.position);
      if (rest.startsWith('<?')) {
        const end = this.source.indexOf('?>', this.position);
        if (end < 0) throw new XmlError('Unterminated processing instruction.', this.position);
        this.position = end + 2;
        continue;
      }
      if (rest.startsWith('<!--')) {
        const end = this.source.indexOf('-->', this.position);
        if (end < 0) throw new XmlError('Unterminated comment.', this.position);
        this.position = end + 3;
        continue;
      }
      if (rest.startsWith('<!')) {
        // DOCTYPE and ENTITY declarations: an entity-expansion attack surface, and nothing this
        // importer needs. Reported as a hard failure rather than skipped quietly.
        throw new XmlError(
          'The file contains a DOCTYPE or entity declaration, which is not accepted in an imported SVG.',
          this.position,
        );
      }
      return;
    }
  }

  private skipWhitespace(): void {
    while (this.position < this.source.length) {
      const character = this.source[this.position];
      if (character !== undefined && /\s/.test(character)) {
        this.position += 1;
        continue;
      }
      break;
    }
  }

  private parseName(): string {
    const start = this.position;
    const match = /^[A-Za-z_:][-A-Za-z0-9_:.]*/.exec(this.source.slice(this.position));
    if (!match) throw new XmlError('Expected an element or attribute name.', this.position);
    this.position += match[0].length;
    if (this.position === start) throw new XmlError('Empty name.', this.position);
    return match[0];
  }

  private parseAttributes(): Map<string, string> {
    const attributes = new Map<string, string>();
    for (;;) {
      this.skipWhitespace();
      const character = this.source[this.position];
      if (character === '>' || character === '/' || character === undefined) return attributes;
      const name = this.parseName();
      this.skipWhitespace();
      if (this.source[this.position] !== '=') {
        throw new XmlError(`Attribute "${name}" has no value.`, this.position);
      }
      this.position += 1;
      this.skipWhitespace();
      const quote = this.source[this.position];
      if (quote !== '"' && quote !== "'") {
        throw new XmlError(`Attribute "${name}" must be quoted.`, this.position);
      }
      this.position += 1;
      const end = this.source.indexOf(quote, this.position);
      if (end < 0) throw new XmlError(`Attribute "${name}" is not closed.`, this.position);
      const value = this.source.slice(this.position, end);
      this.position = end + 1;
      if (!attributes.has(name)) attributes.set(name, decodeEntities(value));
    }
  }

  private parseElement(): RawElement | null {
    this.skipWhitespace();
    if (this.source[this.position] !== '<') return null;
    const start = this.position;
    this.position += 1;
    const name = this.parseName();
    const attributes = this.parseAttributes();
    this.skipWhitespace();

    if (this.source[this.position] === '/' && this.source[this.position + 1] === '>') {
      this.position += 2;
      return { name, attributes, children: [], text: '', position: start };
    }
    if (this.source[this.position] !== '>') {
      throw new XmlError(`Element "${name}" is not closed.`, this.position);
    }
    this.position += 1;

    const children: RawElement[] = [];
    let text = '';
    for (;;) {
      const textStart = this.position;
      const nextTag = this.source.indexOf('<', this.position);
      if (nextTag < 0) throw new XmlError(`Element "${name}" is never closed.`, start);
      if (nextTag > textStart) {
        text += decodeEntities(this.source.slice(textStart, nextTag));
        this.position = nextTag;
      }
      const rest = this.source.slice(this.position);
      if (rest.startsWith('</')) {
        this.position += 2;
        const closing = this.parseName();
        this.skipWhitespace();
        if (this.source[this.position] !== '>')
          throw new XmlError(`Closing tag for "${closing}" is malformed.`, this.position);
        this.position += 1;
        if (closing.toLowerCase() !== name.toLowerCase()) {
          throw new XmlError(`Element "${name}" is closed by "${closing}".`, this.position);
        }
        return { name, attributes, children, text, position: start };
      }
      if (rest.startsWith('<!--')) {
        const end = this.source.indexOf('-->', this.position);
        if (end < 0) throw new XmlError('Unterminated comment.', this.position);
        this.position = end + 3;
        continue;
      }
      if (rest.startsWith('<?')) {
        const end = this.source.indexOf('?>', this.position);
        if (end < 0) throw new XmlError('Unterminated processing instruction.', this.position);
        this.position = end + 2;
        continue;
      }
      if (rest.startsWith('<!')) {
        throw new XmlError('The file contains a declaration inside an element.', this.position);
      }
      const child = this.parseElement();
      if (!child) throw new XmlError(`Element "${name}" is never closed.`, start);
      children.push(child);
    }
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, '&');
}

/** Parses a `transform` attribute into a matrix, or `null` when it cannot be understood. */
export function parseTransform(value: string): Matrix | null {
  let result = matrix(1, 0, 0, 1, 0, 0);
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    matched = true;
    const name = (match[1] ?? '').toLowerCase();
    const numbers = (match[2] ?? '')
      .split(/[\s,]+/)
      .filter((entry) => entry.length > 0)
      .map(Number)
      .filter((entry) => Number.isFinite(entry));

    const step = ((): Matrix | null => {
      switch (name) {
        case 'matrix': {
          if (numbers.length !== 6) return null;
          const [a, b, c, d, e, f] = numbers as [number, number, number, number, number, number];
          return matrix(a, b, c, d, e, f);
        }
        case 'translate': {
          const [tx = 0, ty = 0] = numbers;
          return matrix(1, 0, 0, 1, tx, ty);
        }
        case 'scale': {
          const [sx = 1, sy = sx] = numbers;
          return matrix(sx, 0, 0, sy, 0, 0);
        }
        case 'rotate': {
          const [angle = 0, cx = 0, cy = 0] = numbers;
          const radians = (angle * Math.PI) / 180;
          const cos = Math.cos(radians);
          const sin = Math.sin(radians);
          return matrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy);
        }
        case 'skewx': {
          const [angle = 0] = numbers;
          return matrix(1, 0, Math.tan((angle * Math.PI) / 180), 1, 0, 0);
        }
        case 'skewy': {
          const [angle = 0] = numbers;
          return matrix(1, Math.tan((angle * Math.PI) / 180), 0, 1, 0, 0);
        }
        default:
          return null;
      }
    })();

    if (!step) return null;
    // SVG applies transforms left to right, each in the coordinate system of the previous one.
    result = apply(result, step);
  }
  return matched ? result : null;
}

function parseLength(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*(px|pt|pc|mm|cm|in|%)?\s*$/i.exec(
    value,
  );
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const unit = (match[2] ?? '').toLowerCase();
  switch (unit) {
    case '':
    case 'px':
      return number;
    case 'pt':
      return (number * 96) / 72;
    case 'pc':
      return number * 16;
    case 'mm':
      return (number * 96) / 25.4;
    case 'cm':
      return (number * 96) / 2.54;
    case 'in':
      return number * 96;
    default:
      // Percentages depend on the viewport, which the file does not fix for us: refusing is
      // honest, guessing would change the artwork's size.
      return null;
  }
}

/**
 * Mutable while attributes are read one at a time, then frozen by `createShape`.
 *
 * Every field is present from the root element onwards, because "no fill" is a real, inherited
 * state: an explicit `fill="none"` must survive as `null` rather than falling back to the SVG
 * initial value of black.
 */
type StyleAccumulator = { -readonly [Key in keyof SvgShapeStyle]: SvgShapeStyle[Key] } & {
  unknown: string[];
  /** Id of a paint definition the shape references, resolved once its bounds are known. */
  fillPaintRef?: string | null;
  strokePaintRef?: string | null;
};

/**
 * A paint definition as the file states it.
 *
 * `fraction` definitions use SVG's `objectBoundingBox` units, which are already the stored
 * model's fractions. `user` definitions are in absolute coordinates and are converted against
 * the bounds of the shape that references them.
 */
type PaintDefinition =
  | { readonly units: 'fraction'; readonly paint: PaintSpec }
  | { readonly units: 'user'; readonly paint: PaintSpec; readonly tile: number | null };

/** Definitions declared in the file, by id. Only same-document references are ever followed. */
type PaintRegistry = ReadonlyMap<string, PaintDefinition>;

function parseColour(
  value: string,
  inherited: string | null,
  issues: SvgIssue[],
  code: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'none') return null;
  if (trimmed.toLowerCase() === 'currentcolor') {
    issues.push({
      severity: 'approximated',
      code: `${code}.currentColor`,
      message: `"currentColor" was resolved to ${inherited ?? '#000000'}: the imported drawing has no CSS context.`,
    });
    return inherited ?? '#000000';
  }
  if (trimmed === 'transparent') return null;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r ?? '0'}${r ?? '0'}${g ?? '0'}${g ?? '0'}${b ?? '0'}${b ?? '0'}`.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  const rgb = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(trimmed);
  if (rgb) {
    const toHex = (part: string): string => {
      const value255 = Math.max(0, Math.min(255, Math.round(Number(part))));
      return value255.toString(16).padStart(2, '0');
    };
    return `#${toHex(rgb[1] ?? '0')}${toHex(rgb[2] ?? '0')}${toHex(rgb[3] ?? '0')}`;
  }
  const named = NAMED_COLOURS[trimmed.toLowerCase()];
  if (named) return named === 'transparent' ? null : named;

  issues.push({
    severity: 'warning',
    code: `${code}.unknown-paint`,
    message: `Paint "${trimmed}" is not supported and was replaced with black.`,
  });
  return '#000000';
}

function parseNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = parseLength(value);
  return parsed;
}

/**
 * Resolves `url(#id)` to a definition declared in the same document.
 *
 * Any other URL — `url(http://…)`, `url(image.png)`, an unparsable fragment or an id that is not
 * in the file — returns null and falls through to the colour parser, which reports it. An imported
 * file can therefore reference paint only by id inside itself, never a resource.
 */
function paintReference(value: string, paints: PaintRegistry): string | null {
  const match = /^url\(\s*#([^)\s]+)\s*\)$/i.exec(value.trim());
  if (!match) return null;
  const id = match[1];
  if (id === undefined) return null;
  return paints.has(id) ? id : null;
}

function styleFromAttributes(
  attributes: ReadonlyMap<string, string>,
  inherited: StyleAccumulator,
  issues: SvgIssue[],
  inheritedColour: string | null,
  code: string,
  paints: PaintRegistry = new Map(),
): StyleAccumulator {
  const declarations = new Map<string, string>();
  const styleAttribute = attributes.get('style');
  if (styleAttribute) {
    for (const declaration of styleAttribute.split(';')) {
      const [property, value] = declaration.split(':');
      if (!property || value === undefined) continue;
      declarations.set(property.trim().toLowerCase(), value.trim());
    }
  }

  const read = (name: string): string | undefined => declarations.get(name) ?? attributes.get(name);

  const style: StyleAccumulator = { ...inherited, unknown: inherited.unknown };
  const unknown: string[] = [...inherited.unknown];

  const fills = read('fill');
  if (fills !== undefined) {
    const reference = paintReference(fills, paints);
    if (reference !== null) style.fillPaintRef = reference;
    else style.fill = parseColour(fills, inheritedColour, issues, code);
  }

  const stroke = read('stroke');
  if (stroke !== undefined) {
    const reference = paintReference(stroke, paints);
    if (reference !== null) style.strokePaintRef = reference;
    else style.stroke = parseColour(stroke, inheritedColour, issues, code);
  }

  const fillRule = read('fill-rule');
  if (fillRule === 'evenodd' || fillRule === 'nonzero') style.fillRule = fillRule;

  const strokeWidth = parseNumberOrNull(read('stroke-width'));
  if (strokeWidth !== null && strokeWidth >= 0) style.strokeWidth = strokeWidth;

  const fillOpacity = parseNumberOrNull(read('fill-opacity'));
  if (fillOpacity !== null) style.fillOpacity = Math.min(1, Math.max(0, fillOpacity));

  const strokeOpacity = parseNumberOrNull(read('stroke-opacity'));
  if (strokeOpacity !== null) style.strokeOpacity = Math.min(1, Math.max(0, strokeOpacity));

  const lineCap = read('stroke-linecap');
  if (lineCap === 'butt' || lineCap === 'round' || lineCap === 'square') style.lineCap = lineCap;

  const lineJoin = read('stroke-linejoin');
  if (
    lineJoin === 'miter' ||
    lineJoin === 'round' ||
    lineJoin === 'bevel' ||
    lineJoin === 'miter-clip'
  ) {
    style.lineJoin = lineJoin;
  }

  const dash = read('stroke-dasharray');
  if (dash !== undefined) {
    if (dash.trim() === 'none') style.dashArray = [];
    else {
      const values = dash
        .split(/[\s,]+/)
        .filter((entry) => entry.length > 0)
        .map(Number)
        .filter((entry) => Number.isFinite(entry) && entry >= 0);
      style.dashArray = values;
    }
  }

  for (const [attribute] of attributes) {
    const name = attribute.toLowerCase();
    if (
      name === 'style' ||
      name.startsWith('aria-') ||
      name === 'id' ||
      name === 'class' ||
      name === 'transform' ||
      name === 'd' ||
      name === 'x' ||
      name === 'y' ||
      name === 'width' ||
      name === 'height' ||
      name === 'rx' ||
      name === 'ry' ||
      name === 'cx' ||
      name === 'cy' ||
      name === 'r' ||
      name === 'points' ||
      name === 'x1' ||
      name === 'y1' ||
      name === 'x2' ||
      name === 'y2' ||
      name === 'viewbox' ||
      name === 'xmlns' ||
      name === 'xmlns:xlink' ||
      name === 'version' ||
      name === 'preserveaspectratio' ||
      name === 'xml:space'
    ) {
      continue;
    }
    if (
      name === 'fill' ||
      name === 'fill-rule' ||
      name === 'fill-opacity' ||
      name === 'stroke' ||
      name === 'stroke-width' ||
      name === 'stroke-opacity' ||
      name === 'stroke-linecap' ||
      name === 'stroke-linejoin' ||
      name === 'stroke-dasharray' ||
      name === 'opacity'
    ) {
      continue;
    }
    unknown.push(attribute);
  }

  style.unknown = unknown;
  return style;
}

/** Text read from a `<text><textPath>` element, waiting for its target shape. */
type PendingPathText = {
  readonly targetId: string;
  readonly text: PathText;
  /** SVG allows a length here; converting it needs the contour, which is only known at resolution. */
  readonly absoluteOffset: number | null;
};

type WalkContext = {
  readonly matrixValue: Matrix;
  readonly style: StyleAccumulator;
  readonly paints: PaintRegistry;
  readonly opacity: number;
  readonly issues: SvgIssue[];
  readonly elements: string[];
  /** Name from the enclosing group's `<title>`, used when an element has no id of its own. */
  readonly title: string | null;
  shapes: SvgShape[];
  /** Ids parallel to `shapes`, so a `<textPath>` reference can find its target after the walk. */
  shapeIds: (string | null)[];
  pendingText: PendingPathText[];
  nodes: number;
};

/** The text of an element's direct `<title>` child, or null. */
function titleOf(element: RawElement): string | null {
  const title = element.children.find((child) => child.name.toLowerCase() === 'title');
  if (!title) return null;
  const text = title.text.trim();
  return text.length > 0 ? text : null;
}

function geometryFor(element: RawElement, issues: SvgIssue[]): VectorPath | null {
  switch (element.name.toLowerCase()) {
    case 'path': {
      const data = element.attributes.get('d');
      if (data === undefined) {
        issues.push({
          severity: 'warning',
          code: 'path.missing-d',
          message: '<path> without a "d" attribute was skipped.',
        });
        return null;
      }
      const parsed = parsePathData(data);
      if (!parsed.ok) {
        issues.push({
          severity: 'warning',
          code: 'path.invalid-d',
          message: `A <path> was skipped: ${parsed.error.message}`,
        });
        return null;
      }
      if (parsed.value.approximatedArcs > 0) {
        issues.push({
          severity: 'approximated',
          code: 'path.arcs',
          message: `${String(parsed.value.approximatedArcs)} elliptical arc(s) were converted to cubic curves.`,
        });
      }
      return parsed.value.path;
    }
    case 'rect': {
      const x = parseLength(element.attributes.get('x')) ?? 0;
      const y = parseLength(element.attributes.get('y')) ?? 0;
      const width = parseLength(element.attributes.get('width'));
      const height = parseLength(element.attributes.get('height'));
      if (width === null || height === null || width <= 0 || height <= 0) {
        issues.push({
          severity: 'warning',
          code: 'rect.degenerate',
          message: 'A <rect> with no width or height was skipped.',
        });
        return null;
      }
      const rx =
        parseLength(element.attributes.get('rx')) ?? parseLength(element.attributes.get('ry')) ?? 0;
      const ry = parseLength(element.attributes.get('ry')) ?? rx;
      const radius = Math.max(0, Math.min(rx, ry));
      if (radius > 0 && Math.abs(rx - ry) > 0.001) {
        issues.push({
          severity: 'approximated',
          code: 'rect.elliptical-corners',
          message:
            'A <rect> with different x and y corner radii was imported with the smaller of the two.',
        });
      }
      return rectanglePath({ minX: x, minY: y, maxX: x + width, maxY: y + height }, radius);
    }
    case 'circle': {
      const cx = parseLength(element.attributes.get('cx')) ?? 0;
      const cy = parseLength(element.attributes.get('cy')) ?? 0;
      const r = parseLength(element.attributes.get('r'));
      if (r === null || r <= 0) {
        issues.push({
          severity: 'warning',
          code: 'circle.degenerate',
          message: 'A <circle> with no radius was skipped.',
        });
        return null;
      }
      return ellipsePath({ minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r });
    }
    case 'ellipse': {
      const cx = parseLength(element.attributes.get('cx')) ?? 0;
      const cy = parseLength(element.attributes.get('cy')) ?? 0;
      const rx = parseLength(element.attributes.get('rx'));
      const ry = parseLength(element.attributes.get('ry'));
      if (rx === null || ry === null || rx <= 0 || ry <= 0) {
        issues.push({
          severity: 'warning',
          code: 'ellipse.degenerate',
          message: 'An <ellipse> with no radius was skipped.',
        });
        return null;
      }
      return ellipsePath({ minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry });
    }
    case 'line': {
      const x1 = parseLength(element.attributes.get('x1')) ?? 0;
      const y1 = parseLength(element.attributes.get('y1')) ?? 0;
      const x2 = parseLength(element.attributes.get('x2')) ?? 0;
      const y2 = parseLength(element.attributes.get('y2')) ?? 0;
      return linePath({ x: x1, y: y1 }, { x: x2, y: y2 });
    }
    case 'polyline':
    case 'polygon': {
      const points = (element.attributes.get('points') ?? '')
        .split(/[\s,]+/)
        .filter((entry) => entry.length > 0)
        .map(Number);
      if (points.length < 4) {
        issues.push({
          severity: 'warning',
          code: 'polygon.degenerate',
          message: `A <${element.name}> with fewer than two points was skipped.`,
        });
        return null;
      }
      const nodes = [];
      for (let index = 0; index + 1 < points.length; index += 2) {
        const x = points[index];
        const y = points[index + 1];
        if (x === undefined || y === undefined) continue;
        nodes.push({ point: { x, y }, handleIn: null, handleOut: null });
      }
      return createPath([{ nodes, closed: element.name.toLowerCase() === 'polygon' }]);
    }
    default:
      return null;
  }
}

/**
 * Reads every gradient and pattern the file declares.
 *
 * Only the two coordinate systems the stored model can express are accepted, and they are
 * converted into the model's fractional form here: `objectBoundingBox` values are already
 * fractions, and `userSpaceOnUse` ones are kept absolute and divided by the shape's bounds when
 * the shape that references them is created. A definition this importer cannot express is named
 * in the report rather than silently replaced with black.
 */
/**
 * Turns a paint reference into stored paint for one shape.
 *
 * Absolute coordinates are divided by the shape's own bounds, which is the only place in the
 * importer where both a definition and the shape that uses it are known. A definition that cannot
 * be expressed — a foreign pattern with arbitrary contents, a gradient with fewer than two stops —
 * is reported and returns null, so the caller keeps the solid colour rather than painting black.
 */
function resolvePaint(
  id: string | null,
  paints: PaintRegistry,
  box: VectorBox,
  slot: 'fill' | 'stroke',
  issues: SvgIssue[],
): PaintSpec | null {
  if (id === null) return null;
  const definition = paints.get(id);
  if (!definition) return null;
  const width = Math.max(box.maxX - box.minX, 1e-6);
  const height = Math.max(box.maxY - box.minY, 1e-6);
  const shorter = Math.min(width, height);

  if (definition.units === 'fraction') return definition.paint;

  const paint = definition.paint;
  if (paint.kind === 'linear-gradient') {
    return {
      kind: 'linear-gradient',
      from: { x: (paint.from.x - box.minX) / width, y: (paint.from.y - box.minY) / height },
      to: { x: (paint.to.x - box.minX) / width, y: (paint.to.y - box.minY) / height },
      stops: paint.stops,
    };
  }
  if (paint.kind === 'radial-gradient') {
    return {
      kind: 'radial-gradient',
      centre: {
        x: (paint.centre.x - box.minX) / width,
        y: (paint.centre.y - box.minY) / height,
      },
      radius: paint.radius / shorter,
      stops: paint.stops,
    };
  }
  if (paint.kind === 'pattern') {
    const tile = definition.tile ?? shorter * 0.25;
    return { ...paint, scale: tile / shorter };
  }

  issues.push({
    severity: 'approximated',
    code: `paint.${slot}-unrepresentable`,
    message: `A ${slot} paint could not be expressed by this model and was replaced with its solid colour.`,
  });
  return null;
}

/** Reads one `<linearGradient>`, `<radialGradient>` or `<pattern>` definition. */
function paintFor(element: RawElement, id: string, issues: SvgIssue[]): PaintDefinition | null {
  const name = element.name.toLowerCase();
  // Takes the source element explicitly: a stop's `offset` lives on the `<stop>`, not on the
  // gradient that contains it.
  const numberOn = (source: RawElement, attribute: string, fallback: number): number => {
    const raw = source.attributes.get(attribute);
    if (raw === undefined) return fallback;
    const trimmed = raw.trim();
    if (trimmed.endsWith('%')) {
      const value = Number(trimmed.slice(0, -1));
      return Number.isFinite(value) ? value / 100 : fallback;
    }
    const value = parseLength(trimmed);
    return value !== null && Number.isFinite(value) ? value : fallback;
  };
  const number = (attribute: string, fallback: number): number =>
    numberOn(element, attribute, fallback);
  const units =
    element.attributes.get('gradientUnits') ??
    element.attributes.get('patternUnits') ??
    'objectBoundingBox';
  const absolute = units.toLowerCase() === 'userspaceonuse';

  if (name === 'pattern') {
    // Our own output carries the model's parameters, so a re-import is exact for a motif that is
    // ours rather than a best guess at arbitrary geometry.
    const annotation = element.attributes.get('data-forge-pattern');
    const tile = number('width', 8);
    if (annotation) {
      try {
        const parsed = JSON.parse(annotation) as PatternPaint;
        return { units: 'user', paint: parsed, tile };
      } catch {
        // A malformed annotation falls through to the geometric reading below.
      }
    }
    issues.push({
      severity: 'approximated',
      code: 'paint.pattern-unrepresentable',
      message: `The pattern "${id}" is not one this editor can express; its shapes were kept and its paint fell back to a solid colour.`,
    });
    return null;
  }

  const stops: { offset: number; color: string }[] = [];
  for (const child of element.children) {
    if (child.name.toLowerCase() !== 'stop') continue;
    const offset = numberOn(child, 'offset', 0);
    const colour = child.attributes.get('stop-color') ?? '#000000';
    const parsed = parseColour(colour, null, issues, 'paint.stop');
    if (parsed === null) continue;
    stops.push({ offset: Math.min(1, Math.max(0, offset)), color: parsed });
  }
  if (stops.length < 2) {
    issues.push({
      severity: 'approximated',
      code: 'paint.gradient-too-few-stops',
      message: `The gradient "${id}" has fewer than two usable stops and was replaced with its first colour.`,
    });
    return null;
  }
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);

  if (name === 'lineargradient') {
    const paint: PaintSpec = {
      kind: 'linear-gradient',
      from: { x: number('x1', 0), y: number('y1', 0) },
      to: { x: number('x2', 1), y: number('y2', 0) },
      stops: sorted,
    };
    return absolute
      ? { units: 'user' as const, paint, tile: null }
      : { units: 'fraction' as const, paint };
  }
  const paint: PaintSpec = {
    kind: 'radial-gradient',
    centre: { x: number('cx', 0.5), y: number('cy', 0.5) },
    radius: number('r', 0.5),
    stops: sorted,
  };
  return absolute
    ? { units: 'user' as const, paint, tile: null }
    : { units: 'fraction' as const, paint };
}

function collectPaints(root: RawElement, issues: SvgIssue[]): PaintRegistry {
  const registry = new Map<string, PaintDefinition>();
  const visit = (element: RawElement): void => {
    const name = element.name.toLowerCase();
    const id = element.attributes.get('id');
    if (id && (name === 'lineargradient' || name === 'radialgradient' || name === 'pattern')) {
      const paint = paintFor(element, id, issues);
      if (paint) registry.set(id, paint);
    }
    for (const child of element.children) visit(child);
  };
  visit(root);
  return registry;
}
function walk(element: RawElement, context: WalkContext, depth: number): void {
  const name = element.name.toLowerCase();
  context.elements.push(name);
  if (depth > SVG_LIMITS.maxDepth) {
    context.issues.push({
      severity: 'warning',
      code: 'structure.too-deep',
      message: `Elements nested deeper than ${String(SVG_LIMITS.maxDepth)} levels were skipped.`,
    });
    return;
  }

  if (name === 'text') {
    readTextElement(element, context);
    return;
  }
  // `<textPath>` and `<tspan>` outside a `<text>` are not drawing elements of their own.
  if (name === 'textpath' || name === 'tspan') {
    context.issues.push({
      severity: 'ignored',
      code: `unsupported.${name}`,
      message: `<${name}> outside a <text> element was left out.`,
    });
    return;
  }

  if (UNSUPPORTED_ELEMENTS.has(name)) {
    context.issues.push({
      severity: 'ignored',
      code: `unsupported.${name}`,
      message: `<${name}> is not supported by this importer and was left out.`,
    });
    return;
  }

  const localMatrix = ((): Matrix => {
    const transform = element.attributes.get('transform');
    if (!transform) return context.matrixValue;
    const parsed = parseTransform(transform);
    if (!parsed) {
      context.issues.push({
        severity: 'warning',
        code: 'transform.unparsed',
        message: `A transform ("${transform}") could not be read and was ignored.`,
      });
      return context.matrixValue;
    }
    return apply(context.matrixValue, parsed);
  })();

  const style = styleFromAttributes(
    element.attributes,
    context.style,
    context.issues,
    null,
    'style',
    context.paints,
  );
  const opacityAttribute = parseNumberOrNull(element.attributes.get('opacity'));
  const opacity =
    context.opacity * (opacityAttribute === null ? 1 : Math.min(1, Math.max(0, opacityAttribute)));

  const isRoot = name === 'svg';
  if (name === 'g' || isRoot || name === 'defs') {
    // A `<title>` written by an exporter names the artwork inside its group; carrying it down is
    // what makes a round trip keep layer names instead of reducing every shape to "<path>".
    const groupTitle = titleOf(element) ?? context.title;
    for (const child of element.children) {
      walk(
        child,
        { ...context, matrixValue: localMatrix, style, opacity, title: groupTitle },
        depth + 1,
      );
    }
    return;
  }

  const geometry = geometryFor(element, context.issues);
  if (!geometry) {
    if (!FORBIDDEN_ELEMENTS.has(name) && name !== 'title' && name !== 'desc') {
      context.issues.push({
        severity: 'ignored',
        code: `unsupported.${name}`,
        message: `<${name}> is not a drawing element this importer understands and was left out.`,
      });
    }
    return;
  }

  context.nodes += geometry.contours.reduce((total, contour) => total + contour.nodes.length, 0);
  if (context.nodes > MAX_NODES_TOTAL) {
    context.issues.push({
      severity: 'warning',
      code: 'geometry.too-large',
      message: `The file has more than ${String(MAX_NODES_TOTAL)} path nodes; later shapes were skipped.`,
    });
    return;
  }

  const placed = transformPath(geometry, localMatrix);
  const bounds = boundsOfPath(placed);
  const box = bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const fillPaint = resolvePaint(
    style.fillPaintRef ?? null,
    context.paints,
    box,
    'fill',
    context.issues,
  );
  const strokePaint = resolvePaint(
    style.strokePaintRef ?? null,
    context.paints,
    box,
    'stroke',
    context.issues,
  );
  if (fillPaint === null && style.fillPaintRef) {
    // Named above by resolvePaint; the shape still imports with the solid colour behind it.
  }

  context.shapeIds.push(element.attributes.get('id') ?? null);
  context.shapes.push(
    createShape(
      titleOf(element) ?? element.attributes.get('id') ?? context.title ?? name,
      placed,
      {
        fillPaint,
        strokePaint,
        fill: fillPaint === null ? style.fill : null,
        fillRule: style.fillRule,
        fillOpacity: style.fillOpacity,
        stroke: strokePaint === null ? style.stroke : null,
        strokeWidth: style.strokeWidth,
        strokeOpacity: style.strokeOpacity,
        lineCap: style.lineCap,
        lineJoin: style.lineJoin,
        dashArray: style.dashArray,
      },
      opacity,
      null,
    ),
  );
}

/** Maps a CSS `font-family` value back to one of the three stacks this project ships. */
function fontStackFor(value: string | undefined, issues: SvgIssue[]): FontStackId {
  const family = (value ?? '').toLowerCase();
  if (family.includes('mono')) return 'mono';
  if (family.includes('serif') && !family.includes('sans')) return 'serif';
  if (family.length > 0 && !family.includes('sans') && !family.includes('system-ui')) {
    issues.push({
      severity: 'approximated',
      code: 'text.font-family',
      message: `The font family "${family}" was approximated to the system sans stack.`,
    });
  }
  return 'sans';
}

/**
 * Reads a `<text>` element that references a path with `<textPath href="#id">`.
 *
 * Only what this project writes is imported exactly: a run, its size, spacing, colour, start offset
 * and the baseline mode it recorded. Anything else — a bare `<text x y>`, a `rotate` list, a
 * `textLength` — is reported rather than guessed at.
 */
function readTextElement(element: RawElement, context: WalkContext): void {
  const textPath = element.children.find((child) => child.name.toLowerCase() === 'textpath');
  if (!textPath) {
    context.issues.push({
      severity: 'ignored',
      code: 'unsupported.text',
      message:
        'A <text> element that is not laid on a path was left out; this importer carries text attached to a shape, not free-standing labels.',
    });
    return;
  }
  const href =
    textPath.attributes.get('href') ??
    textPath.attributes.get('xlink:href') ??
    element.attributes.get('href') ??
    element.attributes.get('xlink:href') ??
    '';
  // Anything with a scheme or a path was already refused by the safety scan before the walk, so what
  // is left here is a missing or empty reference — reported rather than guessed at.
  if (!href.startsWith('#')) {
    context.issues.push({
      severity: 'warning',
      code: 'text.external-reference',
      message:
        'A <textPath> that does not reference an element in this file was left out: imported files may not load anything external.',
    });
    return;
  }
  const rawContent = textPath.text.trim();
  if (rawContent.length === 0) return;
  const content =
    rawContent.length > PATH_TEXT_LIMITS.maxContentLength
      ? rawContent.slice(0, PATH_TEXT_LIMITS.maxContentLength)
      : rawContent;
  if (content !== rawContent) {
    context.issues.push({
      severity: 'approximated',
      code: 'text.truncated',
      message: `Text longer than ${String(PATH_TEXT_LIMITS.maxContentLength)} characters was truncated.`,
    });
  }

  const offsetAttribute =
    textPath.attributes.get('startoffset') ?? textPath.attributes.get('startOffset');
  const offsetText = offsetAttribute?.trim() ?? '';
  const offsetIsAbsolute = offsetText.length > 0 && !offsetText.endsWith('%');
  const absoluteOffset = ((): number | null => {
    if (!offsetIsAbsolute) return null;
    const numeric = Number(offsetText);
    return Number.isFinite(numeric) ? numeric : null;
  })();
  const startOffset = ((): number => {
    if (offsetText.length === 0) return 0;
    const numeric = Number(offsetIsAbsolute ? offsetText : offsetText.slice(0, -1));
    if (!Number.isFinite(numeric)) return 0;
    return offsetIsAbsolute ? 0 : numeric / 100;
  })();

  const annotated = textPath.attributes.get('data-forge-baseline');
  const baseline: PathTextBaseline =
    annotated === 'centre' || annotated === 'below' || annotated === 'above'
      ? annotated
      : element.attributes.get('dy')?.includes('0.7') === true
        ? 'below'
        : element.attributes.get('dy') !== undefined
          ? 'centre'
          : 'above';

  const fill = element.attributes.get('fill');
  const colour =
    fill === undefined
      ? '#000000'
      : (parseColour(fill, '#000000', context.issues, 'text') ?? '#000000');

  context.pendingText.push({
    targetId: href.slice(1),
    text: normalisePathText({
      content,
      fontSize: parseLength(element.attributes.get('font-size')) ?? 16,
      letterSpacing: parseLength(element.attributes.get('letter-spacing')) ?? 0,
      startOffset,
      baseline,
      colour,
      fontStackId: fontStackFor(element.attributes.get('font-family'), context.issues),
    }),
    absoluteOffset,
  });
}

function checkSafety(root: RawElement, issues: SvgIssue[]): void {
  const visit = (element: RawElement, depth: number): void => {
    if (depth > SVG_LIMITS.maxDepth) return;
    const name = element.name.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(name)) {
      throw new ForbiddenSvgError(
        `<${name}> is refused: an imported SVG may not run code or load external content.`,
      );
    }
    for (const [attribute, value] of element.attributes) {
      const attributeName = attribute.toLowerCase();
      if (attributeName.startsWith('on')) {
        throw new ForbiddenSvgError(
          `The event handler attribute "${attribute}" is refused: an imported SVG may not run code.`,
        );
      }
      if (REFERENCE_ATTRIBUTES.has(attributeName)) {
        const trimmed = value.trim();
        const isLocalFragment = trimmed.startsWith('#');
        if (!isLocalFragment && trimmed.length > 0) {
          throw new ForbiddenSvgError(
            `The reference "${attribute}=\\"${trimmed}\\" is refused: an imported SVG may not load external content.`,
          );
        }
      }
      if (/javascript:/i.test(value) || /data:text\/html/i.test(value)) {
        throw new ForbiddenSvgError(
          `The value of "${attribute}" is refused: an imported SVG may not contain script or HTML payloads.`,
        );
      }
    }
    for (const child of element.children) visit(child, depth + 1);
  };
  visit(root, 0);
  void issues;
}

class ForbiddenSvgError extends Error {}

/**
 * Parses an SVG document.
 *
 * Returns the artwork plus every observation the importer made. A file that contains script, an
 * event handler, a `foreignObject` or an external reference is refused entirely — with the reason.
 */
export function parseSvg(source: string): Result<SvgImportResult> {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return err(forgeError('validation-failed', 'The file is empty.'));
  }
  if (source.length > SVG_LIMITS.maxBytes) {
    return err(
      forgeError(
        'validation-failed',
        `The file is larger than the ${String(Math.round(SVG_LIMITS.maxBytes / 1024))} KB import limit.`,
        {
          detail: 'Reduce the drawing or export it at a smaller size.',
          retryable: false,
        },
      ),
    );
  }
  if (!/<svg[\s>]/i.test(source)) {
    return err(forgeError('validation-failed', 'The file does not contain an <svg> element.'));
  }

  let root: RawElement;
  try {
    root = new XmlScanner(source).parse();
  } catch (error) {
    if (error instanceof XmlError) {
      return err(
        forgeError(
          'validation-failed',
          `The file could not be read at character ${String(error.position)}: ${error.message}`,
          {
            retryable: false,
          },
        ),
      );
    }
    return err(forgeError('unknown', 'The file could not be read.', { detail: String(error) }));
  }

  if (root.name.toLowerCase() !== 'svg') {
    return err(
      forgeError(
        'validation-failed',
        `The root element is <${root.name}>; an SVG file must start with <svg>.`,
      ),
    );
  }

  const issues: SvgIssue[] = [];
  try {
    checkSafety(root, issues);
  } catch (error) {
    if (error instanceof ForbiddenSvgError) {
      return err(forgeError('unsupported', error.message, { retryable: false }));
    }
    return err(
      forgeError('unknown', 'The file could not be checked for unsafe content.', {
        detail: String(error),
      }),
    );
  }

  const viewBoxAttribute = root.attributes.get('viewBox');
  const viewBoxValues = (viewBoxAttribute ?? '')
    .split(/[\s,]+/)
    .filter((entry) => entry.length > 0)
    .map(Number);
  const widthAttribute = parseLength(root.attributes.get('width'));
  const heightAttribute = parseLength(root.attributes.get('height'));

  const viewBox =
    viewBoxValues.length === 4 &&
    viewBoxValues.every((entry) => Number.isFinite(entry)) &&
    (viewBoxValues[2] ?? 0) > 0 &&
    (viewBoxValues[3] ?? 0) > 0
      ? {
          minX: viewBoxValues[0] ?? 0,
          minY: viewBoxValues[1] ?? 0,
          maxX: (viewBoxValues[0] ?? 0) + (viewBoxValues[2] ?? 0),
          maxY: (viewBoxValues[1] ?? 0) + (viewBoxValues[3] ?? 0),
        }
      : null;

  if (viewBoxAttribute !== undefined && !viewBox) {
    issues.push({
      severity: 'warning',
      code: 'viewBox.invalid',
      message: `The viewBox "${viewBoxAttribute}" is not four positive numbers and was ignored.`,
    });
  }

  const width = widthAttribute ?? (viewBox ? viewBox.maxX - viewBox.minX : 100);
  const height = heightAttribute ?? (viewBox ? viewBox.maxY - viewBox.minY : 100);
  if (width <= 0 || height <= 0) {
    return err(forgeError('validation-failed', 'The file declares a size of zero or less.'));
  }
  if (widthAttribute === null && heightAttribute === null && !viewBox) {
    issues.push({
      severity: 'warning',
      code: 'size.missing',
      message: 'The file declares no size and no viewBox; 100 × 100 units were assumed.',
    });
  }

  const rootStyle: StyleAccumulator = {
    fill: '#000000',
    fillRule: 'nonzero',
    fillOpacity: 1,
    stroke: null,
    strokeWidth: 1,
    strokeOpacity: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    dashArray: [],
    unknown: [],
  };

  const paints = collectPaints(root, issues);
  const context: WalkContext = {
    matrixValue: matrix(1, 0, 0, 1, 0, 0),
    title: null,
    style: styleFromAttributes(root.attributes, rootStyle, issues, null, 'style', paints),
    paints,
    opacity: 1,
    issues,
    elements: [],
    shapes: [],
    shapeIds: [],
    pendingText: [],
    nodes: 0,
  };

  for (const child of root.children) walk(child, context, 1);

  // Text may be written before or after the shape it names, so the reference is resolved once the
  // whole file has been walked rather than requiring document order.
  for (const pending of context.pendingText) {
    const index = context.shapeIds.indexOf(pending.targetId);
    const shape = index >= 0 ? context.shapes[index] : undefined;
    if (!shape) {
      issues.push({
        severity: 'warning',
        code: 'text.path-missing',
        message: `Text on the path "${pending.targetId}" was left out: the file has no shape with that id.`,
      });
      continue;
    }
    let text = pending.text;
    if (pending.absoluteOffset !== null) {
      // "startOffset" is a length in user units unless it carries a percentage. Converting it
      // needs the contour's real length, which is why this happens after the walk rather than during
      // it; the approximation is reported because the length is measured on the flattened outline.
      const length = layoutPathText(
        shape.path,
        { content: '', fontSize: 16, letterSpacing: 0, startOffset: 0 },
        () => 0,
      ).pathLength;
      text = normalisePathText({
        ...text,
        startOffset: length > 0 ? pending.absoluteOffset / length : 0,
      });
      issues.push({
        severity: 'approximated',
        code: 'text.start-offset',
        message:
          'An absolute start offset was converted to a fraction of the flattened contour length.',
      });
    }
    context.shapes[index] = Object.freeze({ ...shape, text });
  }
  if (context.elements.length > SVG_LIMITS.maxElements) {
    return err(
      forgeError(
        'validation-failed',
        `The file has more than ${String(SVG_LIMITS.maxElements)} elements.`,
        {
          retryable: false,
        },
      ),
    );
  }

  if (context.shapes.length > SVG_LIMITS.maxShapes) {
    return err(
      forgeError(
        'validation-failed',
        `The file has more than ${String(SVG_LIMITS.maxShapes)} shapes.`,
        {
          retryable: false,
        },
      ),
    );
  }

  if (context.shapes.length === 0) {
    return err(
      forgeError('unsupported', 'Nothing in this file could be imported as vector artwork.', {
        detail:
          issues.length > 0
            ? issues.map((entry) => entry.message).join(' ')
            : 'The file contains no path, rect, circle, ellipse, line, polyline or polygon elements.',
        retryable: false,
      }),
    );
  }

  const unknownAttributes = new Set<string>();
  for (const shapeUnknown of context.style.unknown) unknownAttributes.add(shapeUnknown);
  for (const attribute of unknownAttributes) {
    issues.push({
      severity: 'ignored',
      code: 'attribute.unsupported',
      message: `The attribute "${attribute}" is not supported and was ignored.`,
    });
  }

  const approximated = issues.some((entry) => entry.severity === 'approximated');
  const artwork: SvgArtwork = createArtwork(
    { width, height },
    context.shapes,
    viewBox ? { viewBox } : {},
  );

  return ok({ artwork, issues, elements: context.elements, approximated });
}

/** Counts the nodes of a path for callers that need to decide whether an import is affordable. */
export function totalNodes(path: VectorPath): number {
  return path.contours.reduce((total, contour) => total + contour.nodes.length, 0);
}
