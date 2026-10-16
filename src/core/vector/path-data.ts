/**
 * SVG path data (`d`) — parsing and serialisation.
 *
 * Both directions are hand-written rather than delegated to the browser's `DOMParser`/`SVGPathElement`,
 * for three reasons that all matter here:
 *
 *  - **The core is DOM-free.** `src/core/**` may not touch a `DOMParser` (ADR-0019), and the importer
 *    has to work in a Node test as well as in the browser.
 *  - **Errors are reportable.** A hand-written tokeniser can say "unexpected \"x\" at position 42 in
 *    the `d` attribute" instead of returning `null`.
 *  - **Determinism.** The serialiser this module provides writes exactly the digits this codebase
 *    chooses, so identical geometry always produces identical bytes — which is what makes the
 *    round-trip and "smaller than naive" tests meaningful.
 *
 * Supported on import: `M m L l H h V v C c S s Q q T t A a Z z`. Quadratics are converted to their
 * exact cubic equivalent; elliptical arcs are approximated by cubics to within a documented
 * tolerance. Unsupported commands and malformed numbers are errors, never dropped silently.
 */

import {
  createContour,
  createPath,
  MAX_PATH_COORDINATE,
  type Contour,
  type PathNode,
  type VectorPath,
  type VectorPoint,
} from './types';
import { err, forgeError, ok, type Result } from '../result';
import { TOLERANCE, roundCoordinate } from './tolerance';
import { boundsOfPath } from './bounds';

export type PathDataError = {
  readonly message: string;
  /** Index into the path data string where the problem was found. */
  readonly position: number;
};

export type ParsedPathData = {
  readonly path: VectorPath;
  /** True when `A`/`a` segments were present and had to be approximated by cubics. */
  readonly approximatedArcs: number;
  /** Command letters that appeared, in order, for diagnostics and tests. */
  readonly commands: readonly string[];
};

const NUMBER_PATTERN = /^[+-]?(\d*\.\d+|\d+\.?)([eE][+-]?\d+)?/;
const COMMAND_PATTERN = /[MmLlHhVvCcSsQqTtAaZz]/;
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v', ',']);

class Tokenizer {
  public position = 0;

  public constructor(private readonly source: string) {}

  public atEnd(): boolean {
    return this.position >= this.source.length;
  }

  public skipSeparators(): void {
    while (this.position < this.source.length) {
      const character = this.source[this.position];
      if (character !== undefined && WHITESPACE.has(character)) {
        this.position += 1;
        continue;
      }
      break;
    }
  }

  /** The next character, or null at the end of the string. */
  public peekCharacter(): string | null {
    return this.source[this.position] ?? null;
  }

  /** Whether a number can be read here, without consuming it. */
  public peekNumber(): number | null {
    const saved = this.position;
    const value = this.readNumber();
    this.position = saved;
    return value;
  }

  public peekCommand(): string | null {
    this.skipSeparators();
    const character = this.source[this.position];
    if (character === undefined) return null;
    return COMMAND_PATTERN.test(character) ? character : null;
  }

  public readCommand(): string {
    this.skipSeparators();
    const character = this.source[this.position];
    this.position += 1;
    return character ?? '';
  }

  /**
   * Reads a number.
   *
   * `allowImplicitSeparator` mirrors the SVG grammar's quirk: a second number may start with `-` or
   * `.` without a comma or space, which is how real files are written.
   */
  public readNumber(): number | null {
    this.skipSeparators();
    const rest = this.source.slice(this.position);
    const match = NUMBER_PATTERN.exec(rest);
    if (!match || match[0] === '') return null;
    this.position += match[0].length;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
  }

  public readFlag(): number | null {
    this.skipSeparators();
    const character = this.source[this.position];
    if (character === '0' || character === '1') {
      this.position += 1;
      return Number(character);
    }
    return null;
  }
}

function lineNode(to: VectorPoint): PathNode {
  return { point: to, handleIn: null, handleOut: null };
}

/**
 * Converts an SVG elliptical arc to cubic segments.
 *
 * Endpoint parameterisation → centre parameterisation (SVG implementation notes, F.6.5), then each
 * arc of at most 90° becomes one cubic with the standard `4/3·tan(θ/4)` handle length. Maximum
 * radial error is well under 0.1 % of the radius.
 */
