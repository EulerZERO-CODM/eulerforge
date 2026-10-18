import { loadImage, createCanvas } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { STORAGE_KEY } from './fixtures';

/**
 * Photo Studio, in a real browser.
 *
 * The claims that matter here cannot be checked in jsdom: an image really decodes, the pixel
 * pipeline really runs (on the GPU where available and on the CPU otherwise), the preview canvas
 * really holds pixels, and the export is a real file whose bytes are decoded and sampled again.
 *
 * The fixture image is generated in this process: a 320 × 240 PNG with a hard vertical edge at
 * x = 160 (left #3c3c3c, right #8c8c8c). Flat halves make the arithmetic checkable — an exposure of
 * +0.4 EV multiplies both by 1.3195 — and the edge makes retouching observable.
 */

const LEFT = [60, 60, 60] as const;
const RIGHT = [140, 140, 140] as const;
const WIDTH = 320;
const HEIGHT = 240;
const EXPOSURE_FACTOR = 2 ** 0.4; // the stack's "Exposure" initial value of 20 means +0.4 EV.

type StoredPhotoPayload = {
  readonly kind: 'photo';
  readonly version: 1;
  readonly source: {
    readonly name: string;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly adjustments: readonly {
    readonly kind: string;
    readonly value: number;
    enabled: boolean;
  }[];
  readonly mask: {
    readonly strokes: readonly { readonly points: readonly { x: number; y: number }[] }[];
    readonly inverted: boolean;
  } | null;
  readonly retouch: readonly { readonly mode: string }[];
  readonly engine: 'auto' | 'webgl2' | 'canvas2d';
};

type StoredPhotoDocument = {
  readonly id: string;
  readonly title: string;
  readonly documentTypeId: string;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly studioPayload: StoredPhotoPayload | null;
};

async function storedPhoto(page: Page): Promise<StoredPhotoDocument> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  if (raw === null) throw new Error('no document has been saved yet');
  const envelope = JSON.parse(raw) as { documents: StoredPhotoDocument[] };
  const document = envelope.documents[0];
  if (!document) throw new Error('the saved envelope holds no document');
  return document;
}

async function photoPayload(page: Page): Promise<StoredPhotoPayload> {
  const payload = (await storedPhoto(page)).studioPayload;
  if (!payload) throw new Error('the document is not a photo document');
  return payload;
}

/** Creates a photo project through the studio page, the product's own entry point. */
async function createPhotoDocument(page: Page, title = 'Browser portrait'): Promise<void> {
  await page.goto('/studios/photo');
  await expect(page.getByRole('heading', { name: 'Photo Studio', level: 1 })).toBeVisible();
  await expect(page.getByText('Available now').first()).toBeVisible();
  await page.getByRole('link', { name: 'Create a project' }).first().click();

  await expect(page).toHaveURL(/\/create\?studio=photo$/);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Project name').fill(title);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.locator('dt', { hasText: 'Document type' }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('Photo image');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.waitForURL(/\/workspace\/[^/]+$/);
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeVisible();
}

/** Swatch colours for the parity chart: flat areas make a channel-by-channel comparison meaningful. */
const SWATCHES = [
  [220, 40, 40],
  [40, 180, 80],
  [40, 80, 220],
  [230, 210, 60],
  [20, 20, 20],
  [240, 240, 240],
  [140, 90, 40],
  [0, 170, 170],
  [200, 60, 200],
  [120, 120, 120],
  [250, 140, 40],
  [60, 60, 140],
] as const;
const CHART_WIDTH = 240;
const CHART_HEIGHT = 180;

/** A 4 × 3 colour chart: twelve flat swatches, so every adjustment has something to act on. */
async function chartPng(): Promise<Buffer> {
  const canvas = createCanvas(CHART_WIDTH, CHART_HEIGHT);
  const context = canvas.getContext('2d');
  for (const [index, colour] of SWATCHES.entries()) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    context.fillStyle = `rgb(${colour.join(',')})`;
    context.fillRect(column * 60, row * 60, 60, 60);
  }
  return canvas.encode('png');
}

/** The centre of every swatch, in working-copy pixels. */
const SWATCH_POINTS = SWATCHES.map((_, index) => ({
  x: (index % 4) * 60 + 30,
  y: Math.floor(index / 4) * 60 + 30,
}));

