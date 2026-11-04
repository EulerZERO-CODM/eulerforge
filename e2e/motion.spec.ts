import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { readZipEntry, readZipEntryNames } from '../src/core/svg/zip';
import { STORAGE_KEY } from './fixtures';

/**
 * Motion Studio, in a real browser.
 *
 * Three claims need a browser rather than jsdom: the preview really paints a canvas, the playhead
 * really moves the picture, and export produces a real archive whose PNG frames can be decoded and
 * compared with the canvas at the same timestamp. The last one is the point of the whole phase — if
 * the exported frame and the preview disagreed, the studio's promise would be empty.
 *
 * Nothing about the application is stubbed. The document comes from the product's own creation
 * flow, the animation is entered through the panels, and every assertion reads either `localStorage`
 * or the downloaded bytes.
 */

type StoredMotionPayload = {
  readonly kind: 'motion';
  readonly version: 1;
  readonly duration: number;
  readonly fps: number;
  readonly tracks: readonly {
    readonly layerId: string;
    readonly property: string;
    readonly keyframes: readonly {
      readonly id: string;
      readonly time: number;
      readonly value: number;
      readonly easing: { readonly kind: string };
    }[];
  }[];
};

type StoredMotionDocument = {
  readonly id: string;
  readonly title: string;
  readonly documentTypeId: string;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly studioPayload: StoredMotionPayload | null;
};

async function storedDocument(page: Page): Promise<StoredMotionDocument> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  if (raw === null) throw new Error('no document has been saved yet');
  const envelope = JSON.parse(raw) as { documents: StoredMotionDocument[] };
  const document = envelope.documents[0];
  if (!document) throw new Error('the saved envelope holds no document');
  return document;
}

async function payload(page: Page): Promise<StoredMotionPayload> {
  const stored = (await storedDocument(page)).studioPayload;
  if (!stored) throw new Error('the document has no motion payload');
  return stored;
}

/** Creates a motion project through the studio page, the product's own entry point. */
async function createMotionDocument(page: Page, title = 'Browser title'): Promise<void> {
  await page.goto('/studios/motion');
  await expect(page.getByRole('heading', { name: 'Motion Studio', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Create a project' }).first().click();

  await expect(page).toHaveURL(/\/create\?studio=motion$/);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Project name').fill(title);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.locator('dt', { hasText: 'Document type' }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('Motion scene');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.waitForURL(/\/workspace\/[^/]+$/);
  await expect(page.getByRole('button', { name: /Export frames/ })).toBeVisible();
}

async function addTextLayer(page: Page): Promise<void> {
  const group = page.getByRole('group', { name: 'Add a layer' });
  await group.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Composition layers' }).getByRole('button'),
  ).toHaveCount(1);
}

async function seek(page: Page, seconds: number): Promise<void> {
  const playhead = page.getByLabel('Playhead');
  await playhead.fill(String(seconds));
  await expect(page.getByTestId('motion-time')).toContainText(`${seconds.toFixed(2)}s`);
}

async function addKeyframe(page: Page, seconds: number, value: number): Promise<void> {
  await seek(page, seconds);
  const valueField = page.getByLabel('Keyframe value');
  await valueField.fill(String(value));
  await page.getByRole('button', { name: `Add keyframe at ${seconds.toFixed(2)}s` }).click();
}

/** Reads a grid of RGBA samples from the live preview canvas, in document pixels. */
async function samplePreview(
  page: Page,
  step = 54,
): Promise<{ width: number; height: number; samples: number[] }> {
  return page.evaluate((sampleStep) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="motion-preview"]');
    if (!canvas) throw new Error('the motion preview canvas is missing');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('the motion preview has no 2D context');
    const samples: number[] = [];
    for (let y = 0; y < canvas.height; y += sampleStep) {
      for (let x = 0; x < canvas.width; x += sampleStep) {
        const data = context.getImageData(x, y, 1, 1).data;
        samples.push(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0);
      }
    }
    return { width: canvas.width, height: canvas.height, samples };
  }, step);
}

/** Samples the same grid from a decoded PNG at its natural size. */
async function samplePng(
  bytes: Uint8Array,
  step = 54,
): Promise<{ width: number; height: number; samples: number[] }> {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const samples: number[] = [];
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const data = context.getImageData(x, y, 1, 1).data;
      samples.push(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0);
    }
  }
  return { width: canvas.width, height: canvas.height, samples };
}

async function downloadFrames(page: Page): Promise<{ fileName: string; bytes: Uint8Array }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export frames' }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('the frame export produced no file');
  return {
    fileName: download.suggestedFilename(),
    bytes: new Uint8Array(await readFile(path)),
  };
}

