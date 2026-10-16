/**
 * Thirty-layer responsiveness, measured in a real browser.
 *
 * Phase 2's exit criteria include "editing a thirty-layer document stays responsive on a mid-range
 * laptop". GitHub's runners are not that laptop, and a benchmark whose result depends on whatever
 * machine happens to run it proves nothing, so this spec does three things:
 *
 * 1. It builds a **real thirty-layer document** — ten placed catalogue graphics with their
 *    attribution records, ten text layers that wrap, ten shapes — through the *real editor commands*,
 *    and proves the browser really painted it (layer rows, decoded graphics, ink on the canvas).
 * 2. It drives **real interactions** through the production build: selecting, dragging one layer and
 *    a multi-layer selection, resizing through a handle, typing in the inspector, changing opacity,
 *    hiding and locking, and undo/redo.
 * 3. It measures what a person would feel — the time from the input event to the frame that shows the
 *    result, and the gaps between animation frames while dragging — after a warm-up pass, and checks
 *    every scenario against a budget that was written down before the numbers were looked at.
 *
 * The throttled phase is the one the budget is checked against: the renderer is slowed by a
 * documented factor, so the measurement is dominated by the application's own work rather than by how
 * fast the host happens to be. The unthrottled phase is reported for context. Method, thresholds,
 * measured results and what the proxy cannot stand in for are in docs/PERFORMANCE.md.
 */

import { expect, test, type Page } from '@playwright/test';

import { CURRENT_SCHEMA_VERSION, migrateDocument } from '../src/core/documents/migrations';
import { hitTestScene } from '../src/core/documents/scene-geometry';
import type { Scene } from '../src/core/documents/layer-types';
import type { ForgeDocument } from '../src/core/documents/types';
import { thirtyLayerDocument } from '../src/testing/thirty-layers';
import { STORAGE_KEY, layerButton, pointInDocument } from './fixtures';
import {
  PerfReport,
  describe,
  installPerfRecorder,
  measureFrames,
  measureInteraction,
  percentile,
  resetPerf,
  takeLongTasks,
  takeSlowEvents,
  throttleCpu,
  type FrameStats,
  type InteractionSample,
} from './perf';
import { readInkBands } from './pixels';

/**
 * The document every measurement in this file runs on. Built once: the builder is deterministic, so
 * the numbers describe the same picture on every run.
 */
const DOCUMENT: ForgeDocument = thirtyLayerDocument();
const ENVELOPE = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  savedAt: '2026-02-01T12:00:00.000Z',
  documents: [DOCUMENT],
};

/**
 * The acceptance budget, decided before the first measurement and never widened afterwards.
 *
 * - **250ms p95 / 600ms worst** for a discrete interaction. Web Vitals calls 200ms a *good* response
 *   on a normal machine; a renderer slowed several times over should still finish a discrete edit
 *   inside a quarter of a second, and one unlucky frame is allowed to reach 600ms.
 * - **100ms p95 / 400ms worst** for the gap between frames during a drag, and no more than a fifth of
 *   frames slower than 50ms: a drag that paints every 100ms is visibly jerky.
 * - **600ms** for the longest single main-thread block, which is what turns "slow" into "frozen".
 *
 * These are deliberately looser than the recorded numbers: the point is to fail on a gross
 * regression, not to encode today's timings. They are constants rather than per-run values so a slow
 * day cannot quietly become the new baseline.
 */
const BUDGET = {
  interactionP95: 250,
  interactionMax: 600,
  frameP95: 100,
  frameMax: 400,
  frameSlowShare: 0.2,
  longTaskMax: 600,
} as const;

/** How many times each scenario is repeated in a phase, after a warm-up pass. */
const THROTTLED_SAMPLES = 6;
const UNTHROTTLED_SAMPLES = 3;

