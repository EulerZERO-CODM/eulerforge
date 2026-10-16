import { expect, test, type Page } from '@playwright/test';

import {
  FIXTURE_LABELS,
  addLayerToSelection,
  artboardFixture,
  clickInDocument,
  createProject,
  historyLabels,
  layerButton,
  layerNamed,
  placeGraphic,
  readNumberField,
  selectLayerFromList,
  setNumberField,
  setSnapping,
  setZoom,
  stored,
  storedWhen,
  type StoredDocument,
} from './fixtures';

/**
 * Undo and redo, integrated with storage and the keyboard.
 *
 * The unit and component halves of the action-to-test matrix (see docs/undo-redo-matrix.md) check
 * labels and transitions deterministically. This spec covers the three things only a browser can
 * answer:
 *
 *   1. **Persistence end to end.** After an edit and after every undo/redo, the document *in
 *      localStorage* is byte-for-byte the state that step should restore — not just the copy the
 *      interface is showing. Attribution and layer order are part of that comparison.
 *   2. **The real keyboard.** `Ctrl+Z` / `Ctrl+Shift+Z` through the browser's own event pipeline,
 *      including the rule that a focused text field keeps native undo instead of the document's.
 *   3. **What the interface says.** The history panel's labels and the enablement of its two buttons
 *      at each end of the stack, so "undo, save state and the UI can never disagree" is checked
 *      against the running product rather than against the session object.
 *
 * One documented limitation is asserted rather than glossed over: history is session-scoped, so
 * reopening a project keeps the saved edit but not the steps (the last spec).
 */

/** Headline graphic used wherever a placed catalogue graphic is needed. */
const PLACED = 'Aurora mesh';

/** The history panel, the one surface that is unambiguously about undo and redo. */
function historyPanel(page: Page) {
  return page.locator('section[aria-labelledby="history-panel-heading"]');
}

function undoButton(page: Page) {
  return historyPanel(page).getByRole('button', { name: 'Undo', exact: true });
}

function redoButton(page: Page) {
  return historyPanel(page).getByRole('button', { name: 'Redo', exact: true });
}

/**
 * A saved document reduced to what a history step must restore.
 *
 * `revision`, `createdAt` and `updatedAt` move whenever the document is written, so they are not part
 * of "the same document"; everything else is compared as serialised text, which is the strictest
 * comparison available and the one that catches a reordered layer list or a dropped attribution
 * record.
 */
function content(document: StoredDocument): string {
  const rest = { ...(document as unknown as Record<string, unknown>) };
  delete rest['revision'];
  delete rest['createdAt'];
  delete rest['updatedAt'];
  return JSON.stringify(rest);
}

/**
 * A point on the canvas that no layer covers, so a click there is a click on empty space.
 *
 * Scanned from the bottom-right corner because default frames are centred: a hard-coded "empty"
 * coordinate would start silently hitting a layer the moment a default changes.
 */
function emptyPoint(document: StoredDocument): { x: number; y: number } {
  const { width, height } = document.canvas;
  for (let row = 1; row <= 20; row += 1) {
    for (let column = 1; column <= 20; column += 1) {
      const point = { x: (width * (20 - column)) / 20, y: (height * (20 - row)) / 20 };
      const inside = document.scene.layers.some(
        (layer) =>
          point.x >= layer.frame.x - 8 &&
          point.x <= layer.frame.x + layer.frame.width + 8 &&
          point.y >= layer.frame.y - 8 &&
          point.y <= layer.frame.y + layer.frame.height + 8,
      );
      if (!inside) return point;
    }
  }
  throw new Error('every point of the canvas is covered by a layer');
}

/** The document's own undo shortcut, through the browser's keyboard. */
async function keyboardUndo(page: Page): Promise<void> {
  await page.keyboard.press('Control+z');
}

async function keyboardRedo(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+z');
}

