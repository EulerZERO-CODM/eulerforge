import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { readZipEntry, readZipEntryNames } from '../src/core/svg/zip';
import { STORAGE_KEY } from './fixtures';

/**
 * The Illustration Studio, in a real browser.
 *
 * Everything Phase 3 claims about browser behaviour is checked here rather than reasoned about:
 *
 * - a vector document is created through the product's own entry point and the *persisted* document
 *   is asserted, not the screen;
 * - the pen, node editing, shape drawing and boolean operations run against the real canvas and the
 *   real pointer capture, including a boolean operation (which is what caught the CommonJS/ESM
 *   import bug that unit tests could not see);
 * - SVG export is a real download whose bytes are read back, parsed and re-imported;
 * - the icon-set zip is a real download, checked for a ZIP signature and a manifest;
 * - the Design ⇄ Illustration interchange is driven through the interface in both directions.
 *
 * No application code is stubbed: coordinates come from the artboard's own reported zoom, and
 * assertions come from `localStorage` and from downloaded bytes.
 */

type StoredVectorNode = {
  readonly point: { readonly x: number; readonly y: number };
  readonly kind: string;
  readonly handleIn: { readonly x: number; readonly y: number } | null;
  readonly handleOut: { readonly x: number; readonly y: number } | null;
};

type StoredVectorLayer = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly visible: boolean;
  readonly vector?: {
    readonly path: {
      readonly contours: readonly {
        readonly closed: boolean;
        readonly nodes: readonly StoredVectorNode[];
      }[];
    };
    readonly style: {
      readonly fill: string | null;
      readonly stroke: string | null;
      readonly strokeWidth: number;
      readonly fillPaint?: {
        readonly kind: string;
        readonly stops?: readonly { readonly offset: number; readonly color: string }[];
      } | null;
    };
  };
};

type StoredDocument = {
  readonly id: string;
  readonly title: string;
  readonly studioId: string;
  readonly documentTypeId: string;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly scene: { readonly layers: readonly StoredVectorLayer[] };
};

/** Every document the application has persisted. */
async function storedDocuments(page: Page): Promise<readonly StoredDocument[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return [];
    return (JSON.parse(raw) as { documents: StoredDocument[] }).documents;
  }, STORAGE_KEY);
}

async function storedDocument(page: Page): Promise<StoredDocument> {
  const documents = await storedDocuments(page);
  const document = documents[0];
  if (!document) throw new Error('no document has been saved yet');
  return document;
}

async function pathLayers(page: Page): Promise<readonly StoredVectorLayer[]> {
  return (await storedDocument(page)).scene.layers.filter((layer) => layer.type === 'path');
}

/** Point in the viewport for a document coordinate, from the artboard's own reported zoom. */
async function pointFor(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<{ x: number; y: number }> {
  const artboard = page.getByTestId('vector-artboard');
  const box = await artboard.boundingBox();
  if (!box) throw new Error('the vector artboard has no box to measure');
  const canvasWidth = Number(await artboard.getAttribute('data-canvas-width'));
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) {
    throw new Error('the vector artboard does not report its canvas width');
  }
  const scale = box.width / canvasWidth;
  return { x: box.x + point.x * scale, y: box.y + point.y * scale };
}

