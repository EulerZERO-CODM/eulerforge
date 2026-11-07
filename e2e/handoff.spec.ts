import { expect, test, type Page } from '@playwright/test';

import { addLayer, createProject, STORAGE_KEY } from './fixtures';

/**
 * Carrying work between studios, in a real browser.
 *
 * The unit tests prove the document builders are pure and correct; this spec proves the *path*
 * works: a person can stand in a design, press one control, and end up in a project that holds the
 * same work — with a link back to where it came from. Nothing here is checked in jsdom because the
 * raster handoff renders a real artboard through a real canvas and encodes a real PNG, and because
 * the library grouping is only visible once two projects actually exist side by side.
 */

type StoredLayer = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
};

type StoredLineage = {
  readonly sourceDocumentId: string;
  readonly sourceTitle: string;
  readonly sourceStudioId: string;
  readonly sourceDocumentTypeId: string;
  readonly operation: 'scene-copy' | 'raster';
  readonly at: string;
};

type StoredDocument = {
  readonly id: string;
  readonly schemaVersion: number;
  readonly studioId: string;
  readonly documentTypeId: string;
  readonly title: string;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly scene: { readonly layers: readonly StoredLayer[] };
  readonly studioPayload?: {
    readonly source?: { readonly width: number; readonly height: number } | null;
  } | null;
  readonly lineage?: StoredLineage | null;
};

/** Every document in the local store, exactly as the application persisted it. */
async function documents(page: Page): Promise<readonly StoredDocument[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) throw new Error('no document has been saved yet');
    const envelope = JSON.parse(raw) as { documents: StoredDocument[] };
    return envelope.documents;
  }, STORAGE_KEY);
}

async function documentById(page: Page, id: string): Promise<StoredDocument> {
  const found = (await documents(page)).find((document) => document.id === id);
  if (!found) throw new Error(`no stored document with id ${id}`);
  return found;
}

/** The document id the workspace in the address bar is showing. */
function currentDocumentId(page: Page): string {
  const id = new URL(page.url()).pathname.split('/').pop();
  if (!id) throw new Error(`the workspace url ${page.url()} carries no document id`);
  return id;
}

/** Sampled pixel statistics from the motion artboard's canvas, which paints the shared scene. */
async function motionInk(page: Page): Promise<{ painted: number; distinct: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="motion-preview"]',
    );
    if (!canvas) throw new Error('the motion stage has no preview canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('the motion preview canvas has no 2D context');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colours = new Set<string>();
    let painted = 0;
    for (let index = 3; index < data.length; index += 4 * 211) {
      if ((data[index] ?? 0) > 0) painted += 1;
      colours.add(
        `${String(data[index - 3])},${String(data[index - 2])},${String(data[index - 1])}`,
      );
    }
    return { painted, distinct: colours.size };
  });
}

/** Sampled pixel statistics from the photo preview, which renders the carried raster. */
async function photoCanvas(page: Page): Promise<{
  readonly width: number;
  readonly height: number;
  readonly opaque: number;
  readonly sampled: number;
  readonly distinct: number;
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="photo-preview"]');
    if (!canvas) throw new Error('the photo stage has no preview canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('the photo preview canvas has no 2D context');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colours = new Set<string>();
    let opaque = 0;
    let sampled = 0;
    for (let index = 3; index < data.length; index += 4 * 97) {
      sampled += 1;
      if (data[index] === 255) opaque += 1;
      colours.add(
        `${String(data[index - 3])},${String(data[index - 2])},${String(data[index - 1])}`,
      );
    }
    return { width: canvas.width, height: canvas.height, opaque, sampled, distinct: colours.size };
  });
}

/** A design with a rectangle under a text layer: enough to prove the stack travels. */
async function posterFixture(page: Page): Promise<string> {
  const id = await createProject(page, { title: 'Launch poster' });
  await addLayer(page, 'Rectangle');
  await addLayer(page, 'Text');
  return id;
}

