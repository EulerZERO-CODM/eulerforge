/**
 * Thirty-layer responsiveness, measured in a real browser.
 *
 * Phase 2's exit criterion says editing a thirty-layer document stays responsive. To check that
 * claim, this spec:
 *
 * 1. opens a **real thirty-layer document** — ten placed catalogue records with their licence
 *    records, ten wrapping text layers and ten shapes — built by the editor's own commands
 *    (`src/testing/thirty-layers.ts`) and proves the browser really painted it;
 * 2. drives **real interactions** through the production build: selecting one layer and a group,
 *    dragging a layer and a three-layer selection, resizing from a handle, committing inspector
 *    values, changing opacity from the keyboard, hiding and locking a layer, and undo/redo;
 * 3. measures the two things a person actually feels — how long the result took to appear after the
 *    input, and how evenly the frames kept coming during a drag — after a warm-up pass, in a
 *    **controlled CPU-slowdown phase** that the budget is checked against, and again unthrottled for
 *    context.
 *
 * The budget below was written before the first measurement and is not adjusted to fit results: a
 * benchmark whose threshold moves with the numbers proves nothing. Method, thresholds, measured
 * results, the proxy's limitations and how to read the report are in docs/PERFORMANCE.md.
 *
 * One scenario failing does not abort the run. Every scenario is measured inside its own guard, a
 * broken selector records a failure row and the benchmark carries on with the next scenario, and the
 * report is written to disk after every row — so a red run still publishes the evidence, and the
 * reason for the red run is in the check-run annotation.
 */

import { cpus } from 'node:os';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { CURRENT_SCHEMA_VERSION, migrateDocument } from '../src/core/documents/migrations';
import { hitTestScene } from '../src/core/documents/scene-geometry';
import type { Scene } from '../src/core/documents/layer-types';
import {
  THIRTY_LAYER_COUNTS,
  THIRTY_LAYER_DOCUMENT_ID,
  THIRTY_LAYER_TOTAL,
  thirtyLayerDocument,
} from '../src/testing/thirty-layers';
import { STORAGE_KEY, layerButton, pointInDocument } from './fixtures';
import {
  PerfReport,
  describeDistribution,
  installPerfRecorder,
  measureFrames,
  measureInteraction,
  percentile,
  resetPerfRecorder,
  takeObserved,
  throttleCpu,
  type FrameStats,
  type InteractionSample,
} from './perf';
import { countColours, readInkBands } from './pixels';

/**
 * The document every measurement runs on. Deterministic: the builder is fixed, so two runs describe
 * the same picture and the numbers are comparable between runs.
 */
const DOCUMENT = thirtyLayerDocument();
const ENVELOPE = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  savedAt: '2026-03-01T09:00:00.000Z',
  documents: [DOCUMENT],
};

/**
 * The acceptance budget — decided before the first measurement, and never widened afterwards.
 *
 * - **200 ms p95 / 500 ms worst** for a discrete interaction. A healthy interaction in a thirty-layer
 *   document is a few milliseconds of work; at a four-fold CPU slowdown that is still an order of
 *   magnitude inside the budget, so anything that trips it is a real regression rather than noise.
 *   (For scale: Web Vitals calls 200 ms a *good* response on unmodified hardware.)
 * - **100 ms p95 / 400 ms worst** between frames during a drag, and at most a fifth of frames slower
 *   than 50 ms. A drag that paints every 100 ms is visibly jerky; 16 ms would be a false precision at
 *   a 4x slowdown.
 * - **600 ms** for the longest single main-thread block in a phase. That is where "slow" becomes
 *   "frozen", and it is the one number that must not be traded away.
 *
 * A future maintainer should only ever *tighten* these with evidence from a run that passed: a
 * failure here is a finding about the product, and widening the budget to make it green would delete
 * the only thing the benchmark exists to say.
 */
const BUDGET = {
  interactionP95: 200,
  interactionWorst: 500,
  frameP95: 100,
  frameWorst: 400,
  frameOver50Share: 0.2,
  longTaskWorst: 600,
} as const;

/** Controlled slowdown for the gated phase: see docs/PERFORMANCE.md for what it does and does not prove. */
const THROTTLE_RATE = 4;

/** Samples per scenario in each phase, after one unrecorded warm-up pass. */
const SAMPLES = {
  throttled: { interaction: 12, frames: 5 },
  unthrottled: { interaction: 6, frames: 3 },
} as const;