async function importChart(page: Page): Promise<void> {
  const buffer = await chartPng();
  await page.getByLabel('Import a photo file').setInputFiles({
    name: 'chart.png',
    mimeType: 'image/png',
    buffer,
  });
  await expect(page.getByTestId('photo-import-report')).toContainText(
    `${CHART_WIDTH} × ${CHART_HEIGHT}`,
  );
  await expect
    .poll(async () => previewCanvas(page).evaluate((canvas) => (canvas as HTMLCanvasElement).width))
    .toBe(CHART_WIDTH);
}

/** Replaces the persisted photo payload and reloads, the way reopening a saved project does. */
async function setPhotoPayload(page: Page, patch: Partial<StoredPhotoPayload>): Promise<void> {
  await page.evaluate(
    ({ key, patch: next }) => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) throw new Error('nothing is stored yet');
      const envelope = JSON.parse(raw) as { documents: Record<string, unknown>[] };
      const document = envelope.documents[0];
      if (!document) throw new Error('the envelope holds no document');
      document.studioPayload = { ...(document.studioPayload as object), ...next };
      window.localStorage.setItem(key, JSON.stringify(envelope));
    },
    { key: STORAGE_KEY, patch },
  );
  await page.reload();
  await expect
    .poll(async () => previewCanvas(page).evaluate((canvas) => (canvas as HTMLCanvasElement).width))
    .toBe(CHART_WIDTH);
}

/** A real PNG built in this process, with a hard edge down the middle. */
async function fixturePng(): Promise<Buffer> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext('2d');
  context.fillStyle = `rgb(${LEFT.join(',')})`;
  context.fillRect(0, 0, WIDTH / 2, HEIGHT);
  context.fillStyle = `rgb(${RIGHT.join(',')})`;
  context.fillRect(WIDTH / 2, 0, WIDTH / 2, HEIGHT);
  return canvas.encode('png');
}

/** Imports the fixture through the file input and waits for the document to say so. */
async function importFixture(page: Page): Promise<void> {
  const buffer = await fixturePng();
  await page.getByLabel('Import a photo file').setInputFiles({
    name: 'edge.png',
    mimeType: 'image/png',
    buffer,
  });
  await expect(page.getByTestId('photo-import-report')).toContainText('320 × 240');
  await expect.poll(async () => (await photoPayload(page)).source?.width).toBe(WIDTH);
  // The preview canvas is only sized once a render has completed; sampling before that would read
  // the browser's default 300 × 150 canvas.
  await expect
    .poll(async () => previewCanvas(page).evaluate((canvas) => (canvas as HTMLCanvasElement).width))
    .toBe(WIDTH);
}

function previewCanvas(page: Page): Locator {
  return page.getByTestId('photo-preview');
}

/** Reads one pixel out of the live preview canvas, in working-copy coordinates. */
async function previewPixel(page: Page, x: number, y: number): Promise<readonly number[]> {
  return previewCanvas(page).evaluate(
    (canvas, point) => {
      const context = (canvas as HTMLCanvasElement).getContext('2d');
      if (!context) throw new Error('the preview canvas has no 2D context');
      return Array.from(context.getImageData(point.x, point.y, 1, 1).data);
    },
    { x, y },
  );
}

/** Waits until a preview pixel is close to an expected value, and returns what was read. */
async function expectPreviewPixel(
  page: Page,
  point: { readonly x: number; readonly y: number },
  expected: readonly number[],
  tolerance = 2,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const pixel = await previewPixel(page, point.x, point.y);
        const matches = [0, 1, 2].every(
          (channel) => Math.abs((pixel[channel] ?? 0) - (expected[channel] ?? 0)) <= tolerance,
        );
        return matches;
      },
      { message: `preview pixel at ${point.x},${point.y} should be about ${expected.join(',')}` },
    )
    .toBe(true);
}

/** Drags the pointer across the preview in *normalised* positions, as the mask tool does. */
async function paintAcross(
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): Promise<void> {
  const surface = page.getByTestId('photo-interaction');
  const box = await surface.boundingBox();
  if (!box) throw new Error('the interaction canvas has no box');
  await page.mouse.move(box.x + from.x * box.width, box.y + from.y * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x * box.width, box.y + to.y * box.height, { steps: 12 });
  await page.mouse.up();
}

/** Downloads the current export and decodes it back into sampleable pixels. */
async function exportAndDecode(
  page: Page,
  format: 'PNG' | 'JPEG' | 'WebP' = 'PNG',
): Promise<{
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
  readonly pixel: (x: number, y: number) => readonly number[];
}> {
  await page.getByLabel('Format').selectOption(format === 'JPEG' ? 'jpeg' : format.toLowerCase());
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: `Export ${format}` }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('the export produced no file');
  const bytes = await readFile(path);
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return {
    bytes,
    width: image.width,
    height: image.height,
    pixel: (x, y) => Array.from(context.getImageData(x, y, 1, 1).data),
  };
}

