import { expect, test, type Page } from '@playwright/test';

import {
  addLayer,
  addLayerToSelection,
  artboardScale,
  centreOf,
  clickInDocument,
  createProject,
  dragInDocument,
  historyLabels,
  layerNamed,
  renameSelectedLayer,
  selectLayerFromList,
  setSnapping,
  stored,
  storedWhen,
} from './fixtures';

/**
 * The editing experience in a real browser.
 *
 * These specs exist because jsdom cannot verify pointer capture, a real rasteriser or real focus
 * behaviour. Assertions read back the document the application *persisted*, so a passing run means
 * the saved document changed in exactly the way a person would expect.
 *
 * Fixture layout: an 800x500 canvas holding a Rectangle (bottom) and a Text layer (top). The text
 * box sits above the shape, so every click target is unambiguous.
 */

/** Moves a handle by a document-space delta, whatever zoom the stage is using. */
async function dragHandle(
  page: Page,
  testId: string,
  delta: { readonly x: number; readonly y: number },
  duringDrag?: () => Promise<void>,
): Promise<void> {
  const handle = page.getByTestId(testId);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`${testId} has no box to drag`);
  const { scale } = await artboardScale(page);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x * scale, from.y + delta.y * scale, { steps: 10 });
  if (duringDrag) await duringDrag();
  await page.mouse.up();
}

test.describe('opening a project', () => {
  test('creates a project, then text and shape layers', async ({ page }) => {
    await createProject(page);

    await addLayer(page, 'Rectangle');
    await addLayer(page, 'Text');

    const document = await stored(page);
    expect(document.canvas.width).toBe(800);
    expect(document.canvas.height).toBe(500);
    expect(document.scene.layers.map((layer) => layer.type)).toEqual(['rect', 'text']);
    expect(await historyLabels(page)).toEqual(['Add text layer', 'Add rectangle layer']);

    // Both appear in the layer tree, top-first, and the artboard paints them.
    await expect(page.getByRole('button', { name: 'Lock “Text”' })).toBeVisible();
    await expect(page.locator('[data-testid^="layer-row-"]')).toHaveCount(2);
    await expect(page.getByRole('img', { name: /Artboard preview: 2 layers/ })).toBeVisible();
  });
});

