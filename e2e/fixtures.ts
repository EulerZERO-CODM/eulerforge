import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the browser suite.
 *
 * Two habits keep these tests honest:
 *
 * 1. Inputs come from the *persisted* document. A click coordinate is computed from the frame the
 *    application actually saved, not from a number copied into the test, so the specs cannot drift
 *    away from the product.
 * 2. Assertions read the same place. "The gesture worked" means "the saved document changed by
 *    exactly this much", which is the contract a user cares about.
 */

export const STORAGE_KEY = 'eulerforge.v1.documents';

export type StoredFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type StoredLayer = {
  readonly id: string;
  readonly name: string;
  readonly type: 'text' | 'rect' | 'ellipse' | 'image';
  readonly frame: StoredFrame;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
};

export type StoredDocument = {
  readonly id: string;
  readonly title: string;
  readonly revision: number;
  readonly canvas: StoredFrame & { readonly dpi: number };
  readonly scene: { readonly layers: readonly StoredLayer[] };
};

type StoredEnvelope = { readonly documents: readonly StoredDocument[] };

/** The document as the application persisted it, straight out of `localStorage`. */
export async function stored(page: Page): Promise<StoredDocument> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  if (raw === null) throw new Error('no document has been saved yet');
  const envelope = JSON.parse(raw) as StoredEnvelope;
  const document = envelope.documents[0];
  if (!document) throw new Error('the saved envelope holds no document');
  return document;
}

/** Waits until the persisted document satisfies a predicate, then returns it. */
export async function storedWhen(
  page: Page,
  predicate: (document: StoredDocument) => boolean,
  message: string,
): Promise<StoredDocument> {
  await expect.poll(async () => predicate(await stored(page)), { message }).toBe(true);
  return stored(page);
}

export function layerNamed(document: StoredDocument, name: string): StoredLayer {
  const layer = document.scene.layers.find((candidate) => candidate.name === name);
  if (!layer) {
    throw new Error(
      `no layer named ${name}; the document holds ${document.scene.layers
        .map((entry) => entry.name)
        .join(', ')}`,
    );
  }
  return layer;
}

export function centreOf(frame: StoredFrame): { x: number; y: number } {
  return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
}

/** Creates a project through the real four-step flow and lands in the workspace. */
export async function createProject(
  page: Page,
  options: { readonly title?: string; readonly width?: number; readonly height?: number } = {},
): Promise<string> {
  const title = options.title ?? 'Browser verification';
  const width = options.width ?? 800;
  const height = options.height ?? 500;

  await page.goto('/create');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Width').fill(String(width));
  await page.getByLabel('Height').fill(String(height));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Project name').fill(title);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.waitForURL(/\/workspace\/[^/]+$/);
  await expect(page.getByTestId('artboard')).toBeVisible();
  await expect(page.getByRole('img', { name: /Artboard preview/ })).toBeVisible();

  const id = page.url().split('/').pop();
  if (!id) throw new Error('the workspace url carries no document id');
  return id;
}

/** Adds a layer with the toolbar's Add buttons, exactly as a person would. */
export async function addLayer(page: Page, kind: 'Text' | 'Rectangle' | 'Ellipse'): Promise<void> {
  const before = (await stored(page)).scene.layers.length;
  await page.getByRole('button', { name: kind, exact: true }).click();
  await storedWhen(
    page,
    (document) => document.scene.layers.length === before + 1,
    `a ${kind} layer should have been added`,
  );
}

/** Snapping is on by default; the geometry specs turn it off so a drag lands on exact numbers. */
export async function setSnapping(page: Page, enabled: boolean): Promise<void> {
  const toggle = page.getByRole('button', { name: /^Snapping (on|off)$/ });
  const pressed = (await toggle.getAttribute('aria-pressed')) === 'true';
  if (pressed !== enabled) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', String(enabled));
  }
}

