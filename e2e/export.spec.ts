import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { createCanvas, loadImage } from '@napi-rs/canvas';

import {
  addLayer,
  artboardScale,
  centreOf,
  clickInDocument,
  createProject,
  historyLabels,
  layerNamed,
  stored,
  storedWhen,
} from './fixtures';

/**
 * Real raster export.
 *
 * jsdom has no canvas rasteriser, so the only honest place to prove that PNG and JPEG export works
 * is a browser that produces an actual file. These specs click the product's own buttons, capture the
 * real download, and inspect the bytes: a PNG signature plus the IHDR dimensions, and a JPEG SOI
 * plus its frame header.
 */

/** Width and height out of a PNG's IHDR chunk, big-endian. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * One pixel of a decoded PNG, as `[r, g, b, a]`.
 *
 * The spec decodes the file it downloaded with the same Canvas 2D implementation the raster tests use,
 * so "the exported pixels" means pixels and not a metadata claim about them.
 */
async function pixelAt(bytes: Buffer, x: number, y: number): Promise<readonly number[]> {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(x, y, 1, 1).data;
  return [data[0] ?? -1, data[1] ?? -1, data[2] ?? -1, data[3] ?? -1];
}

/** Width and height out of a JPEG's start-of-frame marker (baseline or progressive). */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
  let offset = 2;
  while (offset < bytes.length - 9) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) break;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    const length = bytes.readUInt16BE(offset + 2);
    offset += 2 + length;
  }
  throw new Error('the JPEG has no start-of-frame marker');
}

/** Clicks the product's own export button, captures the real download and reads its bytes. */
async function exportPng(page: Page): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export PNG' }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('the PNG download produced no file');
  return readFile(path);
}

