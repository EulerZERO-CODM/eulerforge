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
  type StoredDocument,
  type StoredFrame,
  type ZoomPercent,
} from './fixtures';
import { strongestVerticalLine } from './pixels';

/**
 * Snapping, as pixels rather than as arithmetic.
 *
 * The unit suite asserts snapping in document space. These specs drag a layer in real Chromium and
 * then check three separate things:
 *
 *   - the frame the application *persisted* landed on the snap target,
 *   - the guide the application *drew* is at the screen position that target maps to, measured from
 *     the artboard's own rendered box rather than from a viewport offset, and
 *   - the guide is really painted there, by looking for the strongest vertical line in a screenshot
 *     of the artboard, in rows the layer and its selection chrome do not occupy.
 *
 * Nothing here assumes a device pixel ratio or a particular pane size: every screen coordinate comes
 * from the artboard box and the document size the artboard reports, so the same spec is true at 25%,
 * 100% and 200%.
 */

/** Three screen pixels: inside the six-pixel snap threshold at every zoom, so snapping has to fire. */
const POINTER_OFFSET_SCREEN_PX = 3;

/**
 * One document per zoom level.
 *
 * The numbers are not arbitrary. `buildSnapTargets` builds a *dense* target list - the canvas edges,
 * the canvas centre, every twelfth/th eighth/sixth/quarter/third of each axis, the grid lines for the
 * document's grid spacing, and the edges of every layer that is not being dragged - and the closest
 * target within `6 / zoom` document pixels wins the snap. The pointer stops three screen pixels past
 * the canvas centre, so for the canvas centre to be the target that wins, every other edge of the
 * dragged frame has to be further from every other target than the centre is from the centre line.
 * Each fixture below was checked against that model (including the grid step for the document's
 * 96 dpi and a +/- 1.5 screen pixel uncertainty in the pointer position). The narrowest margin is
 * 2.8 screen pixels on the 100% fixture, and the widest 13.2 on the 200% one, so a stray target
 * cannot quietly take over and make the spec measure something else.
 *
 * The layer is also positioned inside the canvas, because the drag has to start on the layer.
 */
/** The zoom levels this spec exercises: the two extremes the control offers, plus the identity. */
type SnappingZoom = Extract<ZoomPercent, 25 | 100 | 200>;

const FIXTURES: Record<
  SnappingZoom,
  {
    readonly canvas: { readonly width: number; readonly height: number };
    readonly gridMm: number;
    readonly layer: StoredFrame;
  }
> = {
  25: {
    canvas: { width: 800, height: 600 },
    // A 100 mm grid is 377.95 document pixels: at a quarter scale the default 10 mm grid would put
    // lines 9.4 screen pixels apart, so nearly every position would be within the threshold of one
    // and the canvas centre could not be isolated.
    gridMm: 100,
    layer: { x: 300, y: 260, width: 144, height: 48 },
  },
  100: {
    canvas: { width: 320, height: 240 },
    gridMm: 10,
    layer: { x: 60, y: 10, width: 68, height: 188 },
  },
  200: {
    canvas: { width: 320, height: 240 },
    gridMm: 10,
    layer: { x: 60, y: 15, width: 72, height: 188 },
  },
};

/**
 * The document the short-drag specs use.
 *
 * Every edge of this frame is at least 6.6 document pixels away from every snap target before and
 * after a (3, 2) drag, over a +/- 1 document pixel window for pointer rounding, so nothing can snap
 * and the pointer delta is the only thing that decides where the layer lands.
 */
const SHORT_DRAG = {
  canvas: { width: 320, height: 240 },
  gridMm: 10,
  layer: { x: 20, y: 66, width: 76, height: 60 },
} as const;

/**
 * A document with one rectangle, no *visible* guide that could be mistaken for a snapping line, and a
 * grid spacing that cannot compete with the target under test.
 *
 * The safe margin is set to zero (its box lands exactly on the canvas edge) and the centre lines are
 * switched off, so the only thing drawn at the canvas centre during the drag is the snapping guide.
 */
async function snappingDocument(
  page: Page,
  fixture: {
    readonly canvas: { readonly width: number; readonly height: number };
    readonly gridMm: number;
    readonly layer: StoredFrame;
  },
): Promise<{ readonly canvas: StoredDocument['canvas']; readonly frame: StoredFrame }> {
  await createProject(page, { width: fixture.canvas.width, height: fixture.canvas.height });
  await setNumberField(page, 'Safe margin', 0);
  await setSwitch(page, 'Centre lines', false);
  await setNumberField(page, 'Grid spacing', fixture.gridMm);

  await addLayer(page, 'Rectangle');
  await selectLayerFromList(page, 'Rectangle');
  await setNumberField(page, 'Layer X', fixture.layer.x);
  await setNumberField(page, 'Layer Y', fixture.layer.y);
  await setNumberField(page, 'Layer width', fixture.layer.width);
  await setNumberField(page, 'Layer height', fixture.layer.height);

  const document = await stored(page);
  const frame = layerNamed(document, 'Rectangle').frame;
  expect({
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
  }).toEqual(fixture.layer);
  return { canvas: document.canvas, frame };
}