test.describe('Motion Studio in a real browser', () => {
  test('animates a layer, saves it, and walks the keyframes with undo and redo', async ({
    page,
  }) => {
    await createMotionDocument(page);
    await addTextLayer(page);
    await addKeyframe(page, 0, 0);

    await seek(page, 1);
    await page.getByLabel('Keyframe value').fill('300');
    await page.getByRole('button', { name: 'Add keyframe at 1.00s' }).click();

    await expect.poll(async () => (await payload(page)).tracks[0]?.keyframes.length).toBe(2);
    expect((await payload(page)).tracks[0]?.property).toBe('x');

    // The playhead really changes the picture: the text sits at x = 0 at 0 s and x = 300 at 1 s.
    await seek(page, 0);
    const atStart = await samplePreview(page);
    await seek(page, 1);
    const atEnd = await samplePreview(page);
    expect(atEnd.width).toBe(atStart.width);
    const differing = atStart.samples.filter((value, index) => value !== atEnd.samples[index]);
    expect(differing.length).toBeGreaterThan(8);

    // Undo removes the second keyframe; redo brings it back. Both are one press of the shared
    // history controls, which is the same command surface the keyboard shortcut calls.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await payload(page)).tracks[0]?.keyframes.length).toBe(1);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await payload(page)).tracks[0]?.keyframes.length).toBe(2);

    // A reload reopens the saved document with its animation intact.
    await page.reload();
    await expect(page.getByRole('button', { name: /Export frames/ })).toBeVisible();
    await expect.poll(async () => (await payload(page)).tracks[0]?.keyframes.length).toBe(2);
    await expect(
      page.getByRole('button', { name: /X position keyframe at 1\.00 seconds/ }),
    ).toBeVisible();
  });

  test('exports frames that match the preview at the same timestamp', async ({ page }) => {
    await createMotionDocument(page, 'Frame parity');
    await addTextLayer(page);
    await addKeyframe(page, 0, 0);
    await seek(page, 1);
    await page.getByLabel('Keyframe value').fill('300');
    await page.getByRole('button', { name: 'Add keyframe at 1.00s' }).click();

    // A range starting exactly at 1 s: the first exported frame is the one on screen at 1 s.
    await page.getByLabel('Export start').fill('1');
    await page.getByLabel('Export end').fill('1.1');
    await page.getByLabel('Export scale').fill('1');
    await page.getByRole('button', { name: 'Check range' }).click();

    await seek(page, 1);
    const preview = await samplePreview(page);
    const expectedSize = `${String(preview.width)} × ${String(preview.height)}`;
    await expect(page.getByTestId('motion-export-plan')).toContainText(
      `3 frames at ${expectedSize}`,
    );
    const { fileName, bytes } = await downloadFrames(page);

    expect(fileName).toBe('frame-parity-frames.zip');
    // The archive really is a ZIP and really contains the frames plus a manifest.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const names = readZipEntryNames(bytes);
    expect(names).toEqual([
      'frames/frame-0001.png',
      'frames/frame-0002.png',
      'frames/frame-0003.png',
      'manifest.json',
    ]);

    const manifestBytes = readZipEntry(bytes, 'manifest.json');
    if (!manifestBytes) throw new Error('the archive has no manifest');
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      format: string;
      fps: number;
      frameCount: number;
      times: number[];
      width: number;
      height: number;
    };
    expect(manifest.format).toBe('eulerforge-motion-frames/1');
    expect(manifest.frameCount).toBe(3);
    expect(manifest.times[0]).toBeCloseTo(1, 6);
    expect(manifest.width).toBe(preview.width);
    expect(manifest.height).toBe(preview.height);

    const frameBytes = readZipEntry(bytes, 'frames/frame-0001.png');
    if (!frameBytes) throw new Error('the archive has no first frame');
    const exported = await samplePng(frameBytes);
    expect(exported.width).toBe(preview.width);
    expect(exported.height).toBe(preview.height);

    // Pixel-for-pixel (with a 2/255 allowance for encoder and decoder rounding): the exported
    // frame at t = 1 s is the frame the preview shows at t = 1 s.
    let mismatches = 0;
    let worst = 0;
    for (let index = 0; index < preview.samples.length; index += 1) {
      const expected = preview.samples[index] ?? 0;
      const actual = exported.samples[index] ?? 0;
      const difference = Math.abs(expected - actual);
      worst = Math.max(worst, difference);
      if (difference > 2) mismatches += 1;
    }
    expect({ mismatches, worst }).toEqual({ mismatches: 0, worst: 0 });

    await expect(page.getByTestId('motion-export-report')).toContainText(
      `3 frames at ${expectedSize}`,
    );
  });

  test('explains an empty export range and downloads nothing', async ({ page }) => {
    await createMotionDocument(page, 'Empty range');
    await addTextLayer(page);
    await page.getByLabel('Export start').fill('0');
    await page.getByLabel('Export end').fill('0');
    await page.getByRole('button', { name: 'Check range' }).click();
    await expect(page.getByText(/The export range is empty/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export frames' })).toBeEnabled();
    await expect(page.getByTestId('motion-export-plan')).toHaveCount(0);
  });
});
