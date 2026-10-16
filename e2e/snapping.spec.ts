import { expect, test, type Page } from '@playwright/test';

import {
  addLayer,
  artboardBox,
  artboardIsClipped,
  artboardScale,
  centreOf,
  createProject,
  dragInDocument,
  historyLabels,
  layerNamed,
  selectLayerFromList,
  setNumberField,
  setSnapping,
  setSwitch,
  setZoom,
  stored,
  storedWhen,
  type StoredFrame,
  type ZoomPercent,
} from './fixtures';
import { imageSize, strongestVerticalLine } from './pixels';

/**
 * Snapping, measured as pixels rather than as arithmetic.
 *
 * The unit suite asserts the snapping model in document space. These specs drag a layer in a real
 * Chromium build and then check three separate things:
 *
 *   1. the frame the application *persisted* landed exactly on the canvas centre line,
 *   2. the frame the pointer alone would have produced would have missed it by three screen pixels,
 *      so the correction is snapping rather than luck, and
 *   3. the guide the application *drew* is at the screen position that line maps to, measured from
 *      the artboard's own rendered box, and a screenshot of the artboard really contains a line
 *      there.
 *
 * Nothing here assumes a device pixel ratio, a viewport offset or a pane size: every screen
 * coordinate comes from the artboard box and from the document size the artboard reports.
 */

/** Three screen pixels: inside the six-pixel snap threshold at every zoom, so snapping has to fire. */
const POINTER_OFFSET_SCREEN_PX = 3;

/** Rows kept clear between the frame and the pixel strip, so only the guide can be in it. */
const STRIP_CLEARANCE_SCREEN_PX = 8;

/** The zoom levels this spec exercises: both ends of the control, plus the identity. */
type SnappingZoom = Extract<ZoomPercent, 100 | 200 | 25>;

/** Which of the frame's three values per axis ends up on the canvas centre line. */
type Winner = 'left' | 'centre' | 'right';
type WinnerY = 'top' | 'centre' | 'bottom';

type SnappingFixture = {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly gridMm: number;
  /** The frame the fixture types into the inspector, before the drag. */
  readonly layer: StoredFrame;
  /** The pointer's own travel, in document pixels. */
  readonly drag: { readonly x: number; readonly y: number };
  readonly winnerX: Winner;
  readonly winnerY: WinnerY;
  /** Where the frame lands, so the fixture and the expectation cannot drift apart. */
  readonly expected: StoredFrame;
};

/**
 * One document per zoom level. All three paint at or below 400x300 CSS pixels, which the specs at
 * 100% and 200% already proved the stage pane holds without scrolling, so the artboard is never
 * clipped at any of the zooms used here.
 *
 * Each fixture was chosen against the *real* model - `buildSnapTargets` plus `computeSnap` - with
 * three requirements:
 *
 *   - the pointer stops exactly three screen pixels past the canvas centre line on both axes, so one
 *     candidate wins each axis, and the runner-up is *further away than the snap threshold itself*:
 *     the snap is unambiguous rather than the closest of several near misses;
 *   - the pointer travels 40x30 screen pixels, comfortably past the 24-screen-pixel floor below
 *     which a gesture stops being a drag a person would recognise;
 *   - the frame ends with at least 60 screen pixels of bare canvas below it, which is where the
 *     pixel strip looks for the drawn guide.
 *
 * The frame is a rectangle because its edges are simply predicted, and the grid spacing is coarse
 * on purpose: the grid lines fall outside the threshold's reach rather than competing with the
 * centre line.
 */
const FIXTURES: Record<SnappingZoom, SnappingFixture> = {
  25: {
    canvas: { width: 1280, height: 960 },
    gridMm: 100,
    layer: { x: 764, y: 612, width: 96, height: 96 },
    drag: { x: -160, y: -120 },
    winnerX: 'centre',
    winnerY: 'top',
    expected: { x: 592, y: 480, width: 96, height: 96 },
  },
  100: {
    canvas: { width: 320, height: 240 },
    gridMm: 100,
    layer: { x: 203, y: 153, width: 24, height: 24 },
    drag: { x: -40, y: -30 },
    winnerX: 'left',
    winnerY: 'top',
    expected: { x: 160, y: 120, width: 24, height: 24 },
  },
  200: {
    canvas: { width: 160, height: 120 },
    gridMm: 100,
    layer: { x: 95, y: 70, width: 13, height: 13 },
    drag: { x: -20, y: -15 },
    winnerX: 'centre',
    winnerY: 'centre',
    expected: { x: 73.5, y: 53.5, width: 13, height: 13 },
  },
};