function arcToCubics(
  from: VectorPoint,
  to: VectorPoint,
  rxInput: number,
  ryInput: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
):
  | readonly {
      readonly control1: VectorPoint;
      readonly control2: VectorPoint;
      readonly to: VectorPoint;
    }[]
  | null {
  let rx = Math.abs(rxInput);
  let ry = Math.abs(ryInput);
  if (rx === 0 || ry === 0) return null;
  if (from.x === to.x && from.y === to.y) return null;

  const phi = (rotationDegrees * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (from.x - to.x) / 2;
  const dy2 = (from.y - to.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // Radii too small to span the endpoints are scaled up, as the SVG specification requires.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;

  const theta = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot / (length === 0 ? 1 : length))));
    return ux * vy - uy * vx < 0 ? -angle : angle;
  };

  const startAngle = theta(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaAngle = theta((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
  if (sweep && deltaAngle < 0) deltaAngle += 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2)));
  const step = deltaAngle / pieces;
  const handle = (4 / 3) * Math.tan(step / 4);

  const segments: { control1: VectorPoint; control2: VectorPoint; to: VectorPoint }[] = [];
  let angle = startAngle;
  for (let index = 0; index < pieces; index += 1) {
    const nextAngle = angle + step;
    const pointAt = (t: number): VectorPoint => ({
      x: cx + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi,
      y: cy + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi,
    });
    const derivativeAt = (t: number): VectorPoint => ({
      x: -rx * Math.sin(t) * cosPhi - ry * Math.cos(t) * sinPhi,
      y: -rx * Math.sin(t) * sinPhi + ry * Math.cos(t) * cosPhi,
    });
    const start = pointAt(angle);
    const end = pointAt(nextAngle);
    const startDerivative = derivativeAt(angle);
    const endDerivative = derivativeAt(nextAngle);
    segments.push({
      control1: {
        x: start.x + handle * startDerivative.x,
        y: start.y + handle * startDerivative.y,
      },
      control2: { x: end.x - handle * endDerivative.x, y: end.y - handle * endDerivative.y },
      to: index === pieces - 1 ? to : end,
    });
    angle = nextAngle;
  }
  return segments;
}

type BuildState = {
  readonly contours: Contour[];
  nodes: PathNode[];
  current: VectorPoint;
  started: boolean;
  closed: boolean;
  readonly commands: string[];
  approximatedArcs: number;
  /** Starting point of the current subpath, needed by `Z` and by relative `m`. */
  subpathStart: VectorPoint;
  lastControl: VectorPoint | null;
  lastCommand: string;
};

function flush(state: BuildState): void {
  if (state.nodes.length > 0) {
    state.contours.push(createContour(state.nodes, state.closed));
  }
  state.nodes = [];
  state.closed = false;
}

function currentLastNode(state: BuildState): PathNode | null {
  return state.nodes[state.nodes.length - 1] ?? null;
}

/**
 * Parses SVG path data.
 *
 * Every command is validated; a malformed command, a missing number or an out-of-range coordinate
 * produces an error with the position, and no geometry is returned. Silently skipping a command
 * would drop part of a shape, which is exactly what an importer must never do.
 */
/**
 * Folds a repeated start point into the contour it closes.
 *
 * SVG writers disagree about how to close a curved contour: some end with `Z` after a curve back to
 * the start point (so the last node's coordinates equal the first node's), others rely on the curve
 * itself. Left alone, the first form would import as an extra zero-length node — a duplicate the
 * user never drew, which then shows up in the node count, in the handles and in every later export.
 *
 * When `Z` arrives and the last node sits exactly on the first, the two describe one node: the
 * curve arriving at the start point becomes the closing segment, so its incoming handle moves onto
 * the first node and the duplicate is dropped.
 */
function mergeClosingNode(state: BuildState): void {
  const nodes = state.nodes;
  if (nodes.length < 3) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) return;
  if (Math.abs(first.point.x - last.point.x) > TOLERANCE.point) return;
  if (Math.abs(first.point.y - last.point.y) > TOLERANCE.point) return;
  nodes[0] = { point: first.point, handleIn: last.handleIn, handleOut: first.handleOut };
  nodes.pop();
}