/** PNG IHDR dimensions, read straight out of the file's bytes. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe('Photo Studio', () => {
  test('imports an image, adjusts it, undoes, exports real bytes and reopens the saved edit', async ({
    page,
  }) => {
    await createPhotoDocument(page);
    await importFixture(page);

    // As imported: the stack is empty and the preview shows the source pixels.
    await expectPreviewPixel(page, { x: 60, y: 120 }, LEFT);
    await expectPreviewPixel(page, { x: 280, y: 120 }, RIGHT);
    expect((await storedPhoto(page)).canvas).toMatchObject({ width: WIDTH, height: HEIGHT });

    // Add exposure at its documented initial value (+0.4 EV). Both halves brighten by 1.3195.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(async () => (await photoPayload(page)).adjustments.length).toBe(1);
    const lifted = LEFT.map((value) => Math.round(value * EXPOSURE_FACTOR));
    await expectPreviewPixel(page, { x: 60, y: 120 }, lifted);

    // Undo and redo through the toolbar, not the session.
    await page.getByRole('button', { name: 'Undo (Cmd/Ctrl + Z)' }).click();
    await expectPreviewPixel(page, { x: 60, y: 120 }, LEFT);
    await page.getByRole('button', { name: 'Redo (Cmd/Ctrl + Shift + Z)' }).click();
    await expectPreviewPixel(page, { x: 60, y: 120 }, lifted);
    expect(await page.getByTestId('photo-status').textContent()).toBeTruthy();

    // Export: real bytes, real size, and the exported pixels are the edited ones.
    const exported = await exportAndDecode(page, 'PNG');
    expect(exported.bytes.subarray(0, 8).toString('binary')).toBe('\u0089PNG\r\n\u001a\n');
    expect(exported.width).toBe(WIDTH);
    expect(exported.height).toBe(HEIGHT);
    expect(pngSize(exported.bytes)).toEqual({ width: WIDTH, height: HEIGHT });
    expect(exported.pixel(60, 120)[0]).toBeCloseTo(lifted[0] ?? 0, -1);
    await expect(page.getByTestId('photo-export-report')).toContainText('320 × 240');

    // Reopen: the project library is where a saved project comes back from.
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Browser portrait', exact: true }).click();
    await page.waitForURL(/\/workspace\/[^/]+$/);
    await expect
      .poll(async () =>
        previewCanvas(page).evaluate((canvas) => (canvas as HTMLCanvasElement).width),
      )
      .toBe(WIDTH);
    await expect(page.getByLabel('Exposure amount')).toBeVisible();
    await expectPreviewPixel(page, { x: 60, y: 120 }, lifted);
  });

  test('limits the stack to the painted mask and exports only the adjusted side', async ({
    page,
  }) => {
    await createPhotoDocument(page, 'Masked portrait');
    await importFixture(page);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(async () => (await photoPayload(page)).adjustments.length).toBe(1);

    // Paint a brush stroke across the left half only.
    await page.getByRole('button', { name: 'Brush mask' }).click();
    await paintAcross(page, { x: 0.06, y: 0.5 }, { x: 0.4, y: 0.5 });
    await expect.poll(async () => (await photoPayload(page)).mask?.strokes.length ?? 0).toBe(1);
    await expect(page.getByText('1 / 200 strokes')).toBeVisible();

    // Inside the stroke the stack applies; outside it the source pixels are untouched.
    const lifted = LEFT.map((value) => Math.round(value * EXPOSURE_FACTOR));
    await expectPreviewPixel(page, { x: 40, y: 120 }, lifted);
    await expectPreviewPixel(page, { x: 280, y: 120 }, RIGHT);

    const masked = await exportAndDecode(page, 'PNG');
    expect(Math.abs((masked.pixel(40, 120)[0] ?? 0) - (lifted[0] ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((masked.pixel(280, 120)[0] ?? 0) - RIGHT[0])).toBeLessThanOrEqual(2);

    // Inverting the mask swaps which side is edited, and the document records it.
    await page.getByRole('switch', { name: /Invert mask/ }).click();
    await expect.poll(async () => (await photoPayload(page)).mask?.inverted).toBe(true);
    // A 60 %-hard brush leaves a feathered core: inverting it removes 97 % of the adjustment rather
    // than 100 %, which is what a soft mask is meant to do. The tolerance states that explicitly
    // instead of pretending the edge is binary.
    await expectPreviewPixel(page, { x: 40, y: 120 }, LEFT, 5);
    await expectPreviewPixel(
      page,
      { x: 280, y: 120 },
      RIGHT.map((v) => Math.round(v * EXPOSURE_FACTOR)),
    );

    // Clearing the mask returns the whole frame to the stack.
    await page.getByRole('button', { name: 'Clear mask' }).click();
    await expect.poll(async () => (await photoPayload(page)).mask?.strokes.length).toBe(0);
    await expectPreviewPixel(
      page,
      { x: 280, y: 120 },
      RIGHT.map((v) => Math.round(v * EXPOSURE_FACTOR)),
    );
  });

  test('heals a real blemish edge in the exported file', async ({ page }) => {
    await createPhotoDocument(page, 'Retouched edge');
    await importFixture(page);

    await page.getByRole('button', { name: 'Heal' }).click();
    await paintAcross(page, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 });
    await expect.poll(async () => (await photoPayload(page)).retouch.length).toBe(1);
    await expect.poll(async () => (await photoPayload(page)).retouch[0]?.mode).toBe('heal');

    // The hard edge is softened where the stroke crossed it, and the rest of the frame is untouched.
    const healed = await exportAndDecode(page, 'PNG');
    const atEdge = healed.pixel(160, 120)[0] ?? 0;
    expect(atEdge).toBeGreaterThan(LEFT[0]);
    expect(atEdge).toBeLessThan(RIGHT[0]);
    // Away from the stroke the image is untouched: the heal only edited the painted band. The +-2
    // window comes from the import itself — the working copy is stored as WebP, so a flat area can
    // decode one level away from the source PNG.
    expect(Math.abs((healed.pixel(280, 120)[0] ?? 0) - RIGHT[0])).toBeLessThanOrEqual(2);
    expect(Math.abs((healed.pixel(40, 120)[0] ?? 0) - LEFT[0])).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: 'Undo last retouch' }).click();
    await expect.poll(async () => (await photoPayload(page)).retouch.length).toBe(0);
    await expectPreviewPixel(page, { x: 160, y: 120 }, RIGHT);
  });

  test('renders every adjustment on the GPU and matches the CPU reference', async ({ page }) => {
    await createPhotoDocument(page, 'Engine parity');
    await importChart(page);

    const hasWebgl2 = await page.evaluate(
      () => document.createElement('canvas').getContext('webgl2') !== null,
    );
    // The Playwright project launches Chromium with SwiftShader, so this is a hard precondition of
    // the suite: if WebGL2 disappears, the GPU renderer is no longer verified and the run must fail
    // rather than quietly reduce coverage.
    expect(hasWebgl2, 'the browser suite must expose WebGL2 (see playwright.config.ts)').toBe(true);

    const cases = [
      { kind: 'exposure', value: 45 },
      { kind: 'contrast', value: 40 },
      { kind: 'saturation', value: 55 },
      { kind: 'temperature', value: 40 },
      { kind: 'tint', value: -40 },
      { kind: 'highlights', value: -60 },
      { kind: 'shadows', value: 60 },
      { kind: 'vibrance', value: 70 },
      { kind: 'clarity', value: 80 },
      { kind: 'grayscale', value: 65 },
      { kind: 'sepia', value: 55 },
      { kind: 'vignette', value: 70 },
    ] as const;

    for (const testCase of cases) {
      const adjustments = [
        {
          id: `adjustment-${testCase.kind}`,
          kind: testCase.kind,
          value: testCase.value,
          enabled: true,
        },
      ];
      await setPhotoPayload(page, { engine: 'canvas2d', adjustments, mask: null });
      const cpu = await Promise.all(
        SWATCH_POINTS.map((point) => previewPixel(page, point.x, point.y)),
      );

      await setPhotoPayload(page, { engine: 'webgl2', adjustments, mask: null });
      await expect(page.getByText(/Last preview: WebGL2/)).toBeVisible();
      const gpu = await Promise.all(
        SWATCH_POINTS.map((point) => previewPixel(page, point.x, point.y)),
      );

      for (const [index, expected] of cpu.entries()) {
        const actual = gpu[index] ?? [];
        for (const channel of [0, 1, 2]) {
          // The shader is highp float and the CPU path rounds once at the end; one level of
          // difference is arithmetic, two is the documented tolerance.
          expect(
            Math.abs((actual[channel] ?? 0) - (expected[channel] ?? 0)),
            `${testCase.kind} at swatch ${String(index)}, channel ${String(channel)}`,
          ).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  test('mixes a local mask identically on both renderers', async ({ page }) => {
    await createPhotoDocument(page, 'Mask parity');
    await importChart(page);

    const adjustments = [{ id: 'adjustment-exposure', kind: 'exposure', value: 60, enabled: true }];
    // A filled lasso around the left half: the model is the same one the pointer paints, written
    // directly here so the shader's mix pass is compared without depending on pointer geometry.
    const mask = {
      strokes: [
        {
          id: 'mask-parity',
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0 },
            { x: 0.5, y: 1 },
            { x: 0, y: 1 },
          ],
          radius: 0.05,
          hardness: 1,
          erase: false,
          fill: true,
        },
      ],
      inverted: false,
    };

    await setPhotoPayload(page, { engine: 'canvas2d', adjustments, mask });
    const cpu = await Promise.all(
      SWATCH_POINTS.map((point) => previewPixel(page, point.x, point.y)),
    );

    await setPhotoPayload(page, { engine: 'webgl2', adjustments, mask });
    await expect(page.getByText(/Last preview: WebGL2/)).toBeVisible();
    const gpu = await Promise.all(
      SWATCH_POINTS.map((point) => previewPixel(page, point.x, point.y)),
    );

    for (const [index, expected] of cpu.entries()) {
      const actual = gpu[index] ?? [];
      for (const channel of [0, 1, 2]) {
        expect(
          Math.abs((actual[channel] ?? 0) - (expected[channel] ?? 0)),
          `masked mix at swatch ${String(index)}, channel ${String(channel)}`,
        ).toBeLessThanOrEqual(2);
      }
    }
    // Swatch 2 sits at x = 150, outside the lasso, so it keeps its source colour on both renderers.
    const unaffected = gpu[2] ?? [];
    expect(Math.abs((unaffected[0] ?? 0) - 40)).toBeLessThanOrEqual(3);
  });

  test('falls back to the CPU when the browser refuses WebGL2, and says so', async ({ page }) => {
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        'getContext',
      ) as PropertyDescriptor;
      const original = descriptor.value as (
        this: HTMLCanvasElement,
        contextId: string,
        ...rest: unknown[]
      ) => unknown;
      // Only the GPU context is refused; 2D canvases keep working, which is exactly the situation a
      // blocked/driver-less browser presents to the app.
      HTMLCanvasElement.prototype.getContext = function getContext(
        this: HTMLCanvasElement,
        contextId: string,
        ...rest: unknown[]
      ) {
        if (contextId === 'webgl2') return null;
        return original.call(this, contextId, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await createPhotoDocument(page, 'No WebGL2');
    await importFixture(page);

    // `auto` is the default: it renders on the CPU without bothering the user.
    await expect(page.getByText(/Last preview: Canvas 2D/)).toBeVisible();
    await expectPreviewPixel(page, { x: 60, y: 120 }, LEFT);

    // Asking for the GPU explicitly cannot be honoured, so it is refused with a reason rather than
    // silently rendering something else.
    await page.getByRole('button', { name: 'GPU (WebGL2)' }).click();
    await expect(
      page.getByText('The GPU renderer is not available in this browser.'),
    ).toBeVisible();
    await expect.poll(async () => (await photoPayload(page)).engine).toBe('webgl2');
  });

  test('is explicit about the renderer it is using', async ({ page }) => {
    await createPhotoDocument(page, 'Renderer choice');
    await importFixture(page);

    await page.getByRole('button', { name: 'CPU (Canvas 2D)' }).click();
    await expect.poll(async () => (await photoPayload(page)).engine).toBe('canvas2d');
    await expect(page.getByText(/Last preview: Canvas 2D/)).toBeVisible();
    await expectPreviewPixel(page, { x: 60, y: 120 }, LEFT);

    const hasWebgl2 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      return canvas.getContext('webgl2') !== null;
    });
    await page.getByRole('button', { name: 'GPU (WebGL2)' }).click();
    await expect.poll(async () => (await photoPayload(page)).engine).toBe('webgl2');
    if (hasWebgl2) {
      await expect(page.getByText(/Last preview: WebGL2/)).toBeVisible();
      // The GPU path mirrors the CPU pipeline, so the same document renders the same pixels ±1.
      await expectPreviewPixel(page, { x: 60, y: 120 }, LEFT, 1);
    } else {
      // Without WebGL2 the app refuses the request instead of quietly switching engines behind the
      // user's back, and says why.
      await expect(
        page.getByText('The GPU renderer is not available in this browser.'),
      ).toBeVisible();
    }
  });
});