/** One of the frame's three values on an axis: its leading edge, its centre or its trailing edge. */
function edgeValue(frame: StoredFrame, winner: Winner | WinnerY, axis: 'x' | 'y'): number {
  const start = axis === 'x' ? frame.x : frame.y;
  const size = axis === 'x' ? frame.width : frame.height;
  if (winner === 'centre') return start + size / 2;
  return winner === 'left' || winner === 'top' ? start : start + size;
}

/** The frame the pointer alone would produce: the fixture frame plus the pointer's own travel. */
function pointerOnly(fixture: SnappingFixture): StoredFrame {
  return {
    x: fixture.layer.x + fixture.drag.x,
    y: fixture.layer.y + fixture.drag.y,
    width: fixture.layer.width,
    height: fixture.layer.height,
  };
}

/**
 * The document the short-drag specs use: a 320x240 canvas whose grid of 100 mm (378 document pixels)
 * produces no grid lines to snap to at all.
 *
 * This frame sits at least 7.5 document pixels from every remaining target - the canvas edges, its
 * centre and the twelfth/eighth/sixth/quarter/third divisions - so a three-pixel drag cannot snap.
 */
const SHORT_DRAG = {
  canvas: { width: 320, height: 240 },
  gridMm: 100,
  layer: { x: 20, y: 66, width: 76, height: 60 },
} as const;

/**
 * A document with one rectangle, no visible guide that could be mistaken for a snapping line, and a
 * grid that cannot compete with the centre line.
 *
 * The safe margin is set to zero (so its box sits exactly on the canvas edge), the centre lines are
 * switched off and the grid is left off, so the only thing drawn at the canvas centre during a drag
 * is the snapping guide itself. The spec asserts that absence rather than trusting it, because a
 * centre-line overlay would sit in exactly the column the pixel check looks at.
 */
async function snappingDocument(
  page: Page,
  fixture: {
    readonly canvas: { readonly width: number; readonly height: number };
    readonly gridMm: number;
    readonly layer: StoredFrame;
  },
): Promise<{
  readonly canvas: { readonly width: number; readonly height: number };
  readonly frame: StoredFrame;
}> {
  await createProject(page, { width: fixture.canvas.width, height: fixture.canvas.height });
  await setNumberField(page, 'Safe margin', 0);
  await setSwitch(page, 'Centre lines', false);
  await setSwitch(page, 'Grid', false);
  await setNumberField(page, 'Grid spacing', fixture.gridMm);

  await addLayer(page, 'Rectangle');
  await selectLayerFromList(page, 'Rectangle');
  await setNumberField(page, 'Layer X', fixture.layer.x);
  await setNumberField(page, 'Layer Y', fixture.layer.y);
  await setNumberField(page, 'Layer width', fixture.layer.width);
  await setNumberField(page, 'Layer height', fixture.layer.height);

  const document = await stored(page);
  const frame = layerNamed(document, 'Rectangle').frame;
  expect({ ...frame }).toEqual(fixture.layer);
  // Nothing decorative is drawn where the guide under test will be.
  expect(await page.locator('[data-guide="centre-x"]').count()).toBe(0);
  expect(await page.locator('[data-guide="centre-y"]').count()).toBe(0);
  expect(await page.locator('[data-guide="grid-x"], [data-guide="grid-y"]').count()).toBe(0);
  return { canvas: document.canvas, frame };
}

type SnappingEvidence = {
  /** The target each guide was drawn for, straight off the guide element. */
  readonly guideDocumentX: number;
  readonly guideDocumentY: number;
  /** Where each guide's own box sits, measured from the artboard's rendered box. */
  readonly guideOffsetX: number;
  readonly guideOffsetY: number;
  readonly guideHeight: number;
  readonly guideWidth: number;
  readonly artboardWidth: number;
  readonly artboardHeight: number;
  /** The strongest vertical line in a screenshot of the artboard, below the layer's own rows. */
  readonly lineColumn: number;
  readonly lineContrast: number;
  readonly screenshotWidth: number;
  readonly screenshotHeight: number;
};

/**
 * Drags the rectangle so that one of its edges or its centre stops three screen pixels past the
 * canvas centre line, and reports what the product drew while the pointer was down.
 *
 * The pointer stops short of an exact landing, so the frame can only end up on the centre line if
 * snapping moved it there - which the caller checks by comparing the saved frame with the frame the
 * pointer alone would have produced.
 */