export function parsePathData(source: string): Result<ParsedPathData> {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return err(forgeError('validation-failed', 'Path data is empty.', { retryable: false }));
  }

  const tokenizer = new Tokenizer(source);
  const state: BuildState = {
    contours: [],
    nodes: [],
    current: { x: 0, y: 0 },
    started: false,
    closed: false,
    commands: [],
    approximatedArcs: 0,
    subpathStart: { x: 0, y: 0 },
    lastControl: null,
    lastCommand: '',
  };

  const fail = (message: string, position = tokenizer.position): Result<never> =>
    err(
      forgeError(
        'validation-failed',
        `Path data error at character ${String(position)}: ${message}`,
        {
          retryable: false,
        },
      ),
    );

  let previousCommand = '';
  while (!tokenizer.atEnd()) {
    tokenizer.skipSeparators();
    if (tokenizer.atEnd()) break;

    const peeked = tokenizer.peekCommand();
    let command: string;
    if (peeked !== null) {
      command = tokenizer.readCommand();
      previousCommand = command;
    } else {
      // Implicit repeat: after `M`, further coordinate pairs are `L`; after `m`, they are `l`. A
      // character that is neither a command nor the start of a number is named explicitly, because
      // "unexpected comma" is much easier to act on than "L needs a coordinate".
      if (previousCommand === '')
        return fail('the path must begin with a move command ("M" or "m")');
      if (tokenizer.peekNumber() === null) {
        return fail(`unexpected "${tokenizer.peekCharacter() ?? ''}" where a number was expected`);
      }
      if (previousCommand === 'M') command = 'L';
      else if (previousCommand === 'm') command = 'l';
      else command = previousCommand;
    }

    state.commands.push(command);
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const needsNumber = (): number | null => tokenizer.readNumber();
    const pairToAbsolute = (x: number, y: number): VectorPoint =>
      relative ? { x: state.current.x + x, y: state.current.y + y } : { x, y };

    const guard = (candidate: VectorPoint): Result<VectorPoint> =>
      Math.abs(candidate.x) > MAX_PATH_COORDINATE || Math.abs(candidate.y) > MAX_PATH_COORDINATE
        ? fail('coordinate is outside the supported range')
        : ok(candidate);

    switch (upper) {
      case 'M': {
        const x = needsNumber();
        const y = needsNumber();
        if (x === null || y === null) return fail('"M" needs an x and a y coordinate');
        const target = pairToAbsolute(x, y);
        const guarded = guard(target);
        if (!guarded.ok) return guarded;
        flush(state);
        state.current = guarded.value;
        state.subpathStart = guarded.value;
        state.nodes.push(lineNode(guarded.value));
        state.started = true;
        state.lastControl = null;
        break;
      }
      case 'L': {
        const x = needsNumber();
        const y = needsNumber();
        if (x === null || y === null) return fail('"L" needs an x and a y coordinate');
        const guarded = guard(pairToAbsolute(x, y));
        if (!guarded.ok) return guarded;
        if (!state.started) return fail('"L" appears before any move command');
        state.current = guarded.value;
        state.nodes.push(lineNode(guarded.value));
        state.lastControl = null;
        break;
      }
      case 'H': {
        const x = needsNumber();
        if (x === null) return fail('"H" needs an x coordinate');
        const guarded = guard(
          relative ? { x: state.current.x + x, y: state.current.y } : { x, y: state.current.y },
        );
        if (!guarded.ok) return guarded;
        if (!state.started) return fail('"H" appears before any move command');
        state.current = guarded.value;
        state.nodes.push(lineNode(guarded.value));
        state.lastControl = null;
        break;
      }
      case 'V': {
        const y = needsNumber();
        if (y === null) return fail('"V" needs a y coordinate');
        const guarded = guard(
          relative ? { x: state.current.x, y: state.current.y + y } : { x: state.current.x, y },
        );
        if (!guarded.ok) return guarded;
        if (!state.started) return fail('"V" appears before any move command');
        state.current = guarded.value;
        state.nodes.push(lineNode(guarded.value));
        state.lastControl = null;
        break;
      }
      case 'C':
      case 'S': {
        let control1: VectorPoint | null = null;
        if (upper === 'C') {
          const c1x = needsNumber();
          const c1y = needsNumber();
          if (c1x === null || c1y === null) return fail('"C" needs three coordinate pairs');
          const guarded = guard(pairToAbsolute(c1x, c1y));
          if (!guarded.ok) return guarded;
          control1 = guarded.value;
        } else {
          const last = previousCommand.toUpperCase();
          control1 =
            state.lastControl && (last === 'C' || last === 'S')
              ? {
                  x: 2 * state.current.x - state.lastControl.x,
                  y: 2 * state.current.y - state.lastControl.y,
                }
              : { ...state.current };
        }
        const c2x = needsNumber();
        const c2y = needsNumber();
        const x = needsNumber();
        const y = needsNumber();
        if (c2x === null || c2y === null || x === null || y === null) {
          return fail(`"${command}" needs three coordinate pairs`);
        }
        const control2 = guard(pairToAbsolute(c2x, c2y));
        if (!control2.ok) return control2;
        const target = guard(pairToAbsolute(x, y));
        if (!target.ok) return target;
        if (!state.started) return fail(`"${command}" appears before any move command`);

        const lastNode = currentLastNode(state);
        if (lastNode) {
          state.nodes[state.nodes.length - 1] = {
            point: lastNode.point,
            handleIn: lastNode.handleIn,
            handleOut: control1,
          };
        }
        state.nodes.push({ point: target.value, handleIn: control2.value, handleOut: null });
        state.current = target.value;
        state.lastControl = control2.value;
        break;
      }
      case 'Q':
      case 'T': {
        let quadratic: VectorPoint;
        if (upper === 'Q') {
          const qx = needsNumber();
          const qy = needsNumber();
          if (qx === null || qy === null) return fail('"Q" needs two coordinate pairs');
          const guarded = guard(pairToAbsolute(qx, qy));
          if (!guarded.ok) return guarded;
          quadratic = guarded.value;
        } else {
          const last = previousCommand.toUpperCase();
          quadratic =
            state.lastControl && (last === 'Q' || last === 'T')
              ? {
                  x: 2 * state.current.x - state.lastControl.x,
                  y: 2 * state.current.y - state.lastControl.y,
                }
              : { ...state.current };
        }
        const x = needsNumber();
        const y = needsNumber();
        if (x === null || y === null) return fail(`"${command}" needs two coordinate pairs`);
        const target = guard(pairToAbsolute(x, y));
        if (!target.ok) return target;
        if (!state.started) return fail(`"${command}" appears before any move command`);

        // Exact conversion of a quadratic to a cubic: the control points sit two thirds of the way
        // from each endpoint towards the quadratic's control point.
        const from = state.current;
        const control1 = {
          x: from.x + (2 / 3) * (quadratic.x - from.x),
          y: from.y + (2 / 3) * (quadratic.y - from.y),
        };
        const control2 = {
          x: target.value.x + (2 / 3) * (quadratic.x - target.value.x),
          y: target.value.y + (2 / 3) * (quadratic.y - target.value.y),
        };
        const lastNode = currentLastNode(state);
        if (lastNode) {
          state.nodes[state.nodes.length - 1] = {
            point: lastNode.point,
            handleIn: lastNode.handleIn,
            handleOut: control1,
          };
        }
        state.nodes.push({ point: target.value, handleIn: control2, handleOut: null });
        state.current = target.value;
        state.lastControl = quadratic;
        break;
      }
      case 'A': {
        const rx = needsNumber();
        const ry = needsNumber();
        const rotation = needsNumber();
        const largeArc = tokenizer.readFlag();
        const sweep = tokenizer.readFlag();
        const x = needsNumber();
        const y = needsNumber();
        if (
          rx === null ||
          ry === null ||
          rotation === null ||
          largeArc === null ||
          sweep === null ||
          x === null ||
          y === null
        ) {
          return fail('"A" needs rx, ry, rotation, two flags and an endpoint');
        }
        const target = guard(pairToAbsolute(x, y));
        if (!target.ok) return target;
        const from = state.current;
        const segments = arcToCubics(
          from,
          target.value,
          rx,
          ry,
          rotation,
          largeArc === 1,
          sweep === 1,
        );
        if (!segments) {
          // Degenerate arc: the SVG specification says draw a straight line instead.
          state.nodes.push(lineNode(target.value));
          state.current = target.value;
          state.lastControl = null;
          break;
        }
        for (const segment of segments) {
          const lastNode = currentLastNode(state);
          if (lastNode) {
            state.nodes[state.nodes.length - 1] = {
              point: lastNode.point,
              handleIn: lastNode.handleIn,
              handleOut: segment.control1,
            };
          }
          state.nodes.push({ point: segment.to, handleIn: segment.control2, handleOut: null });
        }
        state.approximatedArcs += 1;
        state.current = target.value;
        state.lastControl = null;
        break;
      }
      case 'Z': {
        if (!state.started) return fail('"Z" appears before any move command');
        if (state.nodes.length > 0) {
          state.closed = true;
          mergeClosingNode(state);
          flush(state);
        }
        state.current = state.subpathStart;
        state.lastControl = null;
        break;
      }
      default:
        return fail(`unsupported command "${command}"`);
    }
  }

  flush(state);

  const path = createPath(state.contours);
  const bounds = boundsOfPath(path);
  if (!bounds) {
    return err(
      forgeError('validation-failed', 'Path data contains no drawable geometry.', {
        retryable: false,
      }),
    );
  }

  return ok({
    path,
    approximatedArcs: state.approximatedArcs,
    commands: state.commands,
  });
}