/**
 * Bound on a single Playwright action in this spec.
 *
 * The suite default is "wait forever", which once turned one wrong selector into a seven-minute
 * timeout. Twenty seconds is far longer than any of these interactions take (the budget allows
 * 500 ms) but short enough that a broken selector fails the scenario, is reported, and lets the rest
 * of the benchmark run.
 */
const ACTION_TIMEOUT = 20_000;

/** Bounded, but long enough for a populated benchmark: two phases over eleven scenarios. */
const TEST_TIMEOUT = 10 * 60_000;

type Outcome = InteractionSample | FrameStats;

type Scenario = {
  readonly name: string;
  readonly how: string;
  readonly metric: 'interaction' | 'frames';
  /** Puts the document and the selection into the state this measurement needs. Idempotent. */
  readonly prepare: (page: Page) => Promise<void>;
  /** Performs the interaction and returns what the recorder measured. */
  readonly run: (page: Page, sample: number) => Promise<Outcome>;
};

/* ------------------------------------------------------------------ locators, scoped to the UI */

/**
 * The history panel's own Undo and Redo buttons.
 *
 * Scoped deliberately: the toolbar carries the same two operations labelled with their keyboard
 * shortcut ("Undo (Cmd/Ctrl + Z)"), so an unscoped lookup is ambiguous and an exact-name lookup can
 * silently match nothing. The panel is the one surface that is unambiguously about history.
 */
function historyButton(page: Page, label: 'Undo' | 'Redo') {
  return page
    .locator('section[aria-labelledby="history-panel-heading"]')
    .getByRole('button', { name: label, exact: true });
}

/** The row toggle for a layer, whatever state it is in: Hide when visible, Show when hidden. */
function rowToggle(page: Page, name: string, kind: 'Hide' | 'Show' | 'Lock' | 'Unlock') {
  return page.getByRole('button', { name: `${kind} \u201c${name}\u201d`, exact: true });
}

/**
 * Leaves a layer visible or hidden.
 *
 * The state is read first and the click is skipped when it is already right, so a scenario can be
 * prepared any number of times without accumulating edits.
 */
async function setVisibility(page: Page, name: string, visible: boolean): Promise<void> {
  const visibleToggle = rowToggle(page, name, 'Hide');
  const hiddenToggle = rowToggle(page, name, 'Show');
  const alreadyVisible = (await visibleToggle.count()) > 0;
  if (alreadyVisible === visible) return;
  await (visible ? hiddenToggle : visibleToggle).click();
  await expect(visible ? visibleToggle : hiddenToggle).toBeVisible();
}

/** Leaves a layer locked or unlocked, clicking only when it is not already in that state. */
async function setLocked(page: Page, name: string, locked: boolean): Promise<void> {
  const lockedToggle = rowToggle(page, name, 'Unlock');
  const unlockedToggle = rowToggle(page, name, 'Lock');
  const alreadyLocked = (await lockedToggle.count()) > 0;
  if (alreadyLocked === locked) return;
  await (locked ? unlockedToggle : lockedToggle).click();
  await expect(locked ? lockedToggle : unlockedToggle).toBeVisible();
}

/**
 * The inspector that describes the current selection.
 *
 * Scoped on purpose. "Layer name" is a label the workspace uses for the name field of *each* layer
 * being edited, and this benchmark's document holds ten text layers, so a document-wide lookup by
 * that label is ambiguous by construction — it says nothing about which selection the page is in.
 * The selection inspector is the one surface that states the selection in its own heading
 * ("Selected layer" for one layer, "Selected layers (n)" for a group).
 */
function selectionInspector(page: Page) {
  return page.locator('section[aria-labelledby="inspector-selection"]');
}

/**
 * What the selection surfaces look like right now, carried by a preparation failure.
 *
 * A rejected preparation step has to explain itself, and the check-run annotation that publishes a
 * failure is truncated: this is one short, decisive line rather than a dump. It answers the questions
 * that separate the possible causes — did the list still hold every row (`rows`), did *any* row become
 * the current one (`selectedRows`) and which (`selected`), what does the selection inspector say it is
 * editing (`heading`), and how many name fields with which values exist in the whole document
 * (`nameFields`, `values`). It goes *first* in the error message so truncation cannot remove it.
 */
