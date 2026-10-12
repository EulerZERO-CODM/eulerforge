/**
 * Test support: deterministic render helpers.
 *
 * A recording context and a stub measurer let tests assert exactly which operations the painter
 * emits, in which order — the part of rendering this project actually owns. Real pixel output is
 * covered separately by `src/core/export/raster.test.ts`, which runs the pipeline against a real
 * rasteriser.
 */

import type { PainterContext } from '../core/render/paint';
import type { MeasureFactory, RenderImage } from '../core/render/plan';
import type { TextPaintContext } from '../core/render/text-layout';

/** Deterministic metrics: every character is `perCharacterPx` wide, independent of the font. */
export function createContextMeasureStub(perCharacterPx = 10): MeasureFactory {
  return () => (text: string) => text.length * perCharacterPx;
}

export type RecordedCall = {
  readonly op: string;
  readonly args: readonly unknown[];
};

/**
 * A `PainterContext` that records everything instead of drawing.
 *
 * It also tracks save/restore depth so a test can prove the painter leaves no state behind: the
 * artboard would otherwise inherit a stale `globalAlpha` or composite mode from any draw call.
 */
export function createRecordingContext(): {
  readonly context: PainterContext;
  readonly calls: RecordedCall[];
  readonly depth: () => number;
  readonly names: () => readonly string[];
} {
  const calls: RecordedCall[] = [];
  let depth = 0;

  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };

  const state = {
    fillStyle: '#000000' as string | CanvasGradient | CanvasPattern,
    strokeStyle: '#000000' as string | CanvasGradient | CanvasPattern,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    lineJoin: 'miter',
    imageSmoothingEnabled: true,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
  };

  let proxyState = { ...state };

  const context = {
    get fillStyle() {
      return proxyState.fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      proxyState.fillStyle = value;
    },
    get strokeStyle() {
      return proxyState.strokeStyle;
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      proxyState.strokeStyle = value;
    },
    get globalAlpha() {
      return proxyState.globalAlpha;
    },
    set globalAlpha(value: number) {
      proxyState.globalAlpha = value;
    },
    get globalCompositeOperation() {
      return proxyState.globalCompositeOperation;
    },
    set globalCompositeOperation(value: string) {
      proxyState.globalCompositeOperation = value;
    },
    get lineWidth() {
      return proxyState.lineWidth;
    },
    set lineWidth(value: number) {
      proxyState.lineWidth = value;
    },
    get lineJoin() {
      return proxyState.lineJoin;
    },
    set lineJoin(value: string) {
      proxyState.lineJoin = value;
    },
    get imageSmoothingEnabled() {
      return proxyState.imageSmoothingEnabled;
    },
    set imageSmoothingEnabled(value: boolean) {
      proxyState.imageSmoothingEnabled = value;
    },
    get font() {
      return proxyState.font;
    },
    set font(value: string) {
      proxyState.font = value;
    },
    get textAlign() {
      return proxyState.textAlign;
    },
    set textAlign(value: string) {
      proxyState.textAlign = value;
    },
    get textBaseline() {
      return proxyState.textBaseline;
    },
    set textBaseline(value: string) {
      proxyState.textBaseline = value;
    },
    save: () => {
      depth += 1;
      calls.push({ op: 'save', args: [] });
    },
    restore: () => {
      depth -= 1;
      proxyState = { ...state };
      calls.push({ op: 'restore', args: [] });
    },
    scale: record('scale') as PainterContext['scale'],
    clearRect: record('clearRect') as PainterContext['clearRect'],
    fillRect: record('fillRect') as PainterContext['fillRect'],
    strokeRect: record('strokeRect') as PainterContext['strokeRect'],
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    fill: record('fill'),
    stroke: record('stroke'),
    moveTo: record('moveTo') as PainterContext['moveTo'],
    lineTo: record('lineTo') as PainterContext['lineTo'],
    roundRect: record('roundRect') as PainterContext['roundRect'],
    ellipse: record('ellipse') as PainterContext['ellipse'],
    drawImage: record('drawImage') as PainterContext['drawImage'],
    fillText: record('fillText') as PainterContext['fillText'],
    measureText: (text: string) => ({ width: text.length * 10 }),
  };

  return {
    context,
    calls,
    depth: () => depth,
    names: () => calls.map((call) => call.op),
  };
}

/** Text-only context for `paintTextLine` tests. */
export function createTextRecordingContext(): {
  readonly context: TextPaintContext;
  readonly drawn: readonly { readonly text: string; readonly x: number; readonly y: number }[];
} {
  const drawn: { text: string; x: number; y: number }[] = [];
  return {
    drawn,
    context: {
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      fillStyle: '#000000',
      fillText: (text, x, y) => drawn.push({ text, x, y }),
      measureText: (text) => ({ width: text.length * 10 }),
    },
  };
}

export const STUB_IMAGE: RenderImage = { width: 200, height: 100 };