/** Formats a number the way SVG accepts it, without exponent notation or trailing zeros. */
function formatNumber(value: number, digits: number): string {
  const rounded = roundCoordinate(value, digits);
  if (Number.isInteger(rounded)) return String(rounded);
  return String(Number(rounded.toFixed(digits)));
}

export type PathDataOptions = {
  /** Decimal places retained. Tree-shaken output uses 3; the naive comparison uses 6. */
  readonly digits?: number;
  /** Emit line segments explicitly (`L`) instead of relying on implicit repeats. */
  readonly explicitCommands?: boolean;
};

/**
 * Serialises a path to SVG path data.
 *
 * Deliberately compact but never lossy at the chosen precision: coordinates are rounded to
 * `digits` decimal places (default 3, i.e. a thousandth of a unit — a hundredth of a pixel at 10×
 * zoom), commas and duplicate commands are omitted where the grammar allows, and a closed contour
 * ends in `Z`.
 */
export function toPathData(path: VectorPath, options: PathDataOptions = {}): string {
  const digits = options.digits ?? 3;
  const explicit = options.explicitCommands ?? false;
  const parts: string[] = [];

  for (const contour of path.contours) {
    const nodes = contour.nodes;
    const first = nodes[0];
    if (!first) continue;

    parts.push(`M${formatNumber(first.point.x, digits)} ${formatNumber(first.point.y, digits)}`);
    let total = contour.closed ? nodes.length : nodes.length - 1;
    // `Z` closes the subpath with a straight line, so a straight closing segment is written as `Z`
    // alone — writing the line as well would add a node on every re-import. A *curved* closing
    // segment is real geometry and is written before the `Z` (which then draws a zero-length line).
    if (contour.closed && total > 1) {
      const last = nodes[nodes.length - 1];
      if (last && last.handleOut === null && first.handleIn === null) total -= 1;
    }
    let lineRun = false;
    for (let index = 0; index < total; index += 1) {
      const from = nodes[index];
      const to = nodes[(index + 1) % nodes.length];
      if (!from || !to) continue;

      if (from.handleOut === null && to.handleIn === null) {
        const coordinates = `${formatNumber(to.point.x, digits)} ${formatNumber(to.point.y, digits)}`;
        // Consecutive line segments share one command: "L x y x y" is the same geometry as
        // "L x y L x y" and both are legal, so the command letter is written once per run.
        if (lineRun && !explicit) parts.push(` ${coordinates}`);
        else parts.push(`L${coordinates}`);
        lineRun = true;
      } else {
        const control1 = from.handleOut ?? from.point;
        const control2 = to.handleIn ?? to.point;
        parts.push(
          `C${formatNumber(control1.x, digits)} ${formatNumber(control1.y, digits)} ${formatNumber(
            control2.x,
            digits,
          )} ${formatNumber(control2.y, digits)} ${formatNumber(to.point.x, digits)} ${formatNumber(to.point.y, digits)}`,
        );
        lineRun = false;
      }
    }
    if (contour.closed) parts.push('Z');
  }

  return parts.join('');
}