async function describeSelection(page: Page): Promise<string> {
  return page.evaluate(() => {
    const labelOf = (element: Element): string => {
      const referenced = element.getAttribute('aria-labelledby');
      if (referenced) {
        return referenced
          .split(/\s+/)
          .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
          .join(' ');
      }
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;
      const labelled = (element as HTMLInputElement).labels;
      return labelled ? [...labelled].map((label) => label.textContent).join(' ') : '';
    };
    const named = [...document.querySelectorAll('input, textarea, select, button')].filter(
      (element) => /layer name/i.test(labelOf(element)),
    );
    const current = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid^="layer-name-"][aria-current="true"]',
      ),
    ];
    const text = (element: HTMLElement): string => element.textContent.trim().slice(0, 40);
    return [
      `rows=${String(document.querySelectorAll('[data-testid^="layer-row-"]').length)}`,
      `selectedRows=${String(current.length)}`,
      `selected=${JSON.stringify(current.slice(0, 3).map(text))}`,
      `inspectors=${String(document.querySelectorAll('section[aria-labelledby="inspector-selection"]').length)}`,
      `heading=${JSON.stringify((document.getElementById('inspector-selection')?.textContent ?? '(none)').slice(0, 40))}`,
      `nameFields=${String(named.length)}`,
      `values=${JSON.stringify(named.slice(0, 3).map((element) => (element as HTMLInputElement).value))}`,
    ].join(' ');
  });
}

/**
 * Names whose selection needed the pointer fallback, so the report can say so instead of hiding it.
 * A preparation detail is worth publishing: if the keyboard path stops working, that is a finding.
 */
const pointerFallback = new Set<string>();

/**
 * Whether this row became the current row within a second, resolved in the page.
 *
 * The attribute appears when React has committed the selection, which is a microtask after the click
 * the Enter key produced — not necessarily before the next round trip from the test. Observing the
 * attribute instead of reading it once keeps a fast activation from triggering the fallback by timing
 * alone, while a button that was never activated still falls through in a second rather than in the
 * twenty-second action timeout.
 */
function activates(row: Locator, timeout = 1_000): Promise<boolean> {
  return row.evaluate(
    (element, limit) =>
      element.getAttribute('aria-current') === 'true'
        ? true
        : new Promise<boolean>((resolve) => {
            const observer = new MutationObserver(() => {
              if (element.getAttribute('aria-current') !== 'true') return;
              observer.disconnect();
              resolve(true);
            });
            observer.observe(element, { attributes: true, attributeFilter: ['aria-current'] });
            window.setTimeout(() => {
              observer.disconnect();
              resolve(element.getAttribute('aria-current') === 'true');
            }, limit);
          }),
    timeout,
  );
}

/**
 * Prepares the measured interaction: leaves one named layer selected, or fails loudly.
 *
 * Two activation paths, both real: the list's own keyboard path (focus the row, press Enter — its
 * native button activation) and, when that does not take, the pointer click every other spec in this
 * suite uses. The keyboard path is tried first because it has no coordinates to land on, so it cannot
 * click a neighbouring row while the list is still settling; the pointer path is the fallback because
 * a window that lost focus mid-run leaves Enter with nothing to activate, and a preparation step that
 * silently kept the *previous* selection would make every later assertion describe the wrong layer.
 * Whichever path actually ran is recorded and published by the report — and neither of them is the
 * measurement, which happens inside the scenario with real pointer input.
 *
 * Every step then asserts a stated quantity rather than relying on a locator being unique by luck: the
 * row has to exist once, it has to be the selected row, the workspace has to render exactly one
 * selection inspector, and that inspector has to hold exactly one name field showing the named layer.
 * A failure here is a *test* failure, never a budget failure, and the page's own account of the
 * selection (see `describeSelection`) comes first in the message so truncation cannot hide it.
 */