/**
 * The CPU multiplier used for the gated phase.
 *
 * The criterion names a mid-range laptop, which is slower than a hosted runner and faster than a
 * phone. A 4x renderer slowdown puts a fast runner in that range and makes the measurement CPU-bound
 * instead of scheduler-bound, which is what keeps runs comparable. It is a proxy, not a laptop:
 * docs/PERFORMANCE.md says exactly what it cannot prove.
 */
const THROTTLE_RATE = 4;

type Outcome = InteractionSample | FrameStats;

type Scenario = {
  readonly name: string;
  readonly metric: 'interaction' | 'frames';
  /** One line for the report, describing the interaction a user performs. */
  readonly how: string;
  /** Puts the document and the selection into the state the measured interaction needs. */
  readonly prepare: (page: Page) => Promise<void>;
  /** The interaction itself. `sample` lets a scenario alternate direction so nothing drifts away. */
  readonly run: (page: Page, sample: number) => Promise<Outcome>;
};

/**
 * A point inside a layer that the application's own hit test says belongs to that layer.
 *
 * Layers overlap in a thirty-layer document, so "drag the Card" needs a grab point where the Card is
 * really on top. Scanning and asking `hitTestScene` keeps that honest: the same function the pointer
 * handler runs decides, and a miss is reported rather than silently measuring the wrong layer.
 */
function grabPoint(scene: Scene, name: string): { readonly x: number; readonly y: number } {
  const layer = scene.layers.find((candidate) => candidate.name === name);
  if (!layer) throw new Error(`no layer named ${name} in the fixture`);
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
      await page.waitForTimeout(6);
    }
    await page.mouse.up();
  });
}

/**
 * The scene as the application itself would load it from storage.
 *
 * The raw record goes through `migrateDocument`, the function the repository runs on load, so grab
 * points are computed with the real domain types and the real parse rather than from a hand-written
 * shape. Everything the spec measures through this has been through the product's own loader.
 */
async function storedScene(page: Page): Promise<Scene> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  if (raw === null) throw new Error('no document has been stored yet');
  const envelope = JSON.parse(raw) as { readonly documents?: readonly unknown[] };
  const migrated = migrateDocument(envelope.documents?.[0]);
  if (!migrated.ok) {
    throw new Error(`the stored document does not load: ${migrated.error.message}`);
  }
  return migrated.value.scene;
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

/** Selects one layer from the list; the layer list is the keyboard-reachable path to a selection. */
async function selectOnlyLayer(page: Page, name: string): Promise<void> {
  await layerButton(page, name).click();
  await expect(page.getByLabel('Layer name')).toHaveValue(name);
}

/** Adds a layer to the selection with the modifier click the list supports. */
async function extendSelection(page: Page, name: string): Promise<void> {
  await layerButton(page, name).click({ modifiers: ['Shift'] });
}

