import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { createCanvas, loadImage } from '@napi-rs/canvas';

import { applyDocumentPatch, createDocument } from '../src/core/documents/factories';
import { imageLayer, sceneOf, TEST_DOCUMENT_TYPE } from '../src/testing/layers';

/**
 * Tinting a graphic, in a real browser.
 *
 * jsdom has no canvas rasteriser and `@napi-rs/canvas` is not the browser, so the only place the
 * browser's own compositing can be checked is a real Chromium. The product's own artboard canvas is
 * read directly, and the exported file is read from the bytes the browser actually wrote.
 *
 * The fixture is a document the product could have produced: one graphic layer, tinted, over the
 * document background. The graphic (`speed-lines.svg`) is horizontal lines with gaps between them,
 * so the file has pixels that are opaque graphic and pixels that are pure transparency — which is
 * exactly the distinction a tint must respect.
 */

const DOCUMENT_ID = 'doc-tint-check';
const STORAGE_KEY = 'eulerforge.v1.documents';
const HREF = '/forge-assets/speed-lines.svg';
const TINT = '#ff8800';
const BACKGROUND = '#101820';

const DOCUMENT_WIDTH = 400;
const DOCUMENT_HEIGHT = 200;

/**
 * Where to read, in *document* pixels.
 *
 * `speed-lines.svg` draws on an 800 x 400 canvas that is stretched into a 400 x 200 frame, so its
 * coordinates are halved. The third line is fully opaque and the gap below the first line is fully
 * transparent, which makes both readings unambiguous.
 */
const ON_THE_LINE = { x: 20, y: 70 };
const BETWEEN_THE_LINES = { x: 20, y: 35 };

function tintedDocument() {
  const created = createDocument(
    {
      title: 'Tint check',
      studioId: 'design',
      documentTypeId: TEST_DOCUMENT_TYPE,
      canvas: {
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
        unit: 'px',
        dpi: 96,
        background: BACKGROUND,
        transparent: false,
      },
    },
    { generateId: () => DOCUMENT_ID },
  );
  if (!created.ok) throw new Error('the fixture document should be valid');

  return applyDocumentPatch(created.value, {
    scene: sceneOf(
      imageLayer('lyr-graphic', {
        x: 0,
        y: 0,
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
        href: HREF,
        fit: 'stretch',
        tint: TINT,
      }),
    ),
  });
}

/** Seeds the document into storage before the application boots, then opens its workspace. */
async function openTintedWorkspace(page: Page): Promise<void> {
  const document = tintedDocument();
  await page.addInitScript(
    ({ key, envelope }) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, JSON.stringify(envelope));
      }
    },
    {
      key: STORAGE_KEY,
      envelope: {
        schemaVersion: document.schemaVersion,
        savedAt: document.updatedAt,
        documents: [document],
      },
    },
  );

  await page.goto(`/workspace/${DOCUMENT_ID}`);
  await expect(page.getByTestId('artboard')).toBeVisible();
  // The graphic finished decoding: neither note may still be on screen.
  await expect(
    page.getByText(/Graphics are still loading|A graphic could not be loaded/),
  ).toHaveCount(0, { timeout: 30_000 });
}

/** Reads two pixels of the artboard's own canvas, in document coordinates. */
async function artboardPixels(
  page: Page,
): Promise<{ readonly onLine: readonly number[]; readonly betweenLines: readonly number[] }> {
  return page.evaluate(
    ({ onLine, betweenLines, documentWidth }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="document-canvas"]');
      if (!canvas) throw new Error('the artboard canvas is missing');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('the artboard canvas has no 2D context');

      // The canvas is the document at the current zoom and device pixel ratio, so document
      // coordinates have to be scaled into it.
      const declared = Number(canvas.dataset['canvasWidth'] ?? '0') || documentWidth;
      const scale = canvas.width / declared;

      const read = (point: { x: number; y: number }) =>
        Array.from(
          context.getImageData(Math.round(point.x * scale), Math.round(point.y * scale), 1, 1).data,
        );

      return { onLine: read(onLine), betweenLines: read(betweenLines) };
    },
    { onLine: ON_THE_LINE, betweenLines: BETWEEN_THE_LINES, documentWidth: DOCUMENT_WIDTH },
  );
}

/** Reads two pixels of an exported PNG, in document coordinates (the file is the document size). */
async function exportedPixels(
  bytes: Buffer,
): Promise<{ readonly onLine: readonly number[]; readonly betweenLines: readonly number[] }> {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const read = (point: { x: number; y: number }) =>
    Array.from(context.getImageData(point.x, point.y, 1, 1).data);
  return { onLine: read(ON_THE_LINE), betweenLines: read(BETWEEN_THE_LINES) };
}

const TINT_RGB = [255, 136, 0, 255];
const BACKGROUND_RGB = [16, 24, 32, 255];

test.describe('tinting a graphic', () => {
  test('colours the graphic without covering the background behind it, on the artboard', async ({
    page,
  }) => {
    await openTintedWorkspace(page);

    const pixels = await artboardPixels(page);
    // The graphic's own pixels take the tint.
    expect(pixels.onLine).toEqual(TINT_RGB);
    // The transparent gap between the lines still shows the document background. A tint applied on
    // the shared canvas would cover the whole frame with the tint colour instead.
    expect(pixels.betweenLines).toEqual(BACKGROUND_RGB);
  });

  test('writes the tinted graphic into the exported file', async ({ page }) => {
    await openTintedWorkspace(page);

    // The panel starts on the project file, which does not draw the scene at all.
    await page.getByLabel('Format', { exact: true }).selectOption({ label: 'PNG (.png)' });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export PNG' }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('the PNG download produced no file');
    const bytes = await readFile(path);

    const pixels = await exportedPixels(bytes);
    expect(pixels.onLine).toEqual(TINT_RGB);
    expect(pixels.betweenLines).toEqual(BACKGROUND_RGB);
  });
});
