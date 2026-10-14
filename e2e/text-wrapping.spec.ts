import { expect, test, type Page } from '@playwright/test';

import {
  addLayer,
  artboardScale,
  createProject,
  layerNamed,
  readNumberField,
  selectLayerFromList,
  setNumberField,
  setZoom,
  stored,
  type StoredDocument,
  type StoredFrame,
  type ZoomPercent,
} from './fixtures';
import { readInkBands, type InkBand, type InkReading } from './pixels';

/**
 * Text wrapping, measured from the pixels the browser painted.
 *
 * jsdom has no rasteriser, so the unit suite asserts the renderer's wrapping against a recording
 * canvas and a stub measure. This spec closes the other half of the question: with the *real* font
 * metrics of a real browser, does a constrained text box break its words into the same lines at every
 * zoom level, and does the drawing stay inside the box?
 *
 * The measurement is made on the artboard's own canvas - the same buffer the user is looking at - and
 * the lines are the runs of ink rows the browser actually painted. Nothing is mocked and nothing is
 * assumed about which font is installed: the assertions only depend on the layout being consistent
 * within one browser. The one document fact they use is the line grid, because line height is
 * 1.2 x the font size in this document, and the spec reads the font size back from the interface
 * rather than repeating it.
 */

/**
 * A doubled device pixel ratio, so a quarter-scale reading still has enough device rows to tell one
 * text line from the next. The layout in CSS pixels is unchanged by this.
 */
test.use({ deviceScaleFactor: 2 });

const CANVAS = { width: 400, height: 300 } as const;
const CONTENT = 'Wrap every line where the renderer measured it at this width';
const WIDE = { x: 10, y: 20, width: 380, height: 240 } as const;
const NARROW_WIDTH = 160;

/**
 * One text layer with a known box, content and size, created through the interface.
 *
 * The font size is set explicitly rather than inherited, because the line grid the assertions use
 * comes from it: a line occupies `lineHeight x fontSize` document pixels, and the first line is
 * centred half a line below the top of the box.
 */
async function textDocument(
  page: Page,
  options: { readonly width: number },
): Promise<{
  readonly canvas: StoredDocument['canvas'];
  readonly frame: StoredFrame;
  readonly fontSize: number;
}> {
  await createProject(page, { ...CANVAS });
  await addLayer(page, 'Text');
  await selectLayerFromList(page, 'Text');

  const content = page.getByLabel('Content', { exact: true });
  await content.fill(CONTENT);
  await content.blur();
  await setNumberField(page, 'Size', 40);
  await setNumberField(page, 'Layer X', WIDE.x);
  await setNumberField(page, 'Layer Y', WIDE.y);
  await setNumberField(page, 'Layer height', WIDE.height);
  await setNumberField(page, 'Layer width', options.width);

  const document = await stored(page);
  return {
    canvas: document.canvas,
    frame: layerNamed(document, 'Text').frame,
    fontSize: await readNumberField(page, 'Size'),
  };
}

function centres(bands: readonly InkBand[]): readonly number[] {
  return bands.map((band) => band.centre);
}

/**
 * The frame's own column of the canvas, from the top of the box to the bottom of the document.
 *
 * Reading this rather than only the box means a line painted *below* the box would still be counted,
 * so "the lines are the same at every zoom" cannot be satisfied by a zoom level that quietly stopped
 * drawing part of the text.
 */
function columnOf(canvas: StoredDocument['canvas'], frame: StoredFrame): StoredFrame {
  return { x: frame.x, y: frame.y, width: frame.width, height: canvas.height - frame.y };
}

/**
 * Asserts that two readings describe the same lines.
 *
 * The tolerance allows for the coarser sampling of a quarter-scale zoom: at 25% a line is described
 * by a quarter as many device rows, so its measured centre can move by a fraction of a document
 * pixel without the layout having changed. Band *counts* are compared exactly - one extra or missing
 * line is never within tolerance, which is what catches a zoom level that wrapped differently.
 */
function expectSameLines(a: readonly InkBand[], b: readonly InkBand[], zoom: ZoomPercent): void {
  expect(centres(b), `the lines at ${String(zoom)}%`).toHaveLength(a.length);
  const tolerance = Math.max(1.5, 1.5 / (zoom / 100));
  a.forEach((band, index) => {
    const other = b[index];
    if (!other)
      throw new Error(`the ${String(zoom)}% reading is missing line ${String(index + 1)}`);
    expect(
      Math.abs(other.centre - band.centre),
      `line ${String(index + 1)} moved between zoom levels`,
    ).toBeLessThanOrEqual(tolerance);
  });
}