/** The number a field currently shows, so a scenario can alternate around the real value. */
async function fieldValue(page: Page, label: string): Promise<number> {
  return Number(await page.getByLabel(label).inputValue());
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'select-layer',
    metric: 'interaction',
    how: 'click a layer in the layer list',
    prepare: async () => {},
    run: async (page, sample) => {
      const names = (await storedScene(page)).layers.map((layer) => layer.name);
      // A different layer every sample, so the cost of rebuilding the inspector is always included.
      const name = names[(sample * 3 + 1) % names.length] ?? 'Headline';
      return measureInteraction(page, { name: 'select-layer', kinds: ['click'] }, async () => {
        await layerButton(page, name).click();
      });
    },
  },
  {
    name: 'select-group',
    metric: 'interaction',
    how: 'shift-click to add a second layer to the selection',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Headline');
    },
    run: async (page) => {
      return measureInteraction(page, { name: 'select-group', kinds: ['click'] }, async () => {
        await extendSelection(page, 'Card');
      });
    },
  },
  {
    name: 'hide-layer',
    metric: 'interaction',
    how: 'click Hide on a layer, then Show to put it back',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Headline');
    },
    run: async (page) => {
      const sample = await measureInteraction(
        page,
        { name: 'hide-layer', kinds: ['click'] },
        async () => {
          await page.getByRole('button', { name: 'Hide “Headline”' }).click();
        },
      );
      await page.getByRole('button', { name: 'Show “Headline”' }).click();
      return sample;
    },
  },
  {
    name: 'lock-layer',
    metric: 'interaction',
    how: 'click Lock on a layer, then Unlock',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Panel');
    },
    run: async (page) => {
      const sample = await measureInteraction(
        page,
        { name: 'lock-layer', kinds: ['click'] },
        async () => {
          await page.getByRole('button', { name: 'Lock “Panel”' }).click();
        },
      );
      await page.getByRole('button', { name: 'Unlock “Panel”' }).click();
      return sample;
    },
  },
  {
    name: 'inspector-x',
    metric: 'interaction',
    how: 'type a new X into the inspector and press Enter',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Quote');
    },
    run: async (page, sample) => {
      const current = await fieldValue(page, 'Layer X');
      const next = Math.round(sample % 2 === 0 ? current + 12 : current - 12);
      const field = page.getByLabel('Layer X');
      await field.fill(String(next));
      return measureInteraction(page, { name: 'inspector-x', kinds: ['keydown'] }, async () => {
        await field.press('Enter');
      });
    },
  },
  {
    name: 'inspector-width',
    metric: 'interaction',
    how: 'type a new width into the inspector and press Enter',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Intro copy');
    },
    run: async (page, sample) => {
      const current = await fieldValue(page, 'Layer width');
      const next = Math.round(sample % 2 === 0 ? current + 20 : current - 20);
      const field = page.getByLabel('Layer width');
      await field.fill(String(next));
      return measureInteraction(page, { name: 'inspector-width', kinds: ['keydown'] }, async () => {
        await field.press('Enter');
      });
    },
  },
  {
    name: 'opacity-key',
    metric: 'interaction',
    how: 'press an arrow key on the opacity slider',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Halo');
      await page.getByLabel('Layer opacity').focus();
    },
    run: async (page, sample) => {
      const key = sample % 2 === 0 ? 'ArrowLeft' : 'ArrowRight';
      return measureInteraction(page, { name: 'opacity-key', kinds: ['keydown'] }, async () => {
        await page.keyboard.press(key);
      });
    },
  },
  {
    name: 'undo',
    metric: 'interaction',
    how: 'undo a visibility change from the history panel',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Footer note');
    },
    run: async (page) => {
      // One real edit, then the measured step back.
      await page.getByRole('button', { name: 'Hide “Footer note”' }).click();
      const sample = await measureInteraction(
        page,
        { name: 'undo', kinds: ['click'] },
        async () => {
          await page.getByRole('button', { name: 'Undo', exact: true }).click();
        },
      );
      await page.getByRole('button', { name: 'Show “Footer note”' }).click();
      return sample;
    },
  },
  {
    name: 'redo',
    metric: 'interaction',
    how: 'redo a visibility change from the history panel',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Subhead');
    },
    run: async (page) => {
      await page.getByRole('button', { name: 'Hide “Subhead”' }).click();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      const sample = await measureInteraction(
        page,
        { name: 'redo', kinds: ['click'] },
        async () => {
          await page.getByRole('button', { name: 'Redo', exact: true }).click();
        },
      );
      await page.getByRole('button', { name: 'Show “Subhead”' }).click();
      return sample;
    },
  },
  {
    name: 'zoom-200',
    metric: 'interaction',
    how: 'switch the zoom to 200%, which repaints the document at twice the size',
    prepare: async () => {},
    run: async (page) => {
      const select = page.getByLabel('Zoom level');
      const sample = await measureInteraction(
        page,
        { name: 'zoom-200', kinds: ['change'] },
        async () => {
          await select.selectOption('200');
        },
      );
      await expect(page.getByTestId('zoom-readout')).toHaveText('200%');
      await select.selectOption('fit');
      await expect(page.getByTestId('zoom-readout')).not.toHaveText('200%');
      return sample;
    },
  },
  {
    name: 'drag-layer',
    metric: 'frames',
    how: 'drag one selected layer across the canvas',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Card');
    },
    run: async (page, sample) => {
      const direction = sample % 2 === 0 ? 1 : -1;
      return dragLayer(page, 'Card', { x: 30 * direction, y: 18 * direction });
    },
  },
  {
    name: 'drag-group',
    metric: 'frames',
    how: 'drag a three-layer selection',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Intro copy');
      await extendSelection(page, 'Programme copy');
      await extendSelection(page, 'Quote');
    },
    run: async (page, sample) => {
      const direction = sample % 2 === 0 ? 1 : -1;
      const from = grabPoint(await storedScene(page), 'Quote');
      return dragWithFrames(page, from, {
        x: from.x + 26 * direction,
        y: from.y + 14 * direction,
      });
    },
  },
  {
    name: 'resize-handle',
    metric: 'frames',
    how: 'resize a layer by dragging its bottom-right handle',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Panel');
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
  await page.goto(`/workspace/${DOCUMENT.id}`);
  await expect(page.getByTestId('artboard')).toBeVisible();
  await expect(page.locator('[data-testid^="layer-row-"]')).toHaveCount(
    DOCUMENT.scene.layers.length,
  );
  // Every graphic has been decoded: the stage only shows this note while one is outstanding.
  await expect(page.getByText('Graphics are still loading')).toHaveCount(0, { timeout: 30_000 });
}