/**
 * Scale (CSS pixels per document pixel) at the stage's current zoom.
 *
 * The stage defaults to `fit`, and a percentage maps document pixels to CSS pixels. Reading the
 * scale from the rendered box keeps the pointer maths in these specs true at every zoom instead of
 * assuming 1:1.
 */
export async function artboardScale(page: Page): Promise<{ scale: number }> {
  const artboard = page.getByTestId('artboard');
  const box = await artboard.boundingBox();
  if (!box) throw new Error('the artboard has no box to measure');
  const canvasWidth = Number(await artboard.getAttribute('data-canvas-width'));
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) {
    throw new Error('the artboard does not report its canvas width');
  }
  return { scale: box.width / canvasWidth };
}

/** Document pixel -> viewport point, at whatever zoom the stage is currently using. */
export async function pointInDocument(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<{ x: number; y: number }> {
  const artboard = page.getByTestId('artboard');
  const box = await artboard.boundingBox();
  if (!box) throw new Error('the artboard has no box to measure');
  const { scale } = await artboardScale(page);
  return { x: box.x + point.x * scale, y: box.y + point.y * scale };
}

export type DragOptions = {
  /** Keyboard modifier held for the whole gesture, as a real modifier-click carries it. */
  readonly modifier?: 'Shift' | 'Control' | 'Meta';
  /** Replaces the default release behaviour: used by the cancellation spec. */
  readonly duringDrag?: () => Promise<void>;
};

/** A real pointer drag on the artboard, in document pixels. */
export async function dragInDocument(
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  options: DragOptions = {},
): Promise<void> {
  const start = await pointInDocument(page, from);
  const end = await pointInDocument(page, to);
  if (options.modifier) await page.keyboard.down(options.modifier);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  if (options.duringDrag) await options.duringDrag();
  await page.mouse.up();
  if (options.modifier) await page.keyboard.up(options.modifier);
}

/** A press and release in one place: a click, not a drag. */
export async function clickInDocument(
  page: Page,
  point: { readonly x: number; readonly y: number },
  options: DragOptions = {},
): Promise<void> {
  await dragInDocument(page, point, point, options);
}

/** A name safe to embed in a regular expression. */
function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The layer list row for a layer with an exact name.
 *
 * Rows are matched through their own Lock/Unlock control, whose accessible name carries the layer
 * name, so "Panel" can never be confused with "Panel copy".
 */
export function layerRow(page: Page, name: string) {
  const lock = page.getByRole('button', {
    name: new RegExp(`^(?:Lock|Unlock) \u201c${escaped(name)}\u201d$`),
  });
  return page.locator('[data-testid^="layer-row-"]').filter({ has: lock });
}

/** The row's name button: pressing it selects the layer. */
export function layerButton(page: Page, name: string) {
  return layerRow(page, name).locator('[data-testid^="layer-name-"]');
}

/** Renames a layer through the inspector, the keyboard path a person would use. */
export async function renameSelectedLayer(page: Page, name: string): Promise<void> {
  const field = page.getByLabel('Layer name');
  await field.fill(name);
  await field.press('Enter');
  await expect(field).toHaveValue(name);
}

export async function selectLayerFromList(page: Page, name: string): Promise<void> {
  await layerButton(page, name).click();
  await expect(layerButton(page, name)).toHaveAttribute('aria-current', 'true');
}

export async function addLayerToSelection(page: Page, name: string): Promise<void> {
  await layerButton(page, name).click({ modifiers: ['Shift'] });
  await expect(layerButton(page, name)).toHaveAttribute('aria-current', 'true');
}

/** Labels in the history panel, newest first, exactly as the rail renders them. */
export async function historyLabels(page: Page): Promise<string[]> {
  const items = page.locator('section[aria-labelledby="history-panel-heading"] ol li');
  if ((await items.count()) === 0) return [];
  const texts = await items.allInnerTexts();
  return texts.map((text) => text.replace(/^\s*\d+\s*/, '').trim());
}