test.describe('undo and redo in the workspace', () => {
  test('walks the document back and forward from the keyboard, in storage and in the panel', async ({
    page,
  }) => {
    await artboardFixture(page);
    await selectLayerFromList(page, 'Rectangle');

    const start = await stored(page);
    const x = await readNumberField(page, 'Layer X');
    await setNumberField(page, 'Layer X', x + 40);
    const afterField = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.x === x + 40,
      'the inspector edit should be saved',
    );

    // A second edit from the keyboard, on the surface rather than in a field.
    await page.getByTestId('artboard-surface').focus();
    await page.keyboard.press('ArrowRight');
    const afterNudge = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.x === x + 41,
      'the arrow-key move should be saved',
    );

    // One label per edit, newest first, and nothing else was recorded.
    expect(await historyLabels(page)).toEqual([
      'Move \u201cRectangle\u201d',
      `Move \u201cRectangle\u201d to x ${String(x + 40)}`,
      ...FIXTURE_LABELS,
    ]);
    await expect(undoButton(page)).toBeEnabled();

    await keyboardUndo(page);
    await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.x === x + 40,
      'undo should put the layer back where the inspector edit left it',
    );
    expect(content(await stored(page))).toBe(content(afterField));
    // The panel follows the document: the field shows the value that step restored.
    await expect(page.getByLabel('Layer X', { exact: true })).toHaveValue(String(x + 40));

    await keyboardUndo(page);
    await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.x === x,
      'the second undo should return to the original frame',
    );
    expect(content(await stored(page))).toBe(content(start));
    await expect(undoButton(page)).toBeDisabled();

    // A third undo has nothing behind it: no error, no change, no lost edit.
    await keyboardUndo(page);
    expect(content(await stored(page))).toBe(content(start));

    await keyboardRedo(page);
    await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.x === x + 40,
      'redo should reapply the inspector edit',
    );
    expect(content(await stored(page))).toBe(content(afterField));

    await keyboardRedo(page);
    await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.x === x + 41,
      'the second redo should reapply the keyboard move',
    );
    expect(content(await stored(page))).toBe(content(afterNudge));
    await expect(redoButton(page)).toBeDisabled();
  });

  test('takes a placed graphic\u2019s licence record with it through undo and redo', async ({
    page,
  }) => {
    await createProject(page, { title: 'Graphic undo', width: 600, height: 400 });
    const empty = await stored(page);

    await placeGraphic(page, PLACED);
    const placed = await storedWhen(
      page,
      (document) => document.scene.layers.length === 1 && document.attribution.length === 1,
      'placing the graphic should add the layer and its licence record',
    );
    expect(await historyLabels(page)).toEqual([`Place graphic \u201c${PLACED}\u201d`]);

    // Selecting the placed layer is transient: it must not add a step of its own.
    await selectLayerFromList(page, PLACED);
    expect(await historyLabels(page)).toEqual([`Place graphic \u201c${PLACED}\u201d`]);

    await undoButton(page).click();
    await storedWhen(
      page,
      (document) => document.scene.layers.length === 0,
      'undo should remove the placed layer',
    );
    expect(content(await stored(page))).toBe(content(empty));
    expect((await stored(page)).attribution).toHaveLength(0);

    await redoButton(page).click();
    const redone = await storedWhen(
      page,
      (document) => document.scene.layers.length === 1,
      'redo should put the layer back',
    );
    expect(content(await stored(page))).toBe(content(placed));
    // The licence, the asset and the placement moment all came back with it.
    expect(redone.attribution).toEqual(placed.attribution);
  });

  test('records nothing for an edit that is refused or changes nothing', async ({ page }) => {
    await artboardFixture(page);
    await selectLayerFromList(page, 'Text');

    const before = await stored(page);
    const labels = await historyLabels(page);
    const width = await readNumberField(page, 'Layer width');
    const field = page.getByLabel('Layer width', { exact: true });

    // Refused: below the smallest frame the model allows. The field explains itself rather than
    // committing something the canvas cannot hold.
    await field.fill('0');
    await field.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Width must be at least 1px.');
    expect(await historyLabels(page)).toEqual(labels);

    // Unchanged: committing the value that is already there is not an edit.
    await field.fill(String(width));
    await field.press('Enter');
    expect(await historyLabels(page)).toEqual(labels);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect
      .poll(async () => content(await stored(page)), {
        message: 'a refused or unchanged edit must not be written',
      })
      .toBe(content(before));
  });

  test('adds no step for selection, zoom, guides or snapping', async ({ page }) => {
    await artboardFixture(page);
    const before = await stored(page);
    const labels = await historyLabels(page);

    // View and selection state, every one of which the product documents as transient.
    await selectLayerFromList(page, 'Text');
    await addLayerToSelection(page, 'Rectangle');
    await clickInDocument(page, emptyPoint(before));
    await expect(layerButton(page, 'Text')).not.toHaveAttribute('aria-current', 'true');
    await setZoom(page, 200);
    await page.getByRole('button', { name: 'Hide guides', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Show guides', exact: true })).toBeVisible();
    await setSnapping(page, false);
    await setSnapping(page, true);

    expect(await historyLabels(page)).toEqual(labels);
    expect(content(await stored(page))).toBe(content(before));
    // The two real edits the fixture made are still undoable; nothing was added on top of them.
    await expect(undoButton(page)).toBeEnabled();
  });

  test('keeps the saved edit across a reload and starts a fresh history', async ({ page }) => {
    await artboardFixture(page);
    await selectLayerFromList(page, 'Rectangle');
    const x = await readNumberField(page, 'Layer X');
    await setNumberField(page, 'Layer X', x + 30);
    const saved = await storedWhen(
      page,
      (document) => layerNamed(document, 'Rectangle').frame.x === x + 30,
      'the edit should be saved before the reload',
    );

    await page.reload();
    await expect(page.getByTestId('artboard')).toBeVisible();
    await expect(layerButton(page, 'Rectangle')).toBeVisible();

    // The document came back exactly, and the interface does not pretend an old history still exists.
    expect(content(await stored(page))).toBe(content(saved));
    expect(await historyLabels(page)).toEqual([]);
    await expect(undoButton(page)).toBeDisabled();
    await expect(redoButton(page)).toBeDisabled();
  });
});