/** Clicks a document position on the vector surface with the real mouse. */
async function clickVector(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<void> {
  const target = await pointFor(page, point);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** Drags on the vector surface in document pixels. */
async function dragVector(
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  steps = 8,
): Promise<void> {
  const start = await pointFor(page, from);
  const end = await pointFor(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

/**
 * Creates a vector document the way a person does: through the Illustration Studio page.
 *
 * The studio page's button is the entry point the registry advertises, so this also proves that a
 * studio marked `available` really leads somewhere usable.
 */
async function createVectorDocument(page: Page, title = 'Browser icon sheet'): Promise<string> {
  await page.goto('/studios/illustration');
  await expect(page.getByRole('heading', { name: 'Illustration Studio', level: 1 })).toBeVisible();
  await expect(page.getByText('Available now').first()).toBeVisible();
  // The studio page offers the same entry point in its header and in the empty project list; either
  // one is the real route, so the first is enough.
  await page.getByRole('link', { name: 'Create a project' }).first().click();

  await expect(page).toHaveURL(/\/create\?studio=illustration$/);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  // A vector artboard wants a square, so the size step is used rather than left at the poster default.
  await page.getByLabel('Width').fill('256');
  await page.getByLabel('Height').fill('256');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Project name').fill(title);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  // Review step: the document type is named next to the studio, not implied by the route.
  await expect(
    page.locator('dt', { hasText: 'Document type' }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('Vector artboard');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.waitForURL(/\/workspace\/[^/]+$/);
  await expect(page.getByTestId('vector-surface')).toBeVisible();

  const document = await storedDocument(page);
  expect(document.documentTypeId).toBe('illustration.artboard');
  expect(document.studioId).toBe('illustration');
  return document.id;
}

/** Selects a layer through the layer list, which is the keyboard-reachable selection path. */
async function selectLayer(page: Page, id: string): Promise<void> {
  await page.getByTestId(`layer-name-${id}`).click();
  await expect(page.getByTestId(`layer-name-${id}`)).toHaveAttribute('aria-current', 'true');
}

/** Draws a three-node open path with the pen and finishes it. */
async function drawPath(
  page: Page,
  points: readonly { readonly x: number; readonly y: number }[],
): Promise<void> {
  await page.getByTestId('tool-pen').click();
  for (const point of points) await clickVector(page, point);
  await expect(page.getByTestId('pen-draft')).toBeVisible();
  await page.getByTestId('finish-path').click();
  await expect(page.getByTestId('pen-draft')).toHaveCount(0);
}

/** Drags out a shape with the given tool. */
async function drawShape(
  page: Page,
  tool: 'rectangle' | 'ellipse' | 'star',
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): Promise<void> {
  await page.getByTestId(`tool-${tool}`).click();
  await dragVector(page, from, to);
}

/** Adds a layer to the selection the way the layer list does: Ctrl-click toggles it in. */
async function addToSelection(page: Page, id: string): Promise<void> {
  await page.getByTestId(`layer-name-${id}`).click({ modifiers: ['Control'] });
  await expect(page.getByTestId(`layer-name-${id}`)).toHaveAttribute('aria-current', 'true');
}

/** Clicks an icon-set export and returns the real bytes the browser saved. */
async function downloadIconSet(
  page: Page,
): Promise<{ readonly fileName: string; readonly bytes: Uint8Array }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('icon-set-export').click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('the icon-set download produced no file');
  return { fileName: download.suggestedFilename(), bytes: new Uint8Array(await readFile(path)) };
}

/**
 * The two paths drawn as a plus sign: a vertical and a horizontal bar, overlapping in the middle.
 *
 * They are drawn as closed shapes so the boolean result is a genuine new contour rather than a
 * union that happens to equal one of its inputs.
 */
async function drawPlus(page: Page): Promise<void> {
  await drawShape(page, 'rectangle', { x: 96, y: 24 }, { x: 160, y: 232 });
  await drawShape(page, 'rectangle', { x: 24, y: 96 }, { x: 232, y: 160 });
}

test.describe('Illustration Studio', () => {
  test('creates a vector document from the studio entry point and reopens it', async ({ page }) => {
    const id = await createVectorDocument(page);

    // Draw something worth keeping, then reload the document from the library as a person would.
    await drawPath(page, [
      { x: 40, y: 40 },
      { x: 200, y: 60 },
      { x: 120, y: 200 },
    ]);
    expect(await pathLayers(page)).toHaveLength(1);

    // The project library is where a saved project is found again; the card's title is the link.
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Browser icon sheet', exact: true }).click();
    await page.waitForURL(new RegExp(`/workspace/${id}$`));
    await expect(page.getByTestId('vector-surface')).toBeVisible();

    const reopened = await storedDocument(page);
    expect(reopened.id).toBe(id);
    const layer = reopened.scene.layers[0];
    if (layer?.type !== 'path') throw new Error('the reopened document should hold a path layer');
    expect(layer.vector?.path.contours[0]?.nodes).toHaveLength(3);
    // The pen placed the nodes where they were clicked, not where a default shape would be.
    expect(layer.vector?.path.contours[0]?.nodes[0]?.point.x).toBeCloseTo(40, 0);
    expect(layer.vector?.path.contours[0]?.nodes[1]?.point.y).toBeCloseTo(60, 0);
  });

  test('draws with the pen, edits a node, and undoes and redoes as labelled actions', async ({
    page,
  }) => {
    await createVectorDocument(page);
    await drawPath(page, [
      { x: 40, y: 40 },
      { x: 200, y: 60 },
      { x: 120, y: 200 },
    ]);

    const historyPanel = page.locator('section[aria-labelledby="history-panel-heading"]');
    await expect(historyPanel.getByText(/Draw “Path”/)).toBeVisible();

    // Node editing: select the path, take the node tool, and nudge the first node with the keyboard.
    const drawn = (await pathLayers(page))[0];
    if (!drawn) throw new Error('the drawn path should be in the document');
    await selectLayer(page, drawn.id);
    await page.getByTestId('tool-node').click();
    await page.getByTestId('node-0-0').click();
    await expect(page.getByTestId('node-summary')).toContainText('1 selected');

    const before = await pathLayers(page);
    const startX = before[0]?.vector?.path.contours[0]?.nodes[0]?.point.x ?? Number.NaN;
    await page.getByTestId('vector-surface').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    await expect
      .poll(async () => (await pathLayers(page))[0]?.vector?.path.contours[0]?.nodes[0]?.point.x)
      .toBeCloseTo(startX + 2, 1);
    await expect(historyPanel.getByText(/Nudge node on “Path”/)).toBeVisible();

    // Undo through the product's own button: the nudge disappears, the draw stays.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => (await pathLayers(page))[0]?.vector?.path.contours[0]?.nodes[0]?.point.x)
      .toBeCloseTo(startX, 1);
    expect(await pathLayers(page)).toHaveLength(1);

    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect
      .poll(async () => (await pathLayers(page))[0]?.vector?.path.contours[0]?.nodes[0]?.point.x)
      .toBeCloseTo(startX + 2, 1);

    // …and undo the draw itself, which is the same history entry the panel names.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await storedDocument(page)).scene.layers.length).toBe(0);
  });

  test('makes a curve smooth, drags a Bezier handle, and reports the geometry', async ({
    page,
  }) => {
    await createVectorDocument(page);
    await drawPath(page, [
      { x: 40, y: 128 },
      { x: 128, y: 40 },
      { x: 216, y: 128 },
    ]);

    const drawn = (await pathLayers(page))[0];
    if (!drawn) throw new Error('the drawn path should be in the document');
    await selectLayer(page, drawn.id);
    await page.getByTestId('tool-node').click();
    await page.getByTestId('node-0-1').click();
    await page.getByTestId('node-smooth').click();

    await expect
      .poll(async () => (await pathLayers(page))[0]?.vector?.path.contours[0]?.nodes[1]?.handleOut)
      .not.toBeNull();
    const handles = await pathLayers(page);
    const handle = handles[0]?.vector?.path.contours[0]?.nodes[1]?.handleOut;
    if (!handle) throw new Error('a smoothed node should have an outbound handle');

    // Drag that handle on the artboard; the preview follows the pointer and commits on release.
    const node = handles[0]?.vector?.path.contours[0]?.nodes[1]?.point;
    if (!node) throw new Error('the smoothed node should have a point');
    await dragVector(page, handle, { x: handle.x + 20, y: handle.y - 20 });

    const dragged = (await pathLayers(page))[0]?.vector?.path.contours[0]?.nodes[1]?.handleOut;
    expect(dragged?.x).toBeGreaterThan(handle.x + 15);
    expect(dragged?.y).toBeLessThan(handle.y - 15);
    await expect(page.getByTestId('vector-x')).toBeVisible();
    await expect(page.getByTestId('vector-x')).toHaveValue(/\d/);
  });

  test('combines two shapes with a real boolean operation and reports the approximation', async ({
    page,
  }) => {
    await createVectorDocument(page);
    await drawPlus(page);
    expect(await pathLayers(page)).toHaveLength(2);

    // Select both from the layer list, then unite them. This is the browser guard for the boolean
    // kernel: a bundler that resolves the dependency differently is exactly what broke before.
    const layers = (await storedDocument(page)).scene.layers;
    const first = layers[0]?.id;
    const second = layers[1]?.id;
    if (first === undefined || second === undefined) throw new Error('two shapes should exist');
    await selectLayer(page, first);
    await page.getByTestId(`layer-name-${second}`).click({ modifiers: ['Shift'] });

    await page.getByTestId('boolean-union').click();

    await expect.poll(async () => (await pathLayers(page)).length).toBe(1);
    const united = (await pathLayers(page))[0];
    expect(united?.name).toMatch(/Unite/);
    const contour = united?.vector?.path.contours[0];
    expect(contour?.closed).toBe(true);
    // A plus sign has twelve corners on its outline; anything near a single rectangle would mean the
    // operation returned one of its inputs.
    expect(contour?.nodes.length).toBeGreaterThanOrEqual(8);
    await expect(page.getByTestId('boolean-report')).toContainText(/flattening curves/i);
  });

  test('imports a hostile SVG without executing it, and imports real artwork as editable paths', async ({
    page,
  }) => {
    await createVectorDocument(page);

    await page
      .getByTestId('svg-paste')
      .fill(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>window.__owned = true;</script><path d="M2 2L22 2L22 22Z" onload="window.__owned = true"/></svg>',
      );
    await page.getByTestId('svg-import-paste').click();
    await expect(page.getByText(/could not be imported/i).first()).toBeVisible();
    expect(await storedDocument(page)).toMatchObject({ scene: { layers: [] } });
    expect(await page.evaluate(() => (window as { __owned?: boolean }).__owned)).toBeUndefined();

    await page
      .getByTestId('svg-paste')
      .fill(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Mark</title><path d="M4 4 L20 4 L20 20 L4 20 Z" fill="#123456" stroke="#ffffff" stroke-width="2"/></svg>',
      );
    await page.getByTestId('svg-import-paste').click();

    await expect.poll(async () => (await pathLayers(page)).length).toBe(1);
    const imported = (await pathLayers(page))[0];
    expect(imported?.vector?.style.fill).toBe('#123456');
    expect(imported?.vector?.style.stroke).toBe('#ffffff');
    expect(imported?.vector?.path.contours[0]?.nodes).toHaveLength(4);
  });

  test('exports SVG, then re-imports the downloaded bytes as editable geometry', async ({
    page,
  }) => {
    await createVectorDocument(page, 'SVG round trip');
    await drawShape(page, 'rectangle', { x: 32, y: 32 }, { x: 160, y: 160 });
    const justDrawn = (await pathLayers(page))[0];
    if (!justDrawn) throw new Error('the rectangle should be in the document');
    await selectLayer(page, justDrawn.id);
    await page.getByTestId('fill-colour').fill('#22cc88');
    await page.getByTestId('stroke-width').fill('6');
    await page.getByTestId('stroke-width').press('Enter');

    const before = (await pathLayers(page))[0];
    if (before?.type !== 'path') throw new Error('the rectangle should be a path layer');

    await expect(page.getByTestId('svg-export-summary')).toContainText('.svg');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('svg-export').click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('the SVG download produced no file');
    const bytes = await readFile(path, 'utf8');

    expect(download.suggestedFilename()).toMatch(/\.svg$/);
    expect(bytes.startsWith('<svg')).toBe(true);
    expect(bytes).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(bytes).toContain('<path');
    expect(bytes).toContain('viewBox="0 0 256 256"');
    // A deterministic serializer: the same document twice produces the same file.
    const [second] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('svg-export').click(),
    ]);
    const secondPath = await second.path();
    if (!secondPath) throw new Error('the second SVG download produced no file');
    expect(await readFile(secondPath, 'utf8')).toBe(bytes);

    // Re-import the file's own bytes through the panel's paste path and compare geometry. The file
    // carries the opaque canvas background as a real `<rect>`, so the import produces two layers —
    // the background and the artwork — and both are editable paths. That is stated here rather than
    // hidden by asking the exporter to drop the background.
    await page.getByTestId('svg-paste').fill(bytes);
    await page.getByTestId('svg-import-paste').click();
    await expect.poll(async () => (await pathLayers(page)).length).toBe(3);

    const importedLayers = await pathLayers(page);
    expect(importedLayers[1]?.vector?.style.fill?.toLowerCase()).toBe('#0f1115');
    const reimported = importedLayers[2];
    if (reimported?.type !== 'path' || reimported.vector === undefined) {
      throw new Error('the re-imported layer should be a path');
    }
    const originalNodes = before.vector?.path.contours[0]?.nodes ?? [];
    const importedNodes = reimported.vector.path.contours[0]?.nodes ?? [];
    expect(importedNodes).toHaveLength(originalNodes.length);
    for (const [index, node] of importedNodes.entries()) {
      const source = originalNodes[index];
      // The documented round-trip tolerance is 1e-3 document units; the serializer rounds to three
      // decimals, and this asserts the geometry really comes back rather than a bounding box.
      expect(Math.abs(node.point.x - (source?.point.x ?? 0))).toBeLessThan(1e-3);
      expect(Math.abs(node.point.y - (source?.point.y ?? 0))).toBeLessThan(1e-3);
    }
    expect(reimported.vector.style.fill).toBe('#22cc88');
  });

  test('paints a gradient in the browser, exports it, and re-imports the same paint', async ({
    page,
  }) => {
    await createVectorDocument(page, 'Gradient paint');
    await drawShape(page, 'rectangle', { x: 32, y: 32 }, { x: 224, y: 224 });
    const drawn = (await pathLayers(page))[0];
    if (!drawn) throw new Error('the rectangle should be in the document');
    await selectLayer(page, drawn.id);

    // A solid fill first, so the gradient is seeded from a colour the test chose.
    await page.getByTestId('fill-colour').fill('#22cc88');
    await page.getByTestId('fill-paint-kind').selectOption('linear-gradient');
    await expect
      .poll(async () => (await pathLayers(page))[0]?.vector?.style.fillPaint?.kind)
      .toBe('linear-gradient');
    const stored = (await pathLayers(page))[0]?.vector?.style.fillPaint;
    expect(stored?.stops).toHaveLength(2);
    expect(stored?.stops?.[0]?.color).toBe('#22cc88');

    // The artboard is a real canvas: sample it and check the two ends of the gradient differ.
    const samples = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="vector-canvas"]');
      if (!canvas) throw new Error('the vector canvas is missing');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('the artboard has no 2D context');
      const middle = Math.floor(canvas.height / 2);
      const read = (fraction: number): number[] =>
        Array.from(context.getImageData(Math.floor(canvas.width * fraction), middle, 1, 1).data);
      return { left: read(0.2), right: read(0.8) };
    });
    const channelDifference =
      Math.abs(samples.left[0]! - samples.right[0]!) +
      Math.abs(samples.left[1]! - samples.right[1]!) +
      Math.abs(samples.left[2]! - samples.right[2]!);
    expect(channelDifference).toBeGreaterThan(40);

    await expect(page.getByTestId('svg-export-summary')).toContainText('.svg');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('svg-export').click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('the SVG download produced no file');
    const bytes = await readFile(path, 'utf8');
    expect(bytes).toContain('<linearGradient');
    expect(bytes).toContain('gradientUnits="userSpaceOnUse"');
    expect(bytes).toContain('fill="url(#paint-1)"');
    expect(bytes.match(/<stop /g)).toHaveLength(2);

    // Re-import the downloaded bytes and prove the paint survives the file, not just the model.
    await page.getByTestId('svg-paste').fill(bytes);
    await page.getByTestId('svg-import-paste').click();
    await expect.poll(async () => (await pathLayers(page)).length).toBe(3);
    const imported = (await pathLayers(page)).at(-1);
    expect(imported?.vector?.style.fillPaint?.kind).toBe('linear-gradient');
    expect(imported?.vector?.style.fillPaint?.stops?.[0]?.color).toBe('#22cc88');
  });

  test('exports an icon set as a real zip containing one file per selected object', async ({
    page,
  }) => {
    await createVectorDocument(page, 'Icon set export');
    await drawShape(page, 'rectangle', { x: 24, y: 24 }, { x: 104, y: 104 });
    await drawShape(page, 'ellipse', { x: 128, y: 128 }, { x: 232, y: 232 });
    await drawShape(page, 'rectangle', { x: 40, y: 176 }, { x: 96, y: 232 });
    const layers = await pathLayers(page);
    expect(layers).toHaveLength(3);

    // An icon set is a selection export: with nothing selected there is nothing to package, and the
    // panel says so rather than quietly exporting the whole artboard.
    await expect(page.getByTestId('icon-set-export')).toBeDisabled();
    await expect(page.getByTestId('icon-set-summary')).toContainText(
      'Select one or more visible vector layers',
    );

    // Select all three through the layer list; Ctrl-click adds to the selection.
    await selectLayer(page, layers[0]!.id);
    await addToSelection(page, layers[1]!.id);
    await addToSelection(page, layers[2]!.id);
    await expect(page.getByTestId('icon-set-summary')).toContainText(
      '3 selected visible vector layer(s)',
    );

    await page.getByTestId('icon-set-name').fill('Glyphs');
    await expect(page.getByTestId('icon-set-export')).toBeEnabled();
    const { fileName, bytes } = await downloadIconSet(page);
    expect(fileName).toMatch(/\.zip$/);

    // A real, uncompressed ZIP: local file header signature.
    const archive = Buffer.from(bytes);
    expect(archive.subarray(0, 4).toString('binary')).toBe('PK\u0003\u0004');
    // Exactly the chosen icons plus the sprite and the manifest — no extras.
    expect(readZipEntryNames(bytes)).toEqual([
      'rectangle.svg',
      'ellipse.svg',
      'rectangle-2.svg',
      'icons.svg',
      'icons.json',
    ]);
    // Each icon takes its layer's name, so the archive is navigable without opening the manifest.
    const text = archive.toString('latin1');
    expect(text).toContain('<symbol id="rectangle-2"');
    const manifest = JSON.parse(
      new TextDecoder().decode(readZipEntry(bytes, 'icons.json') ?? new Uint8Array()),
    ) as { icons: readonly { file: string; name: string }[] };
    expect(manifest.icons.map((icon) => icon.file)).toEqual([
      'rectangle.svg',
      'ellipse.svg',
      'rectangle-2.svg',
    ]);

    await expect(page.getByTestId('icon-set-report')).toContainText('3 icon file(s)');
  });

  test('exports only the selected icons, never the rest of the artboard', async ({ page }) => {
    await createVectorDocument(page, 'Selected icons');
    await drawShape(page, 'rectangle', { x: 24, y: 24 }, { x: 104, y: 104 });
    await drawShape(page, 'ellipse', { x: 128, y: 128 }, { x: 232, y: 232 });
    await drawShape(page, 'star', { x: 40, y: 176 }, { x: 96, y: 232 });
    const layers = await pathLayers(page);
    expect(layers).toHaveLength(3);
    const [rectangle, ellipse, star] = layers;
    if (!rectangle || !ellipse || !star) throw new Error('three layers should have been drawn');

    // Two of three selected: the rectangle is deliberately left out.
    await selectLayer(page, ellipse.id);
    await addToSelection(page, star.id);
    await expect(page.getByTestId('icon-set-summary')).toContainText(
      '2 selected visible vector layer(s)',
    );
    await expect(page.getByTestId('icon-set-export')).toBeEnabled();

    const { bytes } = await downloadIconSet(page);
    expect(readZipEntryNames(bytes)).toEqual([
      'ellipse.svg',
      'star.svg',
      'icons.svg',
      'icons.json',
    ]);
    const manifest = JSON.parse(
      new TextDecoder().decode(readZipEntry(bytes, 'icons.json') ?? new Uint8Array()),
    ) as { icons: readonly { file: string; name: string }[] };
    expect(manifest.icons.map((icon) => icon.name)).toEqual(['Ellipse', 'Star']);
    // The unselected rectangle is not represented in the archive at all.
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('rectangle.svg');
    await expect(page.getByTestId('icon-set-report')).toContainText('2 icon file(s)');
    await expect(page.getByTestId('icon-set-report')).toContainText('ellipse.svg, star.svg');
  });

  test('cannot include a hidden layer and cannot export an empty selection', async ({ page }) => {
    await createVectorDocument(page, 'Hidden icons');
    await drawShape(page, 'rectangle', { x: 24, y: 24 }, { x: 104, y: 104 });
    await drawShape(page, 'ellipse', { x: 128, y: 128 }, { x: 232, y: 232 });
    const layers = await pathLayers(page);
    const [rectangle, ellipse] = layers;
    if (!rectangle || !ellipse) throw new Error('two layers should have been drawn');

    await selectLayer(page, rectangle.id);
    await addToSelection(page, ellipse.id);
    await expect(page.getByTestId('icon-set-summary')).toContainText(
      '2 selected visible vector layer(s)',
    );

    // A hidden layer stays selected but cannot be part of the drawing, so it cannot be part of the
    // set: the count drops, the reason is named, and the archive really contains only one icon.
    await page.getByRole('button', { name: `Hide “${rectangle.name}”` }).click();
    const summary = page.getByTestId('icon-set-summary');
    await expect(summary).toContainText('1 selected visible vector layer(s)');
    await expect(summary).toContainText(`Not written: “${rectangle.name}” — the layer is hidden`);
    const { bytes } = await downloadIconSet(page);
    expect(readZipEntryNames(bytes)).toEqual(['ellipse.svg', 'icons.svg', 'icons.json']);
    await expect(page.getByTestId('icon-set-report')).toContainText('1 icon file(s)');
    await expect(page.getByTestId('icon-set-report')).toContainText(
      `Not written: “${rectangle.name}” — the layer is hidden`,
    );

    // Clicking empty artwork with the select tool clears the selection; the export is refused and
    // the report about the previous download is retired rather than left next to a different set.
    await page.getByTestId('tool-select').click();
    await clickVector(page, { x: 4, y: 4 });
    await expect(page.getByTestId('icon-set-export')).toBeDisabled();
    await expect(summary).toContainText('Select one or more visible vector layers');
    await expect(page.getByTestId('icon-set-report')).toHaveCount(0);
  });

  test('carries artwork from Illustration to Design and back', async ({ page }) => {
    const vectorId = await createVectorDocument(page, 'Interchange source');
    await drawShape(page, 'rectangle', { x: 32, y: 32 }, { x: 160, y: 160 });
    const drawn = (await pathLayers(page))[0];
    if (!drawn) throw new Error('the rectangle should be in the document');
    await selectLayer(page, drawn.id);
    // Paint is part of what crosses the boundary, so the interchange is tested with paint on it.
    await page.getByTestId('fill-paint-kind').selectOption('linear-gradient');
    await expect
      .poll(async () => (await pathLayers(page))[0]?.vector?.style.fillPaint?.kind)
      .toBe('linear-gradient');

    // Out of the vector document into a design canvas.
    const outbound = page.locator('section', { has: page.getByTestId('interchange-create') });
    await page.getByTestId('interchange-create').click();
    await expect(page.getByTestId('interchange-created')).toBeVisible();
    const designDocument = (await storedDocuments(page)).find(
      (document) => document.id !== vectorId,
    );
    expect(designDocument?.documentTypeId).toBe('design.canvas');
    expect(designDocument?.scene.layers[0]?.type).toBe('path');
    expect(designDocument?.scene.layers[0]?.vector?.path.contours[0]?.nodes).toHaveLength(4);
    expect(designDocument?.scene.layers[0]?.vector?.style.fillPaint?.kind).toBe('linear-gradient');
    void outbound;

    // Open the converted document through the link the panel offers, then convert it back.
    await page.getByRole('link', { name: /Open it/ }).click();
    await page.waitForURL(new RegExp(`/workspace/${String(designDocument?.id)}$`));
    await expect(page.getByTestId('artboard')).toBeVisible();

    const designInterchange = page.locator('section', {
      has: page.getByRole('heading', { name: 'Interchange' }),
    });
    await designInterchange.getByTestId('interchange-create').click();
    await expect.poll(async () => (await storedDocuments(page)).length).toBe(3);

    const returned = (await storedDocuments(page)).find(
      (document) =>
        document.id !== vectorId &&
        document.id !== designDocument?.id &&
        document.documentTypeId === 'illustration.artboard',
    );
    expect(returned).toBeDefined();
    const returnedLayer = returned?.scene.layers[0];
    expect(returnedLayer?.type).toBe('path');
    expect(returnedLayer?.vector?.path.contours[0]?.nodes).toHaveLength(4);
    expect(returnedLayer?.vector?.style.fillPaint?.kind).toBe('linear-gradient');
  });

  test('exports SVG from a Design document through the export panel', async ({ page }) => {
    await page.goto('/create');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Width').fill('320');
    await page.getByLabel('Height').fill('240');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Project name').fill('Design SVG export');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/workspace\/[^/]+$/);

    // Two shape layers and one text layer: the text is not outlined, so the export refuses until the
    // omission is acknowledged — and then names the layer it left out.
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.getByRole('button', { name: 'Ellipse', exact: true }).click();
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByLabel('Format', { exact: true }).selectOption('svg');

    await expect(page.getByText(/SVG cannot represent 1 layer\(s\): Text\./).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export blocked' })).toBeDisabled();
    await page.getByTestId('export-allow-partial').check();
    await expect(page.getByTestId('export-allow-partial')).toBeChecked();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export SVG/ }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('the design SVG download produced no file');
    const contents = await readFile(path, 'utf8');

    expect(contents.startsWith('<svg')).toBe(true);
    expect(contents).toContain('<path');
    expect(contents).toContain('viewBox="0 0 320 240"');
    // The text layer is genuinely absent rather than converted into something it is not, and the
    // panel says how many layers were left out.
    expect(contents).not.toContain('<text');
    await expect(page.getByTestId('last-svg-export')).toContainText('of SVG text');
    await expect(page.getByTestId('last-svg-export')).toContainText('1');
  });
});
