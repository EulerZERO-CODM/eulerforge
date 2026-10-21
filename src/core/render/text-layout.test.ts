import { describe, expect, it } from 'vitest';

import {
  alignmentOffset,
  fontString,
  layoutText,
  lineBaseline,
  measureWithSpacing,
  paintTextLine,
  type TextPaintContext,
} from './text-layout';
import { DEFAULT_FONT_STACK, defaultTextSettings } from '../documents/layer-defaults';

/** Deterministic metrics: every character is exactly 10 px wide, whatever the font stack. */
const measure = (text: string) => text.length * 10;

const settings = (overrides: Parameters<typeof defaultTextSettings>[0] = {}) =>
  defaultTextSettings({ fontSize: 20, lineHeight: 1, ...overrides });

describe('fontString', () => {
  it('builds a CSS font shorthand from the layer settings', () => {
    const font = fontString(settings({ fontWeight: 700, fontSize: 32 }));
    expect(font.startsWith('700 32px ')).toBe(true);
    expect(font).toContain('sans-serif');
  });

  it('uses the system stack the layer names', () => {
    expect(fontString(settings({ fontStackId: 'serif' }))).toContain('Georgia');
    expect(fontString(settings({ fontStackId: 'mono' }))).toContain('monospace');
    expect(DEFAULT_FONT_STACK).toBe('sans');
  });
});

describe('measureWithSpacing', () => {
  it('counts gaps between characters, never after the last one', () => {
    expect(measureWithSpacing(measure, 'ab', 0)).toBe(20);
    expect(measureWithSpacing(measure, 'ab', 2)).toBe(22);
    expect(measureWithSpacing(measure, 'abc', 2)).toBe(34);
    expect(measureWithSpacing(measure, '', 5)).toBe(0);
  });
});

describe('layoutText', () => {
  it('wraps at the frame width', () => {
    const layout = layoutText(
      'one two three four',
      settings(),
      { width: 90, height: 200 },
      measure,
    );
    expect(layout.lines.map((line) => line.text)).toEqual(['one two', 'three', 'four']);
    expect(layout.lineHeightPx).toBe(20);
    expect(layout.height).toBe(60);
  });

  it('reports each line width so alignment can be computed later', () => {
    const layout = layoutText(
      'one two three four',
      settings(),
      { width: 90, height: 200 },
      measure,
    );
    expect(layout.lines.map((line) => line.width)).toEqual([70, 50, 40]);
    expect(layout.width).toBe(70);
  });

  it('keeps explicit line breaks', () => {
    const layout = layoutText('first\nsecond', settings(), { width: 400, height: 200 }, measure);
    expect(layout.lines.map((line) => line.text)).toEqual(['first', 'second']);
  });

  it('hard-breaks a word that is wider than the box', () => {
    const layout = layoutText('aaaaaaaaaaaa', settings(), { width: 50, height: 500 }, measure);
    expect(layout.lines.map((line) => line.text)).toEqual(['aaaaa', 'aaaaa', 'aa']);
    expect(layout.lines.every((line) => line.width <= 50)).toBe(true);
  });

  it('measures one empty line for empty content', () => {
    const layout = layoutText('', settings(), { width: 100, height: 100 }, measure);
    expect(layout.lines).toEqual([{ text: '', width: 0 }]);
    expect(layout.height).toBe(20);
  });

  it('flags text that is taller than its frame', () => {
    const layout = layoutText(
      'one two three four five',
      settings(),
      { width: 90, height: 40 },
      measure,
    );
    expect(layout.overflows).toBe(true);
    const roomy = layoutText('one', settings(), { width: 90, height: 400 }, measure);
    expect(roomy.overflows).toBe(false);
  });

  it('does not wrap when the frame has no usable width', () => {
    const layout = layoutText('one two three', settings(), { width: 0, height: 100 }, measure);
    expect(layout.lines.map((line) => line.text)).toEqual(['one two three']);
  });

  it('applies letter spacing to the measured width', () => {
    const layout = layoutText(
      'abc',
      settings({ letterSpacing: 4 }),
      { width: 400, height: 100 },
      measure,
    );
    expect(layout.lines[0]?.width).toBe(38);
  });

  it('shrinks the usable width when letter spacing widens the line', () => {
    const layout = layoutText(
      'ab cd',
      settings({ letterSpacing: 10 }),
      { width: 60, height: 200 },
      measure,
    );
    // "ab cd" without spacing is 50; with 10 px between four characters it is 80, so it wraps.
    expect(layout.lines.map((line) => line.text)).toEqual(['ab', 'cd']);
  });
});

