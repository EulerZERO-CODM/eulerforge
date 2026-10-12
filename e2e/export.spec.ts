import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { addLayer, centreOf, clickInDocument, createProject, layerNamed, stored } from './fixtures';

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

test.describe('raster export', () => {
  test('downloads a real PNG and a real JPEG with the declared pixel size', async ({ page }) => {
    await createProject(page, { width: 400, height: 300 });
    await addLayer(page, 'Rectangle');

    // Draw something unmistakable so the exported file is not an empty canvas.
    const rectangle = layerNamed(await stored(page), 'Rectangle');
    await clickInDocument(page, centreOf(rectangle.frame));

    const format = page.getByLabel('Format');

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

    await page.getByLabel('Format').selectOption({ label: 'PNG (.png)' });
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

  test('records the whole export history, one labelled step per action', async ({ page }) => {
    await createProject(page, { width: 200, height: 150 });
    await addLayer(page, 'Rectangle');
    await page.getByLabel('Format').selectOption({ label: 'PNG (.png)' });

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