/** Runs every scenario `samples` times and writes what was measured into the report. */
async function runPhase(
  page: Page,
  label: string,
  samples: number,
  throttled: boolean,
  report: PerfReport,
  failures: string[],
): Promise<void> {
  await throttleCpu(page, throttled ? THROTTLE_RATE : 1);
  await resetPerf(page);

  // Warm-up: one unrecorded pass, so the first sample is not the cost of caches filling up.
  for (const scenario of SCENARIOS) {
    await scenario.prepare(page);
    await scenario.run(page, 0);
  }
  await resetPerf(page);

  for (const scenario of SCENARIOS) {
    const interactions: number[] = [];
    const gaps: number[] = [];
    const drags: number[] = [];

    for (let sample = 0; sample < samples; sample += 1) {
      await scenario.prepare(page);
      const outcome = await scenario.run(page, sample);
      if ('ms' in outcome) interactions.push(outcome.ms);
      else {
        gaps.push(...outcome.gaps);
        drags.push(outcome.p95);
      }
    }

    const longTasks = await takeLongTasks(page);
    const slowEvents = await takeSlowEvents(page);
    const diagnostics = `long tasks ${String(longTasks.count)} (worst ${longTasks.max.toFixed(0)}ms), input events over 16ms: ${String(slowEvents.count)}`;

    if (scenario.metric === 'interaction') {
      if (interactions.length !== samples) {
        throw new Error(
          `${scenario.name}: ${String(interactions.length)} of ${String(samples)} samples arrived`,
        );
      }
      const p95 = percentile(interactions, 0.95);
      const worst = Math.max(...interactions);
      const failed = throttled && (p95 > BUDGET.interactionP95 || worst > BUDGET.interactionMax);
      report.add({
        scenario: `${label} ${scenario.name}`,
        metric: scenario.how,
        samples: interactions.length,
        p50: percentile(interactions, 0.5),
        p95,
        max: worst,
        note: diagnostics,
        budget: `p95 ${String(BUDGET.interactionP95)} / max ${String(BUDGET.interactionMax)}`,
        verdict: failed ? 'fail' : 'reported',
      });
      if (failed) {
        failures.push(
          `${scenario.name}: ${describe(interactions)} against p95 ${String(BUDGET.interactionP95)}ms / max ${String(BUDGET.interactionMax)}ms`,
        );
      }
      continue;
    }

    const slowShare = gaps.length === 0 ? 0 : gaps.filter((gap) => gap > 50).length / gaps.length;
    const p95 = percentile(gaps, 0.95);
    const worst = gaps.length === 0 ? 0 : Math.max(...gaps);
    const failed =
      throttled &&
      (gaps.length === 0 ||
        p95 > BUDGET.frameP95 ||
        worst > BUDGET.frameMax ||
        slowShare > BUDGET.frameSlowShare);
    report.add({
      scenario: `${label} ${scenario.name}`,
      metric: `${scenario.how} (${String(gaps.length)} frame gaps over ${String(samples)} drags, ${(slowShare * 100).toFixed(0)}% over 50ms)`,
      samples: drags.length,
      p50: percentile(gaps, 0.5),
      p95,
      max: worst,
      note: diagnostics,
      budget: `p95 ${String(BUDGET.frameP95)} / max ${String(BUDGET.frameMax)}`,
      verdict: failed ? 'fail' : 'reported',
    });
    if (failed) {
      failures.push(
        `${scenario.name}: frame gaps ${describe(gaps)} with ${(slowShare * 100).toFixed(0)}% over 50ms against p95 ${String(BUDGET.frameP95)}ms / max ${String(BUDGET.frameMax)}ms`,
      );
    }
    if (throttled && longTasks.max > BUDGET.longTaskMax) {
      failures.push(
        `${scenario.name}: the longest main-thread block was ${longTasks.max.toFixed(0)}ms, over the ${String(BUDGET.longTaskMax)}ms budget`,
      );
    }
  }
}