async function dragOntoCentreLine(
  page: Page,
  zoom: SnappingZoom,
  fixture: SnappingFixture,
): Promise<SnappingEvidence> {
  const scale = zoom / 100;
  const from = centreOf(fixture.layer);
  const end = pointerOnly(fixture);
  const to = centreOf(end);

  const { scale: renderedScale } = await artboardScale(page);
  expect(renderedScale).toBeCloseTo(scale, 6);

  // Rows below the frame, where only the guide can be: the frame, its outline, its resize handles
  // (six screen pixels past its edge) and the selection ring all live above this strip.
  const strip = {
    from:
      Math.round((fixture.expected.y + fixture.expected.height) * scale) +
      STRIP_CLEARANCE_SCREEN_PX,
    to: Math.round(fixture.canvas.height * scale) - 4,
  };
  expect(strip.to - strip.from).toBeGreaterThanOrEqual(5);

  const collected: { value: SnappingEvidence | null } = { value: null };
  await dragInDocument(page, from, to, {
    duringDrag: async () => {
      const guideX = page.getByTestId('snap-guide-x');
      const guideY = page.getByTestId('snap-guide-y');
      await expect(guideX).toBeVisible();
      await expect(guideY).toBeVisible();

      // Each axis is measured from the guide that belongs to it: the vertical line reports where the
      // x target was drawn, the horizontal one where the y target was. A vertical line's own box
      // starts at the top of the artboard, so reading the y offset off it would only ever be zero.
      const artboard = await artboardBox(page);
      const boxX = await guideX.boundingBox();
      const boxY = await guideY.boundingBox();
      if (!boxX) throw new Error('the vertical snapping guide has no box');
      if (!boxY) throw new Error('the horizontal snapping guide has no box');

      const shot = await page.getByTestId('artboard').screenshot();
      const size = await imageSize(shot);
      const hit = await strongestVerticalLine(shot, {
        minColumn: 4,
        maxColumn: Math.round(artboard.width) - 5,
        fromRow: strip.from,
        toRow: strip.to,
      });

      collected.value = {
        guideDocumentX: Number(await guideX.getAttribute('data-guide-document-x')),
        guideDocumentY: Number(await guideY.getAttribute('data-guide-document-y')),
        guideOffsetX: boxX.x - artboard.x,
        guideOffsetY: boxY.y - artboard.y,
        guideHeight: boxX.height,
        guideWidth: boxY.width,
        artboardWidth: artboard.width,
        artboardHeight: artboard.height,
        lineColumn: hit.column,
        lineContrast: hit.contrast,
        screenshotWidth: size.width,
        screenshotHeight: size.height,
      };
    },
  });

  if (collected.value === null) throw new Error('the drag produced no evidence');
  return collected.value;
}

