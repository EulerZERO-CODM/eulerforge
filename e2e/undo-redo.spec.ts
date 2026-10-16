/**
 * Undo/redo in the browser: keystrokes, persistence and what must *not* create a step.
 *
 * The unit and component matrices (see docs/undo-redo-matrix.md) check the transition itself — one
 * action, one label, the previous document back byte for byte. This spec covers the parts only a
 * real browser can answer:
 *
 * - the global Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z shortcuts, including not firing while a text field
 *   has the caret;
 * - what is actually in `localStorage` after an undo and a redo, compared with the saved bytes, so
 *   "the document came back" means the *persisted* document and not just the screen;
 * - a placed graphic's licence record surviving an undo and a redo;
 * - refused, unchanged, cancelled and transient actions leaving no step behind;
 * - a reload keeping the edit and starting a fresh history, because history is a session, not a
 *   saved document field.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  FIXTURE_LABELS,
  addLayerToSelection,
  artboardFixture,
  clickInDocument,
  createProject,
  historyLabels,
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
 * The document's content, with the two fields every edit rewrites neutralised.
 *
 * `revision` and `updatedAt` move on every commit, including the ones an undo performs, so they say
 * nothing about whether the *edit* came back. Everything else — scene, attribution, canvas, guides,
 * palette, metadata and the layer order — has to match exactly.
 */
function content(document: StoredDocument): string {
  const copy: Record<string, unknown> = { ...document };
  copy.revision = 0;
  copy.updatedAt = '';
  return JSON.stringify(copy);
}

/* ------------------------------------------------------------------ locators, scoped to the UI */

const historyPanel = (page: Page) =>
  page.locator('section[aria-labelledby="history-panel-heading"]');

/** The panel's own Undo, not the toolbar's "Undo (Cmd/Ctrl + Z)". */
const undoButton = (page: Page) =>
  historyPanel(page).getByRole('button', { name: 'Undo', exact: true });
const redoButton = (page: Page) =>
  historyPanel(page).getByRole('button', { name: 'Redo', exact: true });

/** The keyboard shortcuts the workspace listens for, as a person presses them. */
async function keyboardUndo(page: Page): Promise<void> {
  await page.keyboard.press('Control+z');
}

async function keyboardRedo(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+z');
}

/** Focuses the artboard, so a key press reaches the canvas rather than a text field. */
async function focusArtboard(page: Page): Promise<void> {
  await page.getByTestId('artboard-surface').focus();
}