async function selectOnlyLayer(page: Page, name: string): Promise<void> {
  try {
    const row = layerButton(page, name);
    await expect(row, `the layer list should hold exactly one row for “${name}”`).toHaveCount(1, {
      timeout: ACTION_TIMEOUT,
    });
    await row.scrollIntoViewIfNeeded();
    await row.focus();
    await page.keyboard.press('Enter');
    if (!(await activates(row))) {
      pointerFallback.add(name);
      await row.click();
    }
    await expect(row, `“${name}” should be the selected row`).toHaveAttribute(
      'aria-current',
      'true',
      { timeout: ACTION_TIMEOUT },
    );

    const inspector = selectionInspector(page);
    await expect(
      inspector,
      'the workspace should render exactly one selection inspector',
    ).toHaveCount(1);
    const nameField = inspector.getByLabel('Layer name', { exact: true });
    await expect(
      nameField,
      'the selection inspector should hold exactly one name field',
    ).toHaveCount(1);
    await expect(nameField, `the selection inspector should be editing “${name}”`).toHaveValue(
      name,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Diagnostics first: the annotation that publishes this failure is truncated from the end.
    throw new Error(`selection state: ${await describeSelection(page)} — ${reason}`);
  }
}

/** Adds a layer to the selection with the modifier click the list supports. */
async function extendSelection(page: Page, name: string): Promise<void> {
  await layerButton(page, name).click({ modifiers: ['Shift'] });
  await expect(layerButton(page, name)).toHaveAttribute('aria-current', 'true');
}

/* ------------------------------------------------------------------ coordinates from the document */

/**
 * A point inside a layer that the application's own hit test says belongs to that layer.
 *
 * Layers overlap in a thirty-layer document, so "drag the Quote" needs a grab point where the Quote
 * is really on top. Scanning and asking `hitTestScene` — the same function the pointer handler runs —
 * keeps that honest: a miss is reported rather than silently measuring a drag of the wrong layer.
 */
function grabPoint(scene: Scene, name: string): { readonly x: number; readonly y: number } {
  const layer = scene.layers.find((candidate) => candidate.name === name);
  if (!layer) throw new Error(`the fixture has no layer named “${name}”`);
  for (let row = 2; row <= 8; row += 1) {
    for (let column = 2; column <= 8; column += 1) {
      const point = {
        x: layer.frame.x + (layer.frame.width * column) / 10,
        y: layer.frame.y + (layer.frame.height * row) / 10,
      };
      if (hitTestScene(scene, point, { includeLocked: true })?.name === name) return point;
    }
  }
  throw new Error(`no point inside “${name}” hits it: another layer covers it everywhere`);
}

/**
 * The scene as the application itself loads it from storage.
 *
 * The raw record goes through `migrateDocument`, the same parse the repository runs on load, so grab
 * points are computed from the real domain types rather than from a hand-written shape.
 */
async function storedScene(page: Page): Promise<Scene> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  if (raw === null) throw new Error('no document has been stored yet');
  const parsed = JSON.parse(raw) as { readonly documents?: readonly unknown[] };
  const document = parsed.documents?.[0];
  if (!document) throw new Error('the stored envelope holds no document');
  const migrated = migrateDocument(document);
  if (!migrated.ok) throw new Error(`the stored document does not load: ${migrated.error.message}`);
  return migrated.value.scene;
}

/** A stepped pointer drag with the frame loop watching, in document pixels. */
async function dragWithFrames(
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  steps = 24,
): Promise<FrameStats> {
  const start = await pointInDocument(page, from);
  const end = await pointInDocument(page, to);
  return measureFrames(page, async () => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      await page.mouse.move(
        start.x + (end.x - start.x) * progress,
        start.y + (end.y - start.y) * progress,
      );
      // Long enough that the page really repaints between moves, short enough to keep the drag short.
      await page.waitForTimeout(6);
    }
    await page.mouse.up();
  });
}

/** Drags a layer by a document-space delta, grabbing it where it is really on top. */
async function dragLayer(
  page: Page,
  name: string,
  delta: { readonly x: number; readonly y: number },
): Promise<FrameStats> {
  const from = grabPoint(await storedScene(page), name);
  return dragWithFrames(page, from, { x: from.x + delta.x, y: from.y + delta.y });
}

/** The number a field currently shows, so a scenario can alternate around the real value. */
async function fieldValue(page: Page, label: string): Promise<number> {
  return Number(await page.getByLabel(label, { exact: true }).inputValue());
}