test.describe('a thirty-layer document in a real browser', () => {
  // Every scenario runs twice over, once throttled, with a warm-up pass in front of each phase.
  test.describe.configure({ timeout: 420_000 });

  test('paints thirty real layers, graphics included', async ({ page }) => {
    await installPerfRecorder(page);
    await openFixture(page);

    const layers = DOCUMENT.scene.layers;
    expect(layers).toHaveLength(30);
    const counts: Record<string, number> = {};
    for (const layer of layers) counts[layer.type] = (counts[layer.type] ?? 0) + 1;
    expect(counts).toEqual({ rect: 7, ellipse: 3, image: 10, text: 10 });
    // The graphics are placed catalogue records, so the document carries their licences.
    expect(DOCUMENT.attribution).toHaveLength(10);

    // The browser really drew it: ink where the headline text and the graphic strip sit.
    const headline = await readInkBands(page, { x: 48, y: 40, width: 620, height: 88 });
    expect(headline.bands.length, 'the headline should be painted').toBeGreaterThan(0);
    const strip = await readInkBands(page, { x: 48, y: 500, width: 380, height: 130 });
    expect(strip.inkRows, 'the placed graphics should be painted').toBeGreaterThan(20);

    // And the interface agrees about how many layers there are.
    await expect(page.getByRole('img', { name: /30 layers/ })).toBeVisible();
  });

  test('stays inside the recorded budget while editing', async ({ page }) => {
    await installPerfRecorder(page);
    await openFixture(page);

    const report = new PerfReport('Thirty-layer responsiveness (production build, in Chromium)');
    const failures: string[] = [];

    await runPhase(page, 'throttled', THROTTLED_SAMPLES, true, report, failures);
    await runPhase(page, 'unthrottled', UNTHROTTLED_SAMPLES, false, report, failures);

    report.note(
      `Throttled phase: CDP \`Emulation.setCPUThrottlingRate: ${String(THROTTLE_RATE)}\`, ${String(THROTTLED_SAMPLES)} samples per scenario after a warm-up pass.`,
    );
    report.note(
      `Unthrottled phase: the same scenarios at full speed, ${String(UNTHROTTLED_SAMPLES)} samples, reported for context and not gated (runner hardware varies).`,
    );
    report.note(
      'Latency is measured in the page, from the input event timestamp to the second animation frame after it.',
    );
    const markdown = report.write();
    expect(failures, `\n${markdown}`).toEqual([]);
  });
});