describe('alignment helpers', () => {
  it('offsets a line inside the frame for each alignment', () => {
    expect(alignmentOffset('left', 100, 40)).toBe(0);
    expect(alignmentOffset('center', 100, 40)).toBe(30);
    expect(alignmentOffset('right', 100, 40)).toBe(60);
  });

  it('places line baselines at the centre of each line box', () => {
    expect(lineBaseline(0, 20)).toBe(10);
    expect(lineBaseline(2, 20)).toBe(50);
  });
});

type Recorded = { readonly text: string; readonly x: number; readonly y: number };

function recordingContext(): { context: TextPaintContext; calls: Recorded[]; fonts: string[] } {
  const calls: Recorded[] = [];
  const fonts: string[] = [];
  let font = '';
  const context: TextPaintContext = {
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
      fonts.push(value);
    },
    textAlign: 'left',
    textBaseline: 'top',
    fillStyle: '#000000',
    fillText(text, x, y) {
      calls.push({ text, x, y });
    },
    measureText(text) {
      return { width: measure(text) };
    },
  };
  return { context, calls, fonts };
}

describe('paintTextLine', () => {
  const layerSettings = settings({ fontSize: 20, lineHeight: 1, color: '#ff0000' });

  it('draws a whole run in one call and positions it for left alignment', () => {
    const { context, calls, fonts } = recordingContext();
    paintTextLine(context, {
      line: { text: 'Hello', width: 50 },
      settings: layerSettings,
      frameWidth: 200,
      origin: { x: 10, y: 30 },
    });
    expect(calls).toEqual([{ text: 'Hello', x: 10, y: 30 }]);
    expect(fonts[0]).toContain('20px');
    expect(context.fillStyle).toBe('#ff0000');
  });

  it('centres and right-aligns inside the frame', () => {
    const centred = recordingContext();
    paintTextLine(centred.context, {
      line: { text: 'Ab', width: 20 },
      settings: settings({ align: 'center' }),
      frameWidth: 100,
      origin: { x: 0, y: 10 },
    });
    expect(centred.calls[0]?.x).toBe(40);

    const right = recordingContext();
    paintTextLine(right.context, {
      line: { text: 'Ab', width: 20 },
      settings: settings({ align: 'right' }),
      frameWidth: 100,
      origin: { x: 0, y: 10 },
    });
    expect(right.calls[0]?.x).toBe(80);
  });

  it('draws a space as a gap rather than an invisible glyph when letter spacing is set', () => {
    const { context, calls } = recordingContext();
    paintTextLine(context, {
      line: { text: 'ab c', width: 46 },
      settings: settings({ letterSpacing: 2 }),
      frameWidth: 100,
      origin: { x: 0, y: 0 },
    });
    expect(calls.map((call) => call.text)).toEqual(['a', 'b', 'c']);
    expect(calls.map((call) => call.x)).toEqual([0, 12, 36]);
  });

  it('draws a letter-spaced run exactly as wide as the text that was measured', () => {
    // A font that kerns: the pair is narrower than the two characters measured on their own.
    const kerned = (text: string) => (text === 'AV' ? 18 : text.length * 10);
    const calls: Recorded[] = [];
    const context: TextPaintContext = {
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      fillStyle: '#000000',
      fillText(text, x, y) {
        calls.push({ text, x, y });
      },
      measureText(text) {
        return { width: kerned(text) };
      },
    };

    const spacing = 4;
    // The layout measured the shaped run: 18 wide, plus one gap of 4.
    paintTextLine(context, {
      line: { text: 'AV', width: 18 + spacing },
      settings: settings({ letterSpacing: spacing, align: 'right' }),
      frameWidth: 100,
      origin: { x: 0, y: 0 },
    });

    const last = calls[calls.length - 1];
    expect(last?.text).toBe('V');
    // Right aligned, the run has to end at the frame's edge: 100 - 22 + 12 + 10 = 100. Drawn one
    // character after another it would end at 102, past the frame.
    expect((last?.x ?? 0) + 10).toBe(100);
  });

  it('draws nothing for an empty line', () => {
    const { context, calls } = recordingContext();
    paintTextLine(context, {
      line: { text: '', width: 0 },
      settings: layerSettings,
      frameWidth: 100,
      origin: { x: 0, y: 0 },
    });
    expect(calls).toEqual([]);
  });
});