/* ------------------------------------------------------------------ the scenarios */

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'select-layer',
    how: 'click a layer in the layer list',
    metric: 'interaction',
    prepare: async () => {},
    run: async (page, sample) => {
      const names = (await storedScene(page)).layers.map((layer) => layer.name);
      const name = names[(sample * 3 + 1) % names.length] ?? 'Headline';
      return measureInteraction(page, 'select-layer', ['click'], async () => {
        await layerButton(page, name).click();
      });
    },
  },
  {
    name: 'select-group',
    how: 'shift-click a second layer into the selection',
    metric: 'interaction',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Headline');
    },
    run: async (page) => {
      return measureInteraction(page, 'select-group', ['click'], async () => {
        await extendSelection(page, 'Plate A');
      });
    },
  },
  {
    name: 'hide-layer',
    how: 'click Hide on a layer row',
    metric: 'interaction',
    prepare: async (page) => {
      await setVisibility(page, 'Dateline', true);
    },
    run: async (page) => {
      const measured = await measureInteraction(page, 'hide-layer', ['click'], async () => {
        await rowToggle(page, 'Dateline', 'Hide').click();
      });
      await setVisibility(page, 'Dateline', true);
      return measured;
    },
  },
  {
    name: 'lock-layer',
    how: 'click Lock on a layer row',
    metric: 'interaction',
    prepare: async (page) => {
      await setLocked(page, 'Footer stamp', false);
    },
    run: async (page) => {
      const measured = await measureInteraction(page, 'lock-layer', ['click'], async () => {
        await rowToggle(page, 'Footer stamp', 'Lock').click();
      });
      await setLocked(page, 'Footer stamp', false);
      return measured;
    },
  },
  {
    name: 'inspector-x',
    how: 'commit a new X in the inspector with Enter',
    metric: 'interaction',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Headline');
    },
    run: async (page, sample) => {
      const current = await fieldValue(page, 'Layer X');
      const field = page.getByLabel('Layer X', { exact: true });
      await field.fill(String(Math.round(sample % 2 === 0 ? current + 12 : current - 12)));
      return measureInteraction(page, 'inspector-x', ['keydown'], async () => {
        await field.press('Enter');
      });
    },
  },
  {
    name: 'inspector-width',
    how: 'commit a new width in the inspector with Enter',
    metric: 'interaction',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Intro copy');
    },
    run: async (page, sample) => {
      const current = await fieldValue(page, 'Layer width');
      const field = page.getByLabel('Layer width', { exact: true });
      await field.fill(String(Math.round(sample % 2 === 0 ? current + 20 : current - 20)));
      return measureInteraction(page, 'inspector-width', ['keydown'], async () => {
        await field.press('Enter');
      });
    },
  },
  {
    name: 'opacity-key',
    how: 'press an arrow key on the opacity slider',
    metric: 'interaction',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Accent dot');
      await page.getByLabel('Layer opacity').focus();
    },
    run: async (page, sample) => {
      const key = sample % 2 === 0 ? 'ArrowLeft' : 'ArrowRight';
      return measureInteraction(page, 'opacity-key', ['keydown'], async () => {
        await page.keyboard.press(key);
      });
    },
  },
  {
    name: 'undo',
    how: 'undo an edit from the history panel',
    metric: 'interaction',
    prepare: async (page) => {
      await setVisibility(page, 'Footer note', true);
    },
    run: async (page) => {
      // A real edit first, so there is something to step back to; then the measured step back.
      await rowToggle(page, 'Footer note', 'Hide').click();
      await expect(historyButton(page, 'Undo')).toBeEnabled();
      const measured = await measureInteraction(page, 'undo', ['click'], async () => {
        await historyButton(page, 'Undo').click();
      });
      // Put the document back into the state the undo produced, whichever way it ended up.
      await setVisibility(page, 'Footer note', false);
      return measured;
    },
  },
  {
    name: 'redo',
    how: 'redo an edit from the history panel',
    metric: 'interaction',
    prepare: async (page) => {
      await setVisibility(page, 'Quote', true);
    },
    run: async (page) => {
      await rowToggle(page, 'Quote', 'Hide').click();
      await historyButton(page, 'Undo').click();
      await expect(historyButton(page, 'Redo')).toBeEnabled();
      const measured = await measureInteraction(page, 'redo', ['click'], async () => {
        await historyButton(page, 'Redo').click();
      });
      await setVisibility(page, 'Quote', true);
      return measured;
    },
  },
  {
    name: 'drag-layer',
    how: 'drag one text layer across the canvas',
    metric: 'frames',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Quote');
    },
    run: async (page, sample) => {
      const direction = sample % 2 === 0 ? 1 : -1;
      return dragLayer(page, 'Quote', { x: 40 * direction, y: 30 * direction });
    },
  },
  {
    name: 'drag-group',
    how: 'drag a three-layer selection',
    metric: 'frames',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Intro copy');
      await extendSelection(page, 'Offer line');
      await extendSelection(page, 'Notes');
    },
    run: async (page, sample) => {
      const direction = sample % 2 === 0 ? 1 : -1;
      const from = grabPoint(await storedScene(page), 'Intro copy');
      return dragWithFrames(page, from, {
        x: from.x + 30 * direction,
        y: from.y + 20 * direction,
      });
    },
  },
  {
    name: 'resize-handle',
    how: 'drag the bottom-right handle to resize a layer',
    metric: 'frames',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Content card');
    },
    run: async (page, sample) => {
      const handle = page.getByRole('button', { name: 'Resize bottom right' });
      const box = await handle.boundingBox();
      if (!box) throw new Error('the bottom-right handle has no box');
      const direction = sample % 2 === 0 ? 1 : -1;
      return measureFrames(page, async () => {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        for (let step = 1; step <= 18; step += 1) {
          await page.mouse.move(
            box.x + box.width / 2 + step * 3 * direction,
            box.y + box.height / 2 + step * 2 * direction,
          );
          await page.waitForTimeout(6);
        }
        await page.mouse.up();
      });
    },
  },
];