test.describe('undo and redo in the browser', () => {
  test('walks edits back and forward with the keyboard, and storage agrees', async ({ page }) => {
    await artboardFixture(page);
    await selectLayerFromList(page, 'Rectangle');
    const startX = await readNumberField(page, 'Layer X');
    const startY = await readNumberField(page, 'Layer Y');

    const start = content(await stored(page));

    // Edit one: an inspector field, committed with Enter.
    await setNumberField(page, 'Layer X', startX + 40);
    const afterField = content(await stored(page));

    // Edits two and three: single arrow-key nudges of the same layer, one step each.
    await focusArtboard(page);
    await page.keyboard.press('ArrowRight');
    const afterFirstNudge = content(await stored(page));
    await page.keyboard.press('ArrowDown');
    const afterSecondNudge = content(await stored(page));

    expect(afterSecondNudge).not.toBe(afterFirstNudge);
    expect(await historyLabels(page)).toEqual([
      'Move “Rectangle”',
      'Move “Rectangle”',
      `Move “Rectangle” to x ${String(startX + 40)}`,
      ...FIXTURE_LABELS,
    ]);

    // Back, one keystroke at a time, with the panel's own buttons agreeing at every stop.
    await keyboardUndo(page);
    await expect.poll(async () => content(await stored(page))).toBe(afterFirstNudge);
    await keyboardUndo(page);
    await expect.poll(async () => content(await stored(page))).toBe(afterField);
    await keyboardUndo(page);
    await expect.poll(async () => content(await stored(page))).toBe(start);
    /* Back at the document this test started from — which is not the floor of the history: the
       fixture created its two layers through the workspace, and creating a layer is an edit like any
       other. What is left behind is exactly those two steps. */
    expect(await historyLabels(page)).toEqual([...FIXTURE_LABELS]);
    await expect(undoButton(page)).toBeEnabled();
    await expect(redoButton(page)).toBeEnabled();
    // The field the keyboard walk passed through is showing the restored value, not a stale draft.
    expect(await readNumberField(page, 'Layer X')).toBe(startX);

    // Walk the rest of the way down: the fixture's own steps come off one at a time, and only then
    // is there nothing behind the document.
    await keyboardUndo(page);
    await expect.poll(async () => (await stored(page)).scene.layers.length).toBe(1);
    await keyboardUndo(page);
    await expect.poll(async () => (await stored(page)).scene.layers.length).toBe(0);
    await expect(undoButton(page)).toBeDisabled();

    // And forward again over both, which rebuilds the same document the fixture left.
    await keyboardRedo(page);
    await keyboardRedo(page);
    await expect.poll(async () => content(await stored(page))).toBe(start);
    await expect(redoButton(page)).toBeEnabled();
    // The selection is transient and was dropped when those layers went away, so it is chosen again
    // the way a person would — and that records nothing.
    await selectLayerFromList(page, 'Rectangle');

    // Forward again, and the post-edit document comes back rather than a re-made approximation.
    await keyboardRedo(page);
    await expect.poll(async () => content(await stored(page))).toBe(afterField);
    await keyboardRedo(page);
    await expect.poll(async () => content(await stored(page))).toBe(afterFirstNudge);
    await keyboardRedo(page);
    await expect.poll(async () => content(await stored(page))).toBe(afterSecondNudge);
    await expect(redoButton(page)).toBeDisabled();
    /* The two nudges land exactly one document pixel each: X is the field edit plus the ArrowRight
       nudge, and Y is the document's own Y plus the ArrowDown nudge. Reading both fields is what keeps
       this a check on the restored *edit* rather than on "some number is showing". */
    expect(await readNumberField(page, 'Layer X')).toBe(startX + 41);
    expect(await readNumberField(page, 'Layer Y')).toBe(startY + 1);

    // A new edit after undoing forgets the redo branch, as a single linear history must.
    await keyboardUndo(page);
    await expect(redoButton(page)).toBeEnabled();
    await focusArtboard(page);
    await page.keyboard.press('ArrowLeft');
    await expect(redoButton(page)).toBeDisabled();
  });

  test('leaves the shortcuts alone while a text field has the caret', async ({ page }) => {
    await artboardFixture(page);
    await selectLayerFromList(page, 'Rectangle');
    const startX = await readNumberField(page, 'Layer X');
    const start = content(await stored(page));
    const labels = await historyLabels(page);

    // A caret press of Ctrl+Z in a text field is not the workspace's undo.
    const field = page.getByLabel('Layer X', { exact: true });
    await field.click();
    await page.keyboard.press('Control+z');

    await expect(field).toHaveValue(String(startX));
    await field.press('Escape');
    await expect.poll(async () => content(await stored(page))).toBe(start);
    expect(await historyLabels(page)).toEqual(labels);
    expect(await readNumberField(page, 'Layer X')).toBe(startX);
  });

  test('undoes and redoes a placed graphic with its licence record', async ({ page }) => {
    await createProject(page);
    const empty = content(await stored(page));

    await placeGraphic(page, 'Aurora mesh');
    const placed = await stored(page);
    expect(placed.attribution).toHaveLength(1);
    expect(await historyLabels(page)).toEqual(['Place graphic “Aurora mesh”']);

    await undoButton(page).click();
    const undone = await storedWhen(
      page,
      (document) => document.scene.layers.length === 0,
      'undo should take the placed graphic back out',
    );
    // Both halves of the edit are gone: the layer *and* the licence record it brought with it.
    expect(undone.attribution).toEqual([]);
    expect(content(undone)).toBe(empty);

    await redoButton(page).click();
    const redone = await storedWhen(
      page,
      (document) => document.attribution.length === 1,
      'redo should put the placed graphic back',
    );
    // The record's own timestamp is part of what comes back, which is why this compares bytes.
    expect(redone.attribution).toEqual(placed.attribution);
    expect(layerNamed(redone, 'Aurora mesh').type).toBe('image');
    expect(content(redone)).toBe(content(placed));
  });

  test('leaves no step behind for refused, unchanged or cancelled edits', async ({ page }) => {
    await artboardFixture(page);
    await selectLayerFromList(page, 'Rectangle');
    const width = await readNumberField(page, 'Layer width');
    const start = content(await stored(page));
    const labels = await historyLabels(page);
    expect(labels).toEqual([...FIXTURE_LABELS]);

    // Refused: a width the document model does not allow. The field says so and nothing is recorded.
    const widthField = page.getByLabel('Layer width', { exact: true });
    await widthField.fill('0');
    await widthField.press('Enter');
    // The field's own message, named exactly: the page has other live regions (Next's route
    // announcer is one), so an unqualified `role="alert"` is ambiguous.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Width must be at least 1px.' }),
    ).toBeVisible();
    expect(await historyLabels(page)).toEqual(labels);
    expect(content(await stored(page))).toBe(start);

    // Unchanged: the same value typed again is not an edit.
    await setNumberField(page, 'Layer width', width);
    expect(await historyLabels(page)).toEqual(labels);
    expect(content(await stored(page))).toBe(start);

    // Cancelled: a typed value abandoned with Escape is discarded, not recorded.
    await widthField.fill(String(width + 120));
    await widthField.press('Escape');
    await focusArtboard(page);
    expect(await historyLabels(page)).toEqual(labels);
    expect(content(await stored(page))).toBe(start);
    expect(await readNumberField(page, 'Layer width')).toBe(width);
  });

  test('records nothing for selection, zoom, guides, snapping or the export panel', async ({
    page,
  }) => {
    await artboardFixture(page);
    const start = content(await stored(page));
    const labels = await historyLabels(page);

    // Selection: one layer, then two, then cleared by a click on empty canvas.
    await selectLayerFromList(page, 'Rectangle');
    await addLayerToSelection(page, 'Text');
    await clickInDocument(page, { x: 20, y: 460 });

    // View-only controls on the stage and in the export panel.
    await setZoom(page, 200);
    await setSnapping(page, true);
    await page.getByRole('button', { name: /^(Hide|Show) guides$/ }).click();
    // Export settings are preferences about a file that does not exist yet, not document edits.
    await page.getByLabel('Format', { exact: true }).selectOption('jpg');

    expect(await historyLabels(page)).toEqual(labels);
    expect(content(await stored(page))).toBe(start);
    await expect(undoButton(page)).toBeEnabled();
  });

  test('keeps the edit over a reload, and starts a fresh history', async ({ page }) => {
    await artboardFixture(page);
    await selectLayerFromList(page, 'Rectangle');
    const startX = await readNumberField(page, 'Layer X');
    await setNumberField(page, 'Layer X', startX + 40);
    const edited = content(await stored(page));
    expect(await historyLabels(page)).toHaveLength(FIXTURE_LABELS.length + 1);

    await page.reload();
    await expect(page.getByTestId('artboard')).toBeVisible();
    await selectLayerFromList(page, 'Rectangle');

    // The saved document is the edited one, and the field shows it.
    expect(await readNumberField(page, 'Layer X')).toBe(startX + 40);
    expect(content(await stored(page))).toBe(edited);

    // A session history is not part of the saved document, so the panel starts empty and both
    // controls are disabled until the next edit.
    expect(await historyLabels(page)).toEqual([]);
    await expect(undoButton(page)).toBeDisabled();
    await expect(redoButton(page)).toBeDisabled();
  });
});