test.describe('artboard interaction', () => {
  test.beforeEach(async ({ page }) => {
    await createProject(page);
    await setSnapping(page, false);
    await addLayer(page, 'Rectangle');
    await addLayer(page, 'Text');
  });

  test('selects one layer, modifier-selects another, and removes it again', async ({ page }) => {
    const before = await stored(page);
    const rectangle = centreOf(layerNamed(before, 'Rectangle').frame);
    const text = centreOf(layerNamed(before, 'Text').frame);

    await clickInDocument(page, rectangle);
    // A single selection gets the per-layer inspector: the click picked the shape, not the text.
    await expect(page.getByLabel('Layer name')).toHaveValue('Rectangle');

    // Shift-click adds the text layer without moving anything.
    await clickInDocument(page, text, { modifier: 'Shift' });
    await expect(page.getByLabel('Selection X')).toBeVisible();
    expect(await historyLabels(page)).toEqual([]);

    // Shift-clicking the same layer removes it again, leaving the shape selected.
    await clickInDocument(page, text, { modifier: 'Shift' });
    await expect(page.getByLabel('Layer name')).toHaveValue('Rectangle');

    // Selecting is transient: nothing reached the document and nothing reached history.
    expect(await stored(page)).toEqual(before);
    expect(await historyLabels(page)).toEqual([]);
  });

  test('clears the selection with a plain click on empty space, but not a modified one', async ({
    page,
  }) => {
    const before = await stored(page);
    const rectangle = centreOf(layerNamed(before, 'Rectangle').frame);

    await clickInDocument(page, rectangle);
    await expect(page.getByLabel('Layer name')).toBeVisible();

    // A modified click on empty canvas leaves the selection alone.
    await clickInDocument(page, { x: 760, y: 460 }, { modifier: 'Shift' });
    await expect(page.getByLabel('Layer name')).toBeVisible();

    // A plain one clears it.
    await clickInDocument(page, { x: 760, y: 460 });
    await expect(page.getByLabel('Layer name')).toBeHidden();
    expect(await stored(page)).toEqual(before);
  });

  test('moves a multi-layer selection and keeps the arrangement', async ({ page }) => {
    await selectLayerFromList(page, 'Rectangle');
    await addLayerToSelection(page, 'Text');

    const before = await stored(page);
    const rectangle = layerNamed(before, 'Rectangle').frame;
    const text = layerNamed(before, 'Text').frame;

    // Dragging from inside one selected layer moves the whole selection by the same delta.
    await dragInDocument(page, centreOf(rectangle), {
      x: centreOf(rectangle).x + 60,
      y: centreOf(rectangle).y + 40,
    });

    const after = await storedWhen(
      page,
      (document) => layerNamed(document, 'Text').frame.x === text.x + 60,
      'the text layer should have moved with the group',
    );
    expect(layerNamed(after, 'Rectangle').frame).toEqual({
      x: rectangle.x + 60,
      y: rectangle.y + 40,
      width: rectangle.width,
      height: rectangle.height,
    });
    expect(layerNamed(after, 'Text').frame).toEqual({
      x: text.x + 60,
      y: text.y + 40,
      width: text.width,
      height: text.height,
    });
    expect(await historyLabels(page)).toEqual(['Move 2 layers']);
  });

  test('resizes a single object through its handle, in one commit', async ({ page }) => {
    const before = await stored(page);
    const rectangle = layerNamed(before, 'Rectangle').frame;
    const text = layerNamed(before, 'Text').frame;
    await selectLayerFromList(page, 'Rectangle');

    await dragHandle(page, 'handle-se', { x: 50, y: 30 });

    const after = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.width === rectangle.width + 50,
      'the rectangle should have been resized by the drag',
    );
    expect(layerNamed(after, 'Rectangle').frame).toEqual({
      x: rectangle.x,
      y: rectangle.y,
      width: rectangle.width + 50,
      height: rectangle.height + 30,
    });
    expect(layerNamed(after, 'Text').frame).toEqual(text);
    expect(await historyLabels(page)).toEqual(['Resize “Rectangle”']);
  });

  test('resizes a group as one transform, and undo restores every layer', async ({ page }) => {
    await selectLayerFromList(page, 'Rectangle');
    await addLayerToSelection(page, 'Text');

    const before = await stored(page);
    const rectangle = layerNamed(before, 'Rectangle').frame;
    const text = layerNamed(before, 'Text').frame;

    // The handle scales the group box, so the delta is a fifth of that box: a 1.2x scale in both
    // directions, derived from the document rather than from numbers copied into the test.
    const box = {
      x: Math.min(rectangle.x, text.x),
      y: Math.min(rectangle.y, text.y),
      right: Math.max(rectangle.x + rectangle.width, text.x + text.width),
      bottom: Math.max(rectangle.y + rectangle.height, text.y + text.height),
    };
    await dragHandle(page, 'handle-se', {
      x: (box.right - box.x) * 0.2,
      y: (box.bottom - box.y) * 0.2,
    });

    const after = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.width > rectangle.width,
      'the group should have been resized',
    );
    const scaledRectangle = layerNamed(after, 'Rectangle').frame;
    const scaledText = layerNamed(after, 'Text').frame;
    const factor = scaledRectangle.width / rectangle.width;

    expect(factor).toBeCloseTo(1.2, 2);
    // One transform for the whole selection: every edge scaled about the pinned top-left corner, so
    // both layers keep their position within the box and their proportions.
    expect(scaledRectangle.x).toBeCloseTo(box.x + (rectangle.x - box.x) * factor, 1);
    expect(scaledRectangle.y).toBeCloseTo(box.y + (rectangle.y - box.y) * factor, 1);
    expect(scaledRectangle.height / rectangle.height).toBeCloseTo(factor, 2);
    expect(scaledText.x).toBeCloseTo(box.x + (text.x - box.x) * factor, 1);
    expect(scaledText.y).toBeCloseTo(box.y + (text.y - box.y) * factor, 1);
    expect(scaledText.width / text.width).toBeCloseTo(factor, 2);
    expect(await historyLabels(page)).toEqual(['Resize 2 layers']);

    // One undo restores both layers: the group is a single history entry, not one per layer.
    await page.getByRole('button', { name: 'Undo' }).click();
    const undone = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.width === rectangle.width,
      'undo should restore the group',
    );
    expect(layerNamed(undone, 'Text').frame).toEqual(text);
    expect(await historyLabels(page)).toEqual([]);
  });

  test('cancels a gesture with Escape and commits nothing', async ({ page }) => {
    await selectLayerFromList(page, 'Rectangle');
    const before = await stored(page);
    const rectangle = layerNamed(before, 'Rectangle').frame;

    await dragInDocument(
      page,
      centreOf(rectangle),
      { x: centreOf(rectangle).x + 90, y: centreOf(rectangle).y + 70 },
      { duringDrag: () => page.keyboard.press('Escape') },
    );

    // A cancelled resize is dropped too.
    await dragHandle(page, 'handle-se', { x: 40, y: 40 }, () => page.keyboard.press('Escape'));

    expect(layerNamed(await stored(page), 'Rectangle').frame).toEqual(rectangle);
    expect(await historyLabels(page)).toEqual([]);
  });

  test('never transforms a locked layer from the artboard', async ({ page }) => {
    await selectLayerFromList(page, 'Rectangle');
    await page.getByRole('button', { name: 'Lock “Rectangle”' }).click();
    const locked = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').locked,
      'the rectangle should be locked',
    );
    const frame = layerNamed(locked, 'Rectangle').frame;
    await expect(page.getByRole('button', { name: 'Unlock “Rectangle”' })).toBeVisible();

    // A drag that starts on the locked layer does nothing at all...
    await dragInDocument(page, centreOf(frame), {
      x: centreOf(frame).x + 70,
      y: centreOf(frame).y,
    });
    // ...and a click on it neither clears the selection nor picks up the shape underneath.
    await clickInDocument(page, centreOf(frame));

    expect(layerNamed(await stored(page), 'Rectangle').frame).toEqual(frame);
    expect(await historyLabels(page)).toEqual(['Lock “Rectangle”']);
    await expect(page.getByTestId('artboard-surface')).toHaveAttribute('title', /locked/i);
  });

  test('offers no resize handles when the whole selection is locked', async ({ page }) => {
    await selectLayerFromList(page, 'Rectangle');
    await page.getByRole('button', { name: 'Lock “Rectangle”' }).click();
    await selectLayerFromList(page, 'Text');
    await page.getByRole('button', { name: 'Lock “Text”' }).click();
    await storedWhen(
      page,
      (document) => document.scene.layers.every((layer) => layer.locked),
      'every layer should be locked',
    );

    // Select both from the list: nothing can be transformed, so nothing promises to be.
    await selectLayerFromList(page, 'Rectangle');
    await addLayerToSelection(page, 'Text');

    // The selection is still visible, the handles are absent, and both the artboard and the rail say
    // why rather than leaving a dead-looking selection behind.
    await expect(page.getByTestId('selection-overlay')).toBeVisible();
    await expect(page.getByTestId('handle-se')).toHaveCount(0);
    await expect(
      page.locator('p', { hasText: /Every selected layer is locked/i }).first(),
    ).toBeVisible();
    await expect(page.getByLabel('Selection X')).toHaveCount(0);
  });

  test('leaves a locked layer out of a group gesture made in the layer list', async ({ page }) => {
    await selectLayerFromList(page, 'Rectangle');
    await page.getByRole('button', { name: 'Lock “Rectangle”' }).click();
    const locked = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').locked,
      'the rectangle should be locked',
    );
    const frame = layerNamed(locked, 'Rectangle').frame;

    await selectLayerFromList(page, 'Rectangle');
    await addLayerToSelection(page, 'Text');
    const text = layerNamed(await stored(page), 'Text').frame;

    await dragInDocument(page, centreOf(text), { x: centreOf(text).x + 40, y: centreOf(text).y });

    const after = await storedWhen(
      page,
      (document) => layerNamed(document, 'Text').frame.x === text.x + 40,
      'the unlocked layer should have moved',
    );
    expect(layerNamed(after, 'Rectangle').frame).toEqual(frame);
    expect(await historyLabels(page)).toEqual(['Lock “Rectangle”', 'Move “Text”']);
  });

  test('duplicates and reorders a multi-layer selection in single steps', async ({ page }) => {
    // Distinct names so every object the commands must preserve can be named in the assertions.
    await selectLayerFromList(page, 'Rectangle');
    await renameSelectedLayer(page, 'Panel');
    await selectLayerFromList(page, 'Text');
    await renameSelectedLayer(page, 'Headline');

    await selectLayerFromList(page, 'Panel');
    await addLayerToSelection(page, 'Headline');

    await page.getByRole('button', { name: 'Duplicate selection' }).click();
    const duplicated = await storedWhen(
      page,
      (document) => document.scene.layers.length === 4,
      'duplicating the pair should add two layers',
    );
    expect(duplicated.scene.layers.map((layer) => layer.name)).toEqual([
      'Panel',
      'Panel copy',
      'Headline',
      'Headline copy',
    ]);

    // Reordering moves the whole selected block and keeps the pair's relative order.
    await page.getByRole('button', { name: 'To front' }).click();
    const layerOrder = (document: {
      readonly scene: { readonly layers: readonly { readonly name: string }[] };
    }) => document.scene.layers.map((layer) => layer.name).join(' | ');
    const reordered = await storedWhen(
      page,
      (document) => layerOrder(document) === 'Panel copy | Headline copy | Panel | Headline',
      'the selected pair should have moved to the top of the stack',
    );
    expect(reordered.scene.layers.map((layer) => layer.name)).toEqual([
      'Panel copy',
      'Headline copy',
      'Panel',
      'Headline',
    ]);
    // Two clicks, two history entries: no per-layer patch is hiding in between.
    expect(await historyLabels(page)).toEqual([
      'Bring to front: 2 layers',
      'Duplicate 2 layers',
      'Rename layer to “Headline”',
      'Rename layer to “Panel”',
    ]);
  });

  test('reaches the layer list and the inspector from the keyboard alone', async ({ page }) => {
    // The list is one tab stop; the focused row is activated with Enter.
    const row = page.locator('[data-testid^="layer-name-"]').filter({ hasText: 'Text' });
    await row.focus();
    await expect(row).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Layer name')).toHaveValue('Text');

    // Then resize by typing, which needs no pointer at all.
    const width = page.getByLabel('Layer width');
    await width.fill('240');
    await width.press('Enter');

    const after = await storedWhen(
      page,
      (document) => layerNamed(document, 'Text').frame.width === 240,
      'the typed width should have been applied',
    );
    expect(layerNamed(after, 'Text').frame.width).toBe(240);
  });

  test('moves the selection with the arrow keys on the artboard surface', async ({ page }) => {
    const rectangle = layerNamed(await stored(page), 'Rectangle').frame;
    await clickInDocument(page, centreOf(rectangle));

    await page.getByTestId('artboard-surface').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');

    const after = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.x === rectangle.x + 1,
      'the arrow keys should have nudged the selection',
    );
    expect(layerNamed(after, 'Rectangle').frame.y).toBe(rectangle.y + 10);
    expect(await historyLabels(page)).toEqual(['Move “Rectangle”', 'Move “Rectangle”']);
  });

  test('clears the selection with Escape on the surface', async ({ page }) => {
    const rectangle = layerNamed(await stored(page), 'Rectangle').frame;
    await clickInDocument(page, centreOf(rectangle));
    await expect(page.getByLabel('Layer name')).toBeVisible();

    await page.getByTestId('artboard-surface').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Layer name')).toBeHidden();
    expect(await historyLabels(page)).toEqual([]);
  });

  test('selects with a marquee, adding when the marquee is modified', async ({ page }) => {
    const before = await stored(page);
    const rectangle = layerNamed(before, 'Rectangle').frame;
    const text = layerNamed(before, 'Text').frame;

    // A plain marquee over empty space selects everything it covers: both layers, so the panel
    // switches to the multi-selection bounds.
    await dragInDocument(page, { x: 10, y: 10 }, { x: 780, y: 480 });
    await expect(page.getByLabel('Selection X')).toBeVisible();

    // A plain marquee that covers only the shape replaces the selection with the shape. It starts
    // below the text box and left of the shape, so the press itself lands on empty canvas.
    await dragInDocument(
      page,
      { x: rectangle.x - 20, y: text.y + text.height + 10 },
      { x: rectangle.x + rectangle.width + 10, y: rectangle.y + rectangle.height + 10 },
    );
    await expect(page.getByLabel('Layer name')).toHaveValue('Rectangle');

    // A Shift marquee unions instead: the text box is added to the shape rather than replacing it.
    await dragInDocument(
      page,
      { x: text.x - 10, y: text.y - 10 },
      { x: text.x + text.width + 10, y: text.y + text.height + 4 },
      { modifier: 'Shift' },
    );
    await expect(page.getByLabel('Selection X')).toBeVisible();

    expect(await historyLabels(page)).toEqual([]);
  });
});
