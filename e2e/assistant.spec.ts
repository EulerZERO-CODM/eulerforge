import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { createProject, STORAGE_KEY } from './fixtures';

/**
 * The assistant, in a real browser, doing a real multi-step task in two studios.
 *
 * The component suite proves that a plan reaches the document commands; this spec proves the parts
 * that only a browser can: the photo pipeline really re-renders the adjusted pixels, the downloaded
 * file is a genuine PNG whose pixels carry the edit, and a design plan adds layers the saved
 * document really contains. Assertions read the persisted document and the decoded file, never the
 * assistant's own summary text.
 */

type StoredPhotoPayload = {
  readonly kind: 'photo';
  readonly adjustments: readonly { readonly kind: string; readonly value: number }[];
  readonly mask: {
    readonly ranges?: readonly {
      readonly kind: 'luminance' | 'colour';
      readonly min?: number;
      readonly max?: number;
      readonly feather: number;
    }[];
  } | null;
};

type StoredDocument = {
  readonly title: string;
  readonly documentTypeId: string;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly scene: {
    readonly layers: readonly {
      readonly type: string;
      readonly name: string;
      readonly frame: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly text?: { readonly content: string };
    }[];
  };
  readonly studioPayload: StoredPhotoPayload | null;
};

async function storedDocument(page: Page): Promise<StoredDocument> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  if (raw === null) throw new Error('no document has been saved yet');
  const envelope = JSON.parse(raw) as { documents: StoredDocument[] };
  const document = envelope.documents[0];
  if (!document) throw new Error('the saved envelope holds no document');
  return document;
}

/** Polls the persisted document, because autosave is asynchronous. */
async function storedWhen(
  page: Page,
  predicate: (document: StoredDocument) => boolean,
  message: string,
): Promise<StoredDocument> {
  await expect.poll(async () => predicate(await storedDocument(page)), { message }).toBe(true);
  return storedDocument(page);
}