type SnappingEvidence = {
  /** The target the guide was drawn for, straight off the guide element. */
  readonly guideDocumentX: number;
  readonly guideDocumentY: number;
  /** Where the guide's own box sits, measured from the artboard's rendered box. */
  readonly guideOffsetX: number;
  readonly guideOffsetY: number;
  readonly guideHeight: number;
  readonly artboardWidth: number;
  readonly artboardHeight: number;
  /** The strongest vertical line in a screenshot of the artboard, outside the layer's own rows. */
  readonly lineColumn: number;
  readonly lineContrast: number;
  readonly screenshotWidth: number;
  readonly screenshotHeight: number;
};

/**
 * Drags the rectangle so that its centre would land just past the canvas centre, then reports what
 * the product drew while the pointer was down.
 *
 * The pointer stops three screen pixels short of an exact landing, so the frame can only end up on
 * the target if snapping moved it there.
 */
async function dragTowardsCentre(
  page: Page,
  zoom: ZoomPercent,
  options: {
    readonly canvas: StoredDocument['canvas'];
    readonly frame: StoredFrame;
  },
): Promise<SnappingEvidence> {
  const scale = zoom / 100;
  const offsetDocumentPx = POINTER_OFFSET_SCREEN_PX / scale;
  const target = { x: options.canvas.width / 2, y: options.canvas.height / 2 };
  const from = centreOf(options.frame);
  const to = {
    x: from.x + (target.x - from.x) + offsetDocumentPx,
    y: from.y + (target.y - from.y) + offsetDocumentPx,
  };

  const { scale: renderedScale } = await artboardScale(page);
  // Rows below the layer, where only the guide can be: the frame itself, its outline and its resize
  // handles all live above the snapped frame's bottom edge, so a line found here is the guide.
  const strip = {
    from: Math.round((target.y + options.frame.height / 2) * scale) + 8,
    to: Math.round(options.canvas.height * scale) - 4,
  };
  expect(strip.to - strip.from).toBeGreaterThanOrEqual(5);

  const collected: { value: SnappingEvidence | null } = { value: null };
  await dragInDocument(page, from, to, {
    duringDrag: async () => {
      const guideX = page.getByTestId('snap-guide-x');
      const guideY = page.getByTestId('snap-guide-y');
      await expect(guideX).toBeVisible();
      await expect(guideY).toBeVisible();

      const box = await artboardBox(page);
      const guideBox = await guideX.boundingBox();
      if (!guideBox) throw new Error('the vertical snapping guide has no box');

      const shot = await page.getByTestId('artboard').screenshot();
      const hit = await strongestVerticalLine(shot, {
        minColumn: 4,
        maxColumn: Math.round(box.width) - 5,
        fromRow: strip.from,
        toRow: strip.to,
      });

      collected.value = {
        guideDocumentX: Number(await guideX.getAttribute('data-guide-document-x')),
        guideDocumentY: Number(await guideY.getAttribute('data-guide-document-y')),
        guideOffsetX: guideBox.x - box.x,
        guideOffsetY: guideBox.y - box.y,
        guideHeight: guideBox.height,
        artboardWidth: box.width,
        artboardHeight: box.height,
        lineColumn: hit.column,
        lineContrast: hit.contrast,
        screenshotWidth: Math.round(box.width),
        screenshotHeight: Math.round(box.height),
      };
      expect(renderedScale).toBeCloseTo(scale, 6);
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

      // A zoom level larger than the pane would leave the artboard partly outside the scroll area, so
      // the spec says so rather than measuring the wrong element by accident.
      await expect.poll(() => artboardIsClipped(page)).toBe(false);

      const scale = zoom / 100;
      const target = { x: canvas.width / 2, y: canvas.height / 2 };
      const committed = await historyLabels(page);
      const evidence = await dragTowardsCentre(page, zoom, { canvas, frame });

      // The guide the interface drew names the canvas centre line, on both axes...
      expect(evidence.guideDocumentX).toBe(target.x);
      expect(evidence.guideDocumentY).toBe(target.y);

      // ...it is *drawn* where that document coordinate maps to, measured from the artboard box...
      expect(Math.abs(evidence.guideOffsetX - target.x * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(evidence.guideOffsetY - target.y * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(evidence.guideHeight - evidence.artboardHeight)).toBeLessThanOrEqual(1);

      // ...and the screenshot really contains a line there, bright enough to be the guide rather than
      // the canvas background. The two columns either side of it are canvas.
      expect(evidence.screenshotWidth).toBe(Math.round(evidence.artboardWidth));
      expect(evidence.screenshotHeight).toBe(Math.round(evidence.artboardHeight));
      expect(Math.abs(evidence.lineColumn - Math.round(target.x * scale))).toBeLessThanOrEqual(1);
      expect(evidence.lineContrast).toBeGreaterThan(40);

      // The frame the application saved landed on the target exactly, at its original size.
      const after = await storedWhen(
        page,
        (document) => layerNamed(document, 'Rectangle').frame.x !== frame.x,
        'the dragged layer should have been committed',
      );
      const moved = layerNamed(after, 'Rectangle').frame;
      expect(moved.x + moved.width / 2).toBe(target.x);
      expect(moved.y + moved.height / 2).toBe(target.y);
      expect(moved.width).toBe(frame.width);
      expect(moved.height).toBe(frame.height);

      // One gesture, one labelled commit, on top of whatever the fixture itself recorded.
      expect(await historyLabels(page)).toEqual(['Move “Rectangle”', ...committed]);
    });
  }

  test('moves a layer a few pixels instead of snapping it back where it started', async ({
    page,
  }) => {
    const { frame } = await snappingDocument(page, SHORT_DRAG);
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
