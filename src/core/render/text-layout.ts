/**
 * Text layout and drawing.
 *
 * Layout and painting live in one module on purpose: the only way to guarantee that the measure used
 * for wrapping is the measure used for drawing is for both to read the same functions. Splitting
 * them is how a renderer ends up with text that wraps in the editor and clips in the export.
 *
 * Pure apart from `paintTextLine`, which writes through a canvas-like context passed in by the
 * caller — there is no DOM and no browser API in here.
 */

import type { Point, Rect } from '../documents/geometry';
import { FONT_STACKS_INFO, type TextSettings } from '../documents/layer-types';

/** Measures one text run in the current font, without letter spacing applied. */
export type TextMeasurer = (text: string) => number;

export type TextLine = {
  readonly text: string;
  readonly width: number;
};

export type TextLayout = {
  readonly lines: readonly TextLine[];
  readonly lineHeightPx: number;
  /** Widest line, in pixels. */
  readonly width: number;
  /** `lines.length * lineHeightPx`. */
  readonly height: number;
  /** True when the laid-out text is taller than the frame it was given. */
  readonly overflows: boolean;
};

/** CSS `font` shorthand for a text layer, matching what both canvases expect. */
export function fontString(settings: TextSettings): string {
  return `${settings.fontWeight} ${settings.fontSize}px ${FONT_STACKS_INFO[settings.fontStackId].css}`;
}

/**
 * Width of a run including letter spacing.
 *
 * Letter spacing adds one gap *between* characters, never after the last one — matching CSS, and
 * matching what `paintTextLine` draws.
 */
export function measureWithSpacing(
  measure: TextMeasurer,
  text: string,
  letterSpacing: number,
): number {
  if (text.length === 0) return 0;
  if (letterSpacing === 0) return measure(text);
  return measure(text) + letterSpacing * (text.length - 1);
}

/**
 * Greedy word wrap with hard breaks for words wider than the box.
 *
 * A hard break is what keeps a long URL or an unbroken identifier inside its frame instead of
 * spilling past the edge — the case where naive "split on spaces" wrapping fails.
 */
function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  if (paragraph.length === 0) return [''];
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return [paragraph];

  const lines: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.length > 0) lines.push(current);
    current = '';
  };

  for (const word of paragraph.split(' ')) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      pushCurrent();
      if (measure(word) <= maxWidth) {
        current = word;
        continue;
      }
    }

    // The word alone is wider than the box: break it by character.
    let chunk = '';
    for (const character of word) {
      const next = chunk + character;
      if (chunk.length > 0 && measure(next) > maxWidth) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  }

  pushCurrent();
  return lines.length > 0 ? lines : [''];
}

export function layoutText(
  content: string,
  settings: TextSettings,
  frame: Pick<Rect, 'width' | 'height'>,
  measure: TextMeasurer,
): TextLayout {
  const measureSpaced = (text: string) => measureWithSpacing(measure, text, settings.letterSpacing);
  const lineHeightPx = settings.fontSize * settings.lineHeight;

  const lines: TextLine[] = [];
  for (const paragraph of content.split('\n')) {
    for (const text of wrapParagraph(paragraph, frame.width, measureSpaced)) {
      lines.push({ text, width: measureSpaced(text) });
    }
  }

  const width = lines.reduce((widest, line) => Math.max(widest, line.width), 0);
  const height = lines.length * lineHeightPx;

  return {
    lines,
    lineHeightPx,
    width,
    height,
    overflows: height > frame.height + 0.5,
  };
}

/**
 * Horizontal offset of a line inside the frame for the layer's alignment.
 *
 * Returned as a delta from the frame's left edge so the drawing code and the selection overlay can
 * both use it.
 */
export function alignmentOffset(
  align: TextSettings['align'],
  frameWidth: number,
  lineWidth: number,
): number {
  switch (align) {
    case 'left':
      return 0;
    case 'center':
      return (frameWidth - lineWidth) / 2;
    case 'right':
      return frameWidth - lineWidth;
  }
}

/** Baseline position of line `index`, measured from the frame's top edge. */
export function lineBaseline(index: number, lineHeightPx: number): number {
  return lineHeightPx * (index + 0.5);
}

/**
 * The context subset text drawing needs.
 *
 * Declared structurally so the same function serves the live artboard, the offscreen export canvas
 * and the recording fake used in tests.
 */
export type TextPaintContext = {
  font: string;
  textAlign: string;
  textBaseline: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
};

export type PaintTextLineOptions = {
  readonly line: TextLine;
  /** Absolute baseline start of the line in document space, at the frame's left edge. */
  readonly origin: Point;
  readonly settings: TextSettings;
  readonly frameWidth: number;
};

/**
 * Draws one laid-out line.
 *
 * With no letter spacing the whole run is drawn in a single call so the platform's own kerning
 * applies. When letter spacing *is* set, characters are drawn individually at measured positions,
 * which is the only way to get identical output from browsers that implement `letterSpacing` and
 * ones that do not.
 *
 * Kerning is why the characters are not simply placed one after another: a shaped run is narrower
 * than the sum of its characters, so drawing them one by one makes the line wider than the text the
 * layout measured. Right-aligned text would then run past the edge of its frame and centre-aligned
 * text would sit off centre. The difference is taken out of the gaps between the characters, so the
 * drawn line is exactly as wide as the measured one.
 */
export function paintTextLine(context: TextPaintContext, options: PaintTextLineOptions): void {
  const { line, settings, origin } = options;
  if (line.text.length === 0) return;

  context.font = fontString(settings);
  context.fillStyle = settings.color;
  // Left alignment with an explicit per-line origin keeps alignment arithmetic in one place.
  context.textAlign = 'left';
  context.textBaseline = 'middle';

  const startX = origin.x + alignmentOffset(settings.align, options.frameWidth, line.width);

  if (settings.letterSpacing === 0) {
    context.fillText(line.text, startX, origin.y);
    return;
  }

  const characters = [...line.text];
  const advances = characters.map((character) => context.measureText(character).width);
  // The trailing advance of the last character is left alone: nothing is drawn after it, so it
  // cannot make the line any wider.
  const lastAdvance = advances.length > 0 ? (advances[advances.length - 1] ?? 0) : 0;
  const between = advances.slice(0, -1);
  const betweenTotal = between.reduce((sum, width) => sum + width, 0);
  const shaped = context.measureText(line.text).width;
  const correction = betweenTotal > 0 ? Math.max(0, shaped - lastAdvance) / betweenTotal : 1;

  let cursor = startX;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (character !== ' ') context.fillText(character, cursor, origin.y);
    const advance = advances[index] ?? 0;
    const isLast = index === characters.length - 1;
    cursor += (isLast ? advance : advance * correction) + settings.letterSpacing;
  }
}