/* ------------------------------------------------------------------ opening the fixture */

/** Seeds the fixture into local storage before the application boots, then opens its workspace. */
async function openFixture(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, envelope }) => {
      // Only when nothing is stored: a later navigation must keep whatever the application saved.
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, JSON.stringify(envelope));
      }
    },
    { key: STORAGE_KEY, envelope: ENVELOPE },
  );
  await page.goto(`/workspace/${THIRTY_LAYER_DOCUMENT_ID}`);
  await expect(page.getByTestId('artboard')).toBeVisible();
  await expect(page.locator('[data-testid^="layer-row-"]')).toHaveCount(THIRTY_LAYER_TOTAL);
  /* Every placed graphic finished decoding *and* none of them failed. The stage shows one note for
     both cases ("Graphics are still loading" / "A graphic could not be loaded"), and asserting on
     both is what stops the benchmark from quietly measuring a canvas with ten missing images. */
  await expect(
    page.getByText(/Graphics are still loading|A graphic could not be loaded/),
  ).toHaveCount(0, { timeout: 30_000 });
}

/* ------------------------------------------------------------------ running the benchmark */

type PhaseName = 'throttled' | 'unthrottled';

/**
 * Runs every scenario once, unrecorded.
 *
 * The first pass in each phase pays for caches, decoded graphics and JIT; measuring it would report
 * cold-start costs as if they were steady-state behaviour.
 */
async function warmUp(page: Page): Promise<void> {
  for (const scenario of SCENARIOS) {
    try {
      await scenario.prepare(page);
      await scenario.run(page, 0);
    } catch {
      // A broken scenario is reported by the measured pass; the warm-up carries on regardless.
    }
  }
}