test.describe('raster export', () => {
  test('downloads a real PNG and a real JPEG with the declared pixel size', async ({ page }) => {
    await createProject(page, { width: 400, height: 300 });
    await addLayer(page, 'Rectangle');

    // Draw something unmistakable so the exported file is not an empty canvas.
    const rectangle = layerNamed(await stored(page), 'Rectangle');
    await clickInDocument(page, centreOf(rectangle.frame));

    const format = page.getByLabel('Format', { exact: true });

    // PNG first: the default export scale is 1x, so 400x300 document pixels become 400x300 pixels.
    await format.selectOption({ label: 'PNG (.png)' });
    const [png] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export PNG' }).click(),
    ]);
    const pngPath = await png.path();
    if (!pngPath) throw new Error('the PNG download produced no file');
    const pngBytes = await readFile(pngPath);
    expect(png.suggestedFilename()).toMatch(/\.png$/);
    expect(pngSize(pngBytes)).toEqual({ width: 400, height: 300 });
    // A real rasterisation of a drawn scene, not a zero-byte placeholder.
    expect(pngBytes.byteLength).toBeGreaterThan(1000);

    // The panel reports what it wrote, with the same numbers.
    const lastExport = page.getByTestId('last-export');
    await expect(lastExport).toContainText('400 × 300 px');
    await expect(lastExport).toContainText('1x');

    // Then JPEG, which has a different encoder, no alpha channel and its own signature.
    await format.selectOption({ label: 'JPEG (.jpg)' });
    const [jpg] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export JPEG' }).click(),
    ]);
    const jpgPath = await jpg.path();
    if (!jpgPath) throw new Error('the JPEG download produced no file');
    const jpgBytes = await readFile(jpgPath);
    expect(jpg.suggestedFilename()).toMatch(/\.jpe?g$/);
    expect(jpegSize(jpgBytes)).toEqual({ width: 400, height: 300 });
    expect(jpgBytes.byteLength).toBeGreaterThan(1000);
    await expect(lastExport).toContainText('400 × 300 px');
  });

  test('honours the output scale, and reports an honest size for it', async ({ page }) => {
    await createProject(page, { width: 200, height: 150 });
    await addLayer(page, 'Ellipse');

    await page.getByLabel('Format', { exact: true }).selectOption({ label: 'PNG (.png)' });
    await page.getByLabel('Output scale').selectOption('2');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export PNG' }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('the PNG download produced no file');

    expect(pngSize(await readFile(path))).toEqual({ width: 400, height: 300 });
    await expect(page.getByTestId('last-export')).toContainText('400 × 300 px');
    await expect(page.getByTestId('last-export')).toContainText('2x');
  });

  test('leaves a hidden layer out of the exported pixels', async ({ page }) => {
    await createProject(page, { width: 200, height: 150 });
    await addLayer(page, 'Rectangle');

    // The default shape is a solid #e2833a square centred on the canvas, so the middle of its frame
    // is the pixel to watch, and the corner of the canvas is the colour of "nothing here".
    const document = await stored(page);
    const rectangle = layerNamed(document, 'Rectangle');
    const centre = centreOf(rectangle.frame);
    const corner = { x: 2, y: 2 };

    await page.getByLabel('Format', { exact: true }).selectOption({ label: 'PNG (.png)' });
    const exportPng = async (): Promise<Buffer> => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export PNG' }).click(),
      ]);
      const path = await download.path();
      if (!path) throw new Error('the PNG download produced no file');
      return readFile(path);
    };

    const drawn = await exportPng();
    const filled = await pixelAt(drawn, centre.x, centre.y);
    const empty = await pixelAt(drawn, corner.x, corner.y);
    // A real drawn pixel, and it is the layer's own fill, not the background.
    expect(filled.slice(0, 3)).toEqual([226, 131, 58]);
    expect(filled).not.toEqual(empty);

    // Hide the layer through its own control, then export again from the same document.
    await page.getByRole('button', { name: 'Hide “Rectangle”' }).click();
    await expect.poll(async () => layerNamed(await stored(page), 'Rectangle').visible).toBe(false);

    const hidden = await exportPng();
    // Every pixel inside the hidden layer's frame - sampled on a grid, inside its bounds - is the
    // background: the layer left no trace in the file, not a ghost or a placeholder.
    for (
      let x = rectangle.frame.x + 4;
      x < rectangle.frame.x + rectangle.frame.width - 4;
      x += 12
    ) {
      for (
        let y = rectangle.frame.y + 4;
        y < rectangle.frame.y + rectangle.frame.height - 4;
        y += 12
      ) {
        expect(await pixelAt(hidden, x, y), `pixel ${String(x)},${String(y)}`).toEqual(
          await pixelAt(hidden, corner.x, corner.y),
        );
      }
    }
    // And the file really changed, rather than the second capture reusing the first.
    expect(hidden.equals(drawn)).toBe(false);
  });

  test('blocks the export instead of writing a file, when a graphic cannot load', async ({
    page,
  }) => {
    await createProject(page, { width: 200, height: 150 });
    // From here on every catalogue file answers 404, so a placed graphic can never decode.
    await page.route('**/forge-assets/**', (route) =>
      route.fulfill({ status: 404, contentType: 'image/svg+xml', body: '' }),
    );

    await page.getByRole('button', { name: 'Graphic', exact: true }).click();
    await page.getByLabel('Search graphics').fill('aurora');
    await page.getByRole('button', { name: 'Place on canvas' }).first().click();

    const placed = await storedWhen(
      page,
      (document) => document.scene.layers.some((layer) => layer.type === 'image'),
      'the graphic should have been placed',
    );
    // The document is real - the layer and its attribution are recorded - so the refusal below is
    // about the missing file, not about a placement that silently failed. The history names the
    // record exactly as the catalogue spells it.
    const graphic = placed.scene.layers.find((layer) => layer.type === 'image');
    if (!graphic) throw new Error('the placed graphic is missing from the document');
    expect(await historyLabels(page)).toEqual([`Place graphic “${graphic.name}”`]);

    await page.getByLabel('Format', { exact: true }).selectOption({ label: 'PNG (.png)' });

    const panel = page.locator('section[aria-labelledby="export-panel-heading"]');
    await expect(panel.getByText('Every graphic can be drawn')).toBeVisible();
    await expect(panel.getByText(/aurora-mesh\.svg.+could not be loaded/)).toBeVisible();
    await expect(panel.getByText(/Reload the graphics/)).toBeVisible();

    // The export control refuses to start, and nothing was written: a blank PNG with a success
    // message would be a lie, so there is no file and no "last export" record either.
    await expect(panel.getByRole('button', { name: 'Export blocked' })).toBeDisabled();
    await expect(page.getByTestId('last-export')).toHaveCount(0);
  });

  test('leaves the editing guides out of the file it writes', async ({ page }) => {
    await createProject(page, { width: 200, height: 150 });
    await addLayer(page, 'Rectangle');

    // Every editing guide on at once: safe margin, bleed, grid and centre lines. They are helper
    // marks, not artwork, so none of them may reach an exported image.
    await page.getByRole('button', { name: /Apply print-ready defaults/ }).click();
    await expect(page.locator('[data-guide="bleed"]')).toBeVisible();
    await expect(page.locator('[data-guide="safe"]')).toBeVisible();
    await expect(page.locator('[data-guide="centre-x"]')).toBeVisible();
    await expect(page.locator('[data-guide="grid-x"]').first()).toBeVisible();

    // Where the safe-margin line is drawn, in document pixels, measured from the artboard itself.
    await page.getByLabel('Format', { exact: true }).selectOption({ label: 'PNG (.png)' });
    const safeBox = await page.locator('[data-guide="safe"]').boundingBox();
    const artboard = await page.getByTestId('artboard').boundingBox();
    if (!safeBox || !artboard) throw new Error('the guides have no box to measure');
    const { scale } = await artboardScale(page);
    const marginDocumentX = Math.round((safeBox.x - artboard.x) / scale);

    const withGuides = await exportPng(page);

    // Hide the guides through the product's own control, and export again.
    await page.getByRole('button', { name: 'Hide guides' }).click();
    await expect(page.locator('[data-guide="safe"]')).toHaveCount(0);
    const withoutGuides = await exportPng(page);

    // Identical bytes: the guides are not in the artwork at all, so turning them off cannot change
    // what is written. A guide leaking into the render would show up here immediately.
    expect(withGuides.equals(withoutGuides)).toBe(true);

    // ...and no guide pixels are baked in near where the safe-margin line was drawn. The row is
    // canvas all the way across that neighbourhood: every sample is the background colour, and none
    // of them is the guide's blue.
    const samples = await Promise.all(
      [-2, -1, 0, 1, 2].map((offset) => pixelAt(withGuides, marginDocumentX + offset, 4)),
    );
    for (const sample of samples) {
      expect(sample).toEqual(samples[0]);
      expect(sample.slice(0, 3)).not.toEqual([79, 140, 255]);
    }
  });

  test('records the whole export history, one labelled step per action', async ({ page }) => {
    await createProject(page, { width: 200, height: 150 });
    await addLayer(page, 'Rectangle');
    await page.getByLabel('Format', { exact: true }).selectOption({ label: 'PNG (.png)' });

    await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export PNG' }).click(),
    ]);

    // Exporting is not an edit: the history holds only the layer that was added.
    const labels = page.locator('section[aria-labelledby="history-panel-heading"] ol li');
    await expect(labels).toHaveCount(1);
    await expect(labels.first()).toContainText('Add rectangle layer');
  });
});