test.describe('carrying work between studios', () => {
  test('carries every layer into Motion and keeps the way back', async ({ page }) => {
    const designId = await posterFixture(page);
    const design = await documentById(page, designId);
    expect(design.documentTypeId).toBe('design.canvas');
    expect(design.scene.layers).toHaveLength(2);

    await page.getByRole('button', { name: 'Carry onward' }).click();
    const dialog = page.getByRole('dialog', { name: 'Carry this work into another studio' });
    await expect(dialog).toBeVisible();

    // The dialog is the honesty surface: each destination has to say what it does *not* keep,
    // otherwise "continue in Photo Studio" would quietly promise that layers survive.
    await expect(dialog.getByText(/in the same stacking order/i)).toBeVisible();
    await expect(dialog.getByText(/no keyframes/i)).toBeVisible();
    await expect(dialog.getByText(/cannot be recovered/i)).toBeVisible();
    await expect(dialog.getByText(/stays exactly as it is/i)).toBeVisible();

    await dialog.getByRole('button', { name: /Animate it in Motion Studio/ }).click();
    const create = dialog.getByRole('button', { name: 'Create the motion project' });
    await create.click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Launch poster — motion', exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const motionId = currentDocumentId(page);
    expect(motionId).not.toBe(designId);

    const motion = await documentById(page, motionId);
    expect(motion.schemaVersion).toBe(8);
    expect(motion.studioId).toBe('motion');
    expect(motion.documentTypeId).toBe('motion.scene');
    // The scene travels as a copy of the very same layers, in the same order — not a re-creation
    // with new ids, which would break the ability to compare the two documents.
    expect(motion.scene.layers.map((layer) => layer.id)).toEqual(
      design.scene.layers.map((layer) => layer.id),
    );
    expect(motion.lineage).toMatchObject({
      sourceDocumentId: designId,
      sourceTitle: 'Launch poster',
      sourceStudioId: 'design',
      sourceDocumentTypeId: 'design.canvas',
      operation: 'scene-copy',
    });
    expect(Number.isNaN(Date.parse(motion.lineage?.at ?? ''))).toBe(false);

    // The motion stage really paints the carried scene rather than opening an empty artboard.
    const ink = await motionInk(page);
    expect(ink.painted).toBeGreaterThan(0);
    expect(ink.distinct).toBeGreaterThan(1);

    // ...and the new project says where it came from, in the header, as a working link.
    const back = page.getByRole('link', { name: 'Carried from “Launch poster”' });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${designId}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Launch poster', exact: true }),
    ).toBeVisible();
    expect(currentDocumentId(page)).toBe(designId);

    // Copying is not moving: the source is bit-for-bit the document it was before.
    const source = await documentById(page, designId);
    expect(source.scene.layers).toEqual(design.scene.layers);
    expect(source.lineage).toBeNull();

    // Lineage runs both ways: the source names the project it started, so "where did this go?"
    // is answerable without scanning the library for a card that happens to say so.
    const forward = page.getByRole('link', { name: '“Launch poster — motion”' });
    await expect(forward).toBeVisible();
    await forward.click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${motionId}$`));
  });

  test('renders the artboard into Photo and reads as one line of work in the library', async ({
    page,
  }) => {
    const designId = await posterFixture(page);

    await page.getByRole('button', { name: 'Carry onward' }).click();
    const dialog = page.getByRole('dialog', { name: 'Carry this work into another studio' });
    await dialog.getByRole('button', { name: /Retouch it in Photo Studio/ }).click();
    const create = dialog.getByRole('button', { name: 'Create the photo project' });
    await create.click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Launch poster — retouch', exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    const photoId = currentDocumentId(page);
    expect(photoId).not.toBe(designId);

    const photo = await documentById(page, photoId);
    expect(photo.studioId).toBe('photo');
    expect(photo.documentTypeId).toBe('photo.image');
    expect(photo.lineage).toMatchObject({
      sourceDocumentId: designId,
      sourceTitle: 'Launch poster',
      operation: 'raster',
    });
    // Pixels are what arrived: the layer stack is gone, and the document says so by holding none.
    expect(photo.scene.layers).toHaveLength(0);
    // An 800 × 500 design is below the 2048 px working-copy cap, so the handoff renders at 1:1 —
    // no invented detail, and the canvas matches the source's own pixel size.
    expect(photo.canvas.width).toBe(800);
    expect(photo.canvas.height).toBe(500);
    expect(photo.studioPayload?.source).toMatchObject({ width: 800, height: 500 });

    // The rendered artboard really is in the preview: fully opaque and more than one colour.
    await expect.poll(async () => (await photoCanvas(page)).width, { timeout: 30_000 }).toBe(800);
    const painted = await photoCanvas(page);
    expect(painted.opaque).toBe(painted.sampled);
    expect(painted.distinct).toBeGreaterThan(1);
    expect(painted.height).toBe(500);

    // Photo Studio has nowhere to carry this work onward, so the control is not offered at all.
    await expect(page.getByRole('button', { name: 'Carry onward' })).toHaveCount(0);

    await page.goto('/projects');
    const cards = page.locator('article');
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'from “Launch poster”' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'Launch poster — retouch' })).toHaveCount(1);

    // ...and the library's label is the same relation the source project shows.
    await page.goto(`/workspace/${designId}`);
    await expect(page.getByRole('link', { name: '“Launch poster — retouch”' })).toBeVisible();
  });
});