async function runPhase(
  page: Page,
  phase: PhaseName,
  report: PerfReport,
  broken: Set<string>,
): Promise<void> {
  const throttled = phase === 'throttled';
  const counts = SAMPLES[phase];
  await throttleCpu(page, throttled ? THROTTLE_RATE : 1);
  await resetPerfRecorder(page);
  await warmUp(page);
  await resetPerfRecorder(page);

  try {
    for (const scenario of SCENARIOS) {
      if (broken.has(scenario.name)) continue;

      const interactions: number[] = [];
      const gaps: number[] = [];
      const drags: number[] = [];
      let scenarioError: string | null = null;

      for (
        let sample = 0;
        sample < (scenario.metric === 'interaction' ? counts.interaction : counts.frames);
        sample += 1
      ) {
        try {
          await scenario.prepare(page);
          const outcome = await scenario.run(page, sample);
          if ('ms' in outcome) interactions.push(outcome.ms);
          else {
            gaps.push(...outcome.gaps);
            drags.push(outcome.p95);
          }
        } catch (error) {
          // A scenario that cannot complete is reported and abandoned: its remaining samples would
          // only repeat the same failure, and the rest of the benchmark still has to run.
          scenarioError = error instanceof Error ? error.message : String(error);
          await resetPerfRecorder(page);
          break;
        }
      }

      const observed = await takeObserved(page);
      const longTasks = observed.filter((entry) => entry.kind === 'longtask');
      const slowEvents = observed.filter((entry) => entry.kind === 'slow-event');
      const worst = (values: readonly number[]): number =>
        values.length === 0 ? 0 : Math.max(...values);
      const observedText = `long tasks ${String(longTasks.length)} (worst ${worst(longTasks.map((entry) => entry.duration)).toFixed(0)} ms), input events over 16 ms ${String(slowEvents.length)} (worst ${worst(slowEvents.map((entry) => entry.duration)).toFixed(0)} ms)`;
      const longTaskWorst = worst(longTasks.map((entry) => entry.duration));

      if (scenarioError !== null) {
        broken.add(scenario.name);
        report.fail(scenario.name, phase, scenarioError);
        continue;
      }

      if (scenario.metric === 'interaction') {
        const p95 = percentile(interactions, 0.95);
        const slowest = worst(interactions);
        const short = interactions.length < counts.interaction;
        const missed =
          throttled && (short || p95 > BUDGET.interactionP95 || slowest > BUDGET.interactionWorst);
        report.add({
          scenario: scenario.name,
          how: scenario.how,
          phase,
          samples: interactions.length,
          p50: percentile(interactions, 0.5),
          p95,
          worst: slowest,
          observed: observedText,
          budget: throttled
            ? `p95 ${String(BUDGET.interactionP95)} ms / worst ${String(BUDGET.interactionWorst)} ms`
            : 'reported only',
          verdict: missed ? 'fail' : throttled ? 'pass' : 'reported',
        });
        if (missed) {
          report.note(
            `${phase} ${scenario.name}: ${describeDistribution(interactions)}${short ? ` (only ${String(interactions.length)} of ${String(counts.interaction)} samples landed)` : ''}. Samples: [${interactions
              .map((value) => value.toFixed(1))
              .join(', ')}] ms.`,
          );
        }
        continue;
      }

      const slowShare = gaps.length === 0 ? 0 : gaps.filter((gap) => gap > 50).length / gaps.length;
      const p95 = percentile(gaps, 0.95);
      const slowest = worst(gaps);
      const missed =
        throttled &&
        (gaps.length === 0 ||
          p95 > BUDGET.frameP95 ||
          slowest > BUDGET.frameWorst ||
          slowShare > BUDGET.frameOver50Share);
      const frozen = throttled && longTaskWorst > BUDGET.longTaskWorst;
      report.add({
        scenario: scenario.name,
        how: `${scenario.how} (${String(gaps.length)} frame gaps over ${String(drags.length)} drags)`,
        phase,
        samples: drags.length,
        p50: percentile(gaps, 0.5),
        p95,
        worst: slowest,
        observed: `${observedText}, ${(slowShare * 100).toFixed(0)}% of gaps over 50 ms`,
        budget: throttled
          ? `p95 ${String(BUDGET.frameP95)} ms / worst ${String(BUDGET.frameWorst)} ms, ≤ ${String(BUDGET.frameOver50Share * 100)}% over 50 ms`
          : 'reported only',
        verdict: missed || frozen ? 'fail' : throttled ? 'pass' : 'reported',
      });
      if (missed) {
        report.note(
          `${phase} ${scenario.name}: frame gaps ${describeDistribution(gaps)} with ${(slowShare * 100).toFixed(0)}% over 50 ms.`,
        );
      }
      if (frozen) {
        report.note(
          `${phase} ${scenario.name}: the longest main-thread block was ${longTaskWorst.toFixed(0)} ms, over the ${String(BUDGET.longTaskWorst)} ms budget.`,
        );
      }
    }
  } finally {
    // Back to full speed before anything else runs in this browser.
    await throttleCpu(page, 1);
  }
}

/**
 * What the numbers were measured on.
 *
 * The report has to carry this: a timing without the machine it came from cannot be compared with
 * anything, and the caveat in docs/PERFORMANCE.md only makes sense next to these facts.
 */
function environment(): {
  readonly runtime: string;
  readonly browser: string;
  readonly cpu: string;
  readonly commit: string;
} {
  const cores = cpus();
  return {
    runtime: `Node ${process.version} on ${process.platform} ${process.arch}`,
    browser: 'Chromium (Playwright)',
    cpu: `${String(cores.length)} vCPU — ${cores[0]?.model ?? 'unknown model'}`,
    // CI sets the head SHA for this job: on a pull request the checkout is a merge commit, and a
    // report naming the merge commit would not say which branch state was measured.
    commit: process.env.GITHUB_HEAD_SHA ?? process.env.GITHUB_SHA ?? 'local',
  };
}