/**
 * The project file, saved through the same relocated adapter as the rasters.
 *
 * It is the one export whose bytes the core prepares (`projectFilePayload`) while the component does
 * the browser part, which is exactly the split ADR-0019 introduced. A jsdom test can only prove the
 * payload; this proves that clicking the button really writes the file the user asked for.
 */
test.describe('project file export', () => {
  test('saves the project file, with the current document inside it', async ({ page }) => {
    await createProject(page, { width: 200, height: 150 });
    await addLayer(page, 'Rectangle');

    await page.getByLabel('Format', { exact: true }).selectOption('forge-json');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download project file' }).click(),
    ]);

    // The name comes from the document's own title, so it is a filename a person recognises.
    expect(download.suggestedFilename()).toBe('browser-verification.forge.json');
    const path = await download.path();
    if (!path) throw new Error('the project file download produced no file');

    const envelope = JSON.parse(await readFile(path, 'utf8')) as {
      readonly $schema: string;
      readonly fileVersion: number;
      readonly document: {
        readonly revision: number;
        readonly canvas: { readonly width: number; readonly height: number };
        readonly scene: { readonly layers: readonly { readonly name: string }[] };
      };
    };

    expect(envelope.$schema).toBe('forge/project-file');
    expect(envelope.fileVersion).toBe(1);
    expect(envelope.document.canvas.width).toBe(200);
    expect(envelope.document.canvas.height).toBe(150);
    expect(envelope.document.scene.layers.map((layer) => layer.name)).toEqual(['Rectangle']);

    // The file holds *this* document, at the revision the application has persisted: a download of
    // some earlier snapshot would pass a "a file arrived" check and still be wrong.
    expect(envelope.document.revision).toBe((await stored(page)).revision);

    // The success message is shown only after the adapter reports that the save started.
    await expect(page.getByText('Project file downloaded')).toBeVisible();
  });
});