test.describe('text wrapping with real browser metrics', () => {
  test('draws the wrapped lines inside the box and keeps them at every zoom', async ({ page }) => {
    const { canvas, frame, fontSize } = await textDocument(page, { width: WIDE.width });
    const lineHeight = fontSize * 1.2;

    await setZoom(page, 100);
    const base: InkReading = await readInkBands(page, columnOf(canvas, frame));

    // The box really is constraining the text: this string cannot fit on one line. The reading is in
    // the message, so a failure reports what the browser drew rather than only a number.
    expect(
      base.bands.length,
      `the browser drew ${String(base.bands.length)} ink band(s): ${JSON.stringify(base.bands)}`,
    ).toBeGreaterThan(1);

    // The lines sit on the frame's own line grid: the first line is centred half a line height below
    // the top of the box, and every further line is one line height below that. This is a document
    // fact, not a renderer call.
    base.bands.forEach((band, index) => {
      const expected = frame.y + lineHeight * (index + 0.5);
      expect(
        Math.abs(band.centre - expected),
        `line ${String(index + 1)} should be centred on the frame's line grid`,
      ).toBeLessThanOrEqual(Math.max(3, lineHeight * 0.25));
    });

    // Wrapping means the words stay inside the frame. The slack is one device pixel of antialiasing,
    // which is coarser in document pixels the further the artboard is zoomed out.
    const insideRight = (zoom: ZoomPercent): number => frame.x + frame.width + 1 + 1 / (zoom / 100);
    for (const band of base.bands) {
      expect(band.left).toBeGreaterThanOrEqual(frame.x - 1);
      expect(band.right).toBeLessThanOrEqual(insideRight(100));
    }

    // The same lines, at the other zoom levels the control offers. `expectSameLines` compares the
    // centres line by line and the counts exactly, so a zoom that rewrapped the text fails here.
    for (const zoom of [25, 200] as const) {
      await setZoom(page, zoom);
      // The surface under test is the canvas, not the scroll area around it: at 200% a 400x300
      // document is wider than the pane, and what matters is that the artboard really re-rendered at
      // the new scale. The canvas keeps a buffer of the whole document whatever the pane is showing,
      // which is why the reading is taken from its pixels rather than from a screenshot.
      const { scale } = await artboardScale(page);
      expect(scale).toBeCloseTo(zoom / 100, 6);
      const reading = await readInkBands(page, columnOf(canvas, frame));
      expect(reading.bands.length, `the number of lines at ${String(zoom)}%`).toBe(
        base.bands.length,
      );
      expectSameLines(base.bands, reading.bands, zoom);
      reading.bands.forEach((band, index) => {
        expect(
          band.right,
          `line ${String(index + 1)} runs past the box at ${String(zoom)}%`,
        ).toBeLessThanOrEqual(insideRight(zoom));
      });
    }
  });

  test('keeps the drawing inside the box when the content needs more lines than fit', async ({
    page,
  }) => {
    const { canvas, frame, fontSize } = await textDocument(page, { width: WIDE.width });
    await setZoom(page, 100);
    const wide = await readInkBands(page, columnOf(canvas, frame));

    // Narrow the same content. Fewer characters fit on a line, so the wrap changes.
    await setNumberField(page, 'Layer width', NARROW_WIDTH);
    const narrowed = layerNamed(await stored(page), 'Text').frame;
    expect(narrowed.width).toBe(NARROW_WIDTH);

    const narrow = await readInkBands(page, columnOf(canvas, narrowed));
    // The wide box was genuinely used: at least one of its lines is wider than the narrow box, so the
    // two layouts cannot be the same wrap.
    expect(
      Math.max(...wide.bands.map((band) => band.right - band.left)),
      'the wide box should have wrapped into a line wider than the narrow box',
    ).toBeGreaterThan(NARROW_WIDTH);
    // Every line of the narrow wrap respects the narrow box, and the box holds fewer lines than the
    // content needs, so the count is bounded by the box rather than by the text.
    for (const band of narrow.bands) {
      expect(band.left).toBeGreaterThanOrEqual(narrowed.x - 1);
      expect(band.right).toBeLessThanOrEqual(narrowed.x + NARROW_WIDTH + 1);
    }
    const linesThatFit = Math.floor(narrowed.height / (fontSize * 1.2));
    expect(narrow.bands.length).toBeLessThanOrEqual(linesThatFit);
    // A narrower box can only need more lines, never fewer.
    expect(narrow.bands.length).toBeGreaterThanOrEqual(wide.bands.length);

    // Nothing is painted below the box. The export report tells the user that text taller than its
    // box is clipped, and the artboard uses the same painter, so this is where that promise is kept:
    // the rows under the frame hold no ink at all.
    const below = await readInkBands(page, {
      x: 0,
      y: narrowed.y + narrowed.height,
      width: canvas.width,
      height: canvas.height - narrowed.y - narrowed.height,
    });
    expect(below.bands, 'the drawing should stop at the bottom of the box').toEqual([]);
    expect(below.inkRows).toBe(0);
  });
});