test.describe('a thirty-layer document in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    // Bounded per action: a wrong selector must fail one scenario in seconds, not eat the test.
    page.setDefaultTimeout(ACTION_TIMEOUT);
    await installPerfRecorder(page);
  });

  test('paints thirty real layers, artwork included', async ({ page }) => {
    await openFixture(page);

    const layers = DOCUMENT.scene.layers;
    expect(layers).toHaveLength(THIRTY_LAYER_TOTAL);
    const counts: Record<string, number> = {};
    for (const layer of layers) counts[layer.type] = (counts[layer.type] ?? 0) + 1;
    expect(counts).toEqual({ ...THIRTY_LAYER_COUNTS });
    // The placed catalogue records carry their licences, and the browser loaded all ten of them.
    expect(DOCUMENT.attribution).toHaveLength(THIRTY_LAYER_COUNTS.image);
    await expect(
      page.getByRole('img', { name: new RegExp(`${String(THIRTY_LAYER_TOTAL)} layers`) }),
    ).toBeVisible();

    // The headline is really painted, at the coordinates the document puts it at.
    const headline = await readInkBands(page, { x: 120, y: 38, width: 900, height: 72 });
    expect(headline.bands.length, 'the headline should be painted').toBeGreaterThan(0);

    /* And the placed artwork is painted, not merely listed: measured against a flat shape of the same
       document. The plate under the first graphic is one flat colour, while the graphic draws
       antialiased strokes over it, so "many more colours inside the graphic's frame than inside the
       flat plate" is a statement about pixels rather than about the layer list. */
    const flat = await countColours(page, { x: 84, y: 200, width: 12, height: 200 });
    expect(flat.dominantShare, `the plate should be one flat colour: ${JSON.stringify(flat)}`).toBe(
      1,
    );
    const artwork = await countColours(page, { x: 120, y: 205, width: 210, height: 70 });
    expect(
      artwork.distinct,
      `the placed graphic should carry real detail: ${JSON.stringify(artwork)}`,
    ).toBeGreaterThan(flat.distinct * 8);
  });

  test('stays inside the recorded budget while editing', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);
    await openFixture(page);

    const report = new PerfReport('Thirty-layer responsiveness (production build, in Chromium)', {
      ...environment(),
      browser: `Chromium ${page.context().browser()?.version() ?? 'unknown'} (Playwright)`,
    });
    report.note(
      `Gated phase: CDP \`Emulation.setCPUThrottlingRate: ${String(THROTTLE_RATE)}\`, ${String(SAMPLES.throttled.interaction)} interaction samples and ${String(SAMPLES.throttled.frames)} drag samples per scenario, after one unrecorded warm-up pass.`,
    );
    report.note(
      `Reported phase: the same scenarios at full speed (${String(SAMPLES.unthrottled.interaction)} / ${String(SAMPLES.unthrottled.frames)} samples). GitHub runners vary, so this phase is context rather than a gate; docs/PERFORMANCE.md says why.`,
    );
    report.note(
      "Latency is measured in the page: from the input event's own timestamp to the second animation frame after it. Frame gaps are the intervals between animation frames while the pointer moves.",
    );

    const broken = new Set<string>();
    try {
      await runPhase(page, 'throttled', report, broken);
      await runPhase(page, 'unthrottled', report, broken);
    } finally {
      // A preparation that needed the pointer fallback is published rather than hidden: it says which
      // activation path the harness actually used, and a change there is a finding about the list.
      if (pointerFallback.size > 0) {
        report.note(
          `The keyboard selection path did not take for ${[...pointerFallback].join(', ')}; those preparations used the pointer path instead.`,
        );
      }
      // Left in the log for anyone reading the run, and written to test-results/perf-report.md for the
      // CI job that publishes it onto the pull request. Written even when a phase threw, because the
      // numbers already collected are the evidence.
      report.write();
      process.stdout.write(`\n${report.markdown()}\n`);
    }

    expect(report.failureLines(), `\n${report.markdown()}`).toEqual([]);
  });
});