/**
 * The same geometry in the most verbose legal form: one command per segment, six decimal places,
 * explicit closing line, explicit separators.
 *
 * Its only job is to be a baseline that the compact serialiser must beat, so it is written to be
 * obviously naive rather than clever — the size comparison means something only if the comparison
 * target is not itself trying to be small.
 */
export function toVerbosePathData(path: VectorPath): string {
  const parts: string[] = [];
  const digits = 6;
  for (const contour of path.contours) {
    const nodes = contour.nodes;
    const first = nodes[0];
    if (!first) continue;
    parts.push(`M ${formatNumber(first.point.x, digits)} ${formatNumber(first.point.y, digits)}`);
    const total = contour.closed ? nodes.length : nodes.length - 1;
    for (let index = 0; index < total; index += 1) {
      const from = nodes[index];
      const to = nodes[(index + 1) % nodes.length];
      if (!from || !to) continue;
      if (from.handleOut === null && to.handleIn === null) {
        parts.push(`L ${formatNumber(to.point.x, digits)} ${formatNumber(to.point.y, digits)}`);
      } else {
        const control1 = from.handleOut ?? from.point;
        const control2 = to.handleIn ?? to.point;
        parts.push(
          `C ${formatNumber(control1.x, digits)} ${formatNumber(control1.y, digits)} ${formatNumber(
            control2.x,
            digits,
          )} ${formatNumber(control2.y, digits)} ${formatNumber(to.point.x, digits)} ${formatNumber(to.point.y, digits)}`,
        );
      }
    }
    if (contour.closed) parts.push('Z');
  }
  return parts.join(' ');
}