test.describe('snapping guides in a real browser', () => {
  for (const zoom of [25, 100, 200] as const) {
    test(`snaps onto the canvas centre line and draws the guide on it at ${String(zoom)}% zoom`, async ({
      page,
    }) => {
      const fixture = FIXTURES[zoom];
      const { canvas, frame } = await snappingDocument(page, fixture);
      await setZoom(page, zoom);

      // A zoom larger than the pane would leave the artboard partly outside the scroll area, so the
      // spec says so rather than measuring the wrong rows by accident.
      await expect.poll(() => artboardIsClipped(page)).toBe(false);

      const scale = zoom / 100;
      const centreLine = { x: canvas.width / 2, y: canvas.height / 2 };
      const offset = POINTER_OFFSET_SCREEN_PX / scale;
      const end = pointerOnly(fixture);
      const committed = await historyLabels(page);

      const evidence = await dragOntoCentreLine(page, zoom, fixture);

      // The guide the interface drew names the canvas centre line, on both axes...
      expect(evidence.guideDocumentX).toBe(centreLine.x);
      expect(evidence.guideDocumentY).toBe(centreLine.y);

      // ...it is drawn where that document coordinate maps to, measured from the artboard's box...
      expect(Math.abs(evidence.guideOffsetX - centreLine.x * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(evidence.guideOffsetY - centreLine.y * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(evidence.guideHeight - evidence.artboardHeight)).toBeLessThanOrEqual(1);
      expect(Math.abs(evidence.guideWidth - evidence.artboardWidth)).toBeLessThanOrEqual(1);

      // ...and a screenshot of the artboard really contains a line in that column, far brighter than
      // the canvas either side of it, in rows the layer itself does not occupy.
      expect(Math.abs(evidence.screenshotWidth - evidence.artboardWidth)).toBeLessThanOrEqual(2);
      expect(Math.abs(evidence.screenshotHeight - evidence.artboardHeight)).toBeLessThanOrEqual(2);
      expect(Math.abs(evidence.lineColumn - Math.round(centreLine.x * scale))).toBeLessThanOrEqual(
        1,
      );
      expect(evidence.lineContrast).toBeGreaterThan(40);

      // The frame the application saved: on the centre line, at its original size, and matching the
      // fixture's own expectation rather than a number derived from the product's behaviour.
      const after = await storedWhen(
        page,
        (document) => layerNamed(document, 'Rectangle').frame.x !== frame.x,
        'the dragged layer should have been committed',
      );
      const moved = layerNamed(after, 'Rectangle').frame;
      expect(Math.abs(edgeValue(moved, fixture.winnerX, 'x') - centreLine.x)).toBeLessThanOrEqual(
        0.01,
      );
      expect(Math.abs(edgeValue(moved, fixture.winnerY, 'y') - centreLine.y)).toBeLessThanOrEqual(
        0.01,
      );
      expect(moved.width).toBe(frame.width);
      expect(moved.height).toBe(frame.height);
      expect(Math.abs(moved.x - fixture.expected.x)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(moved.y - fixture.expected.y)).toBeLessThanOrEqual(0.05);

      // And it got there by snapping: the pointer alone would have left the frame three screen pixels
      // past the line on both axes, and the correction went the other way.
      expect(edgeValue(end, fixture.winnerX, 'x') - centreLine.x).toBeCloseTo(offset, 9);
      expect(edgeValue(end, fixture.winnerY, 'y') - centreLine.y).toBeCloseTo(offset, 9);
      expect(moved.x - end.x).toBeCloseTo(-offset, 6);
      expect(moved.y - end.y).toBeCloseTo(-offset, 6);

      // One gesture, one labelled commit, on top of whatever the fixture itself recorded.
      expect(await historyLabels(page)).toEqual(['Move “Rectangle”', ...committed]);
    });
  }

  test('moves a layer a few pixels instead of snapping it back where it started', async ({
    page,
  }) => {
    const { frame } = await snappingDocument(page, SHORT_DRAG);
    await setZoom(page, 100);
    const committed = await historyLabels(page);

    await dragInDocument(page, centreOf(frame), {
      x: centreOf(frame).x + 3,
      y: centreOf(frame).y + 2,
    });

    const after = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.x !== frame.x,
      'a drag shorter than the snap threshold should still be committed',
    );
    // The frame is exactly where the pointer left it. Snapping used to treat the layer's own starting
    // frame as a target, which pulled a short drag back onto itself and committed nothing at all.
    expect(layerNamed(after, 'Rectangle').frame).toEqual({
      x: frame.x + 3,
      y: frame.y + 2,
      width: frame.width,
      height: frame.height,
    });
    // A short drag is still one edit with one label, not a cancelled gesture.
    expect(await historyLabels(page)).toEqual(['Move “Rectangle”', ...committed]);
  });

  test('leaves the frame on the pointer delta, with no guide, when snapping is off', async ({
    page,
  }) => {
    const { canvas, frame } = await snappingDocument(page, SHORT_DRAG);
    await setZoom(page, 100);
    await setSnapping(page, false);

    const target = { x: canvas.width / 2, y: canvas.height / 2 };
    const centre = centreOf(frame);
    const to = {
      x: centre.x + (target.x - centre.x) + POINTER_OFFSET_SCREEN_PX,
      y: centre.y + (target.y - centre.y) + POINTER_OFFSET_SCREEN_PX,
    };

    let guidesSeen = 0;
    await dragInDocument(page, centre, to, {
      duringDrag: async () => {
        guidesSeen = await page.locator('[data-testid^="snap-guide-"]').count();
      },
    });

    // Snapping off means no guide and no correction: the frame stops where the pointer stopped, three
    // pixels past the centre line it would have snapped onto.
    expect(guidesSeen).toBe(0);
    const after = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.x !== frame.x,
      'the drag should have been committed',
    );
    const moved = layerNamed(after, 'Rectangle').frame;
    expect(Math.abs(moved.x + moved.width / 2 - to.x)).toBeLessThan(0.75);
    expect(Math.abs(moved.y + moved.height / 2 - to.y)).toBeLessThan(0.75);
    expect(moved.x + moved.width / 2).not.toBe(target.x);
    expect(moved.y + moved.height / 2).not.toBe(target.y);
  });
});