async function createPhotoProject(page: Page): Promise<void> {
  await page.goto('/studios/photo');
  await expect(page.getByRole('heading', { name: 'Photo Studio', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Create a project' }).first().click();
  await expect(page).toHaveURL(/\/create\?studio=photo$/);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Project name').fill('Assistant portrait');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/workspace\/[^/]+$/);
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeVisible();
}

const DARK = [0x30, 0x30, 0x30] as const;
const LIGHT = [0xc8, 0xc8, 0xc8] as const;
const SIZE = 240;

/** A hard-edged half-dark/half-light PNG: the luminance range has an obvious left half to act on. */
async function halfTonePng(): Promise<Buffer> {
  const canvas = createCanvas(SIZE, SIZE);
  const context = canvas.getContext('2d');
  context.fillStyle = `rgb(${DARK.join(',')})`;
  context.fillRect(0, 0, SIZE / 2, SIZE);
  context.fillStyle = `rgb(${LIGHT.join(',')})`;
  context.fillRect(SIZE / 2, 0, SIZE / 2, SIZE);
  return canvas.encode('png');
}

async function importHalfTone(page: Page): Promise<void> {
  await page.getByLabel('Import a photo file').setInputFiles({
    name: 'half-tone.png',
    mimeType: 'image/png',
    buffer: await halfTonePng(),
  });
  await expect(page.getByTestId('photo-import-report')).toContainText(`${SIZE} × ${SIZE}`);
}

/** Reads the pixels of a downloaded PNG at two points, in the file's own coordinates. */
async function samplePng(path: string): Promise<{
  readonly width: number;
  readonly height: number;
  readonly dark: readonly number[];
  readonly light: readonly number[];
}> {
  const image = await loadImage(await readFile(path));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const at = (x: number): readonly number[] => {
    const data = context.getImageData(x, Math.floor(image.height / 2), 1, 1).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
  };
  return {
    width: image.width,
    height: image.height,
    dark: at(Math.floor(image.width / 4)),
    light: at(Math.floor((image.width * 3) / 4)),
  };
}

test.describe('the assistant in Photo Studio', () => {
  test('runs a three-step task, exports a real PNG and leaves every edit undoable', async ({
    page,
  }) => {
    await createPhotoProject(page);
    await importHalfTone(page);

    await page
      .getByTestId('assistant-request')
      .fill('select dark pixels, brighten and export a png');
    await page.getByTestId('assistant-plan').click();
    await expect(page.getByTestId('assistant-step-0')).toContainText('photo.range_select');
    await expect(page.getByTestId('assistant-step-1')).toContainText('photo.adjust');
    await expect(page.getByTestId('assistant-step-2')).toContainText('photo.export');

    const downloadEvent = page.waitForEvent('download');
    await page.getByTestId('assistant-run').click();
    const download = await downloadEvent;
    await expect(page.getByTestId('assistant-summary')).toContainText('3 step(s) completed');

    // The document really holds a luminance range and an exposure adjustment.
    const edited = await storedWhen(
      page,
      (document) =>
        (document.studioPayload?.mask?.ranges ?? []).length === 1 &&
        (document.studioPayload?.adjustments ?? []).some((entry) => entry.kind === 'exposure'),
      'the range and the exposure should be in the saved document',
    );
    expect(edited.studioPayload?.mask?.ranges?.[0]).toMatchObject({ kind: 'luminance', max: 0.35 });
    expect(
      edited.studioPayload?.adjustments.find((entry) => entry.kind === 'exposure')?.value,
    ).toBe(20);

    // The download is a real PNG of the working copy, and its dark half is lighter than the source.
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const path = await download.path();
    if (!path) throw new Error('the download has no path');
    const header = new Uint8Array(await readFile(path));
    expect([...header.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const pixels = await samplePng(path);
    expect(pixels.width).toBe(SIZE);
    expect(pixels.height).toBe(SIZE);
    expect(pixels.dark[0] ?? 0).toBeGreaterThan(DARK[0] + 10);
    // The bright half is outside the luminance range, so the exposure must not reach it.
    expect(Math.abs((pixels.light[0] ?? 0) - LIGHT[0])).toBeLessThanOrEqual(3);

    // One undo removes the exposure but keeps the selection: they were separate actions.
    await page.getByTestId('assistant-undo').click();
    const undone = await storedWhen(
      page,
      (document) => (document.studioPayload?.adjustments ?? []).length === 0,
      'undo should remove the adjustment',
    );
    expect(undone.studioPayload?.mask?.ranges).toHaveLength(1);
  });
});

test.describe('the assistant in Design Studio', () => {
  test('adds a rectangle and a text layer, and the saved document and preview both show them', async ({
    page,
  }) => {
    await createProject(page, { title: 'Assistant poster', width: 640, height: 400 });

    await page
      .getByTestId('assistant-request')
      .fill('add a rectangle 320x180 and add text that says "Spring sale"');
    await page.getByTestId('assistant-plan').click();
    await expect(page.getByTestId('assistant-step-0')).toContainText('design.add_rectangle');
    await expect(page.getByTestId('assistant-step-1')).toContainText('design.add_text');

    await page.getByTestId('assistant-run').click();
    await expect(page.getByTestId('assistant-summary')).toContainText('2 step(s) completed');

    const document = await storedWhen(
      page,
      (entry) =>
        entry.scene.layers.length === 2 &&
        entry.scene.layers.some((layer) => layer.type === 'text') &&
        entry.scene.layers.some((layer) => layer.type === 'rect'),
      'both layers should be in the saved document',
    );
    const rectangle = document.scene.layers.find((layer) => layer.type === 'rect');
    expect(rectangle?.frame).toMatchObject({ width: 320, height: 180 });
    const text = document.scene.layers.find((layer) => layer.type === 'text');
    expect(text?.text?.content).toBe('Spring sale');
    await expect(page.getByRole('img', { name: /Artboard preview: 2 layers/ })).toBeVisible();

    // Undo removes the last layer, not the whole run: each step was its own action.
    await page.getByTestId('assistant-undo').click();
    const undone = await storedWhen(
      page,
      (entry) => entry.scene.layers.length === 1,
      'undo should remove the text layer only',
    );
    expect(undone.scene.layers[0]?.type).toBe('rect');
  });

  test('refuses a request it cannot do while still offering the step it can', async ({ page }) => {
    await createProject(page, { title: 'Assistant refusal' });
    await page
      .getByTestId('assistant-request')
      .fill('remove the background and add a rectangle 100x50');
    await page.getByTestId('assistant-plan').click();

    const unsupported = page.getByTestId('assistant-unsupported');
    await expect(unsupported).toContainText(/remove the background/i);
    await expect(unsupported).toContainText(/no vocabulary|outside it/i);
    await expect(page.getByTestId('assistant-step-0')).toContainText('design.add_rectangle');

    await page.getByTestId('assistant-run').click();
    await expect(page.getByTestId('assistant-summary')).toContainText('1 step(s) completed');
    const document = await storedWhen(
      page,
      (entry) => entry.scene.layers.length === 1,
      'the runnable step should still be applied',
    );
    expect(document.scene.layers[0]?.type).toBe('rect');
  });
});
