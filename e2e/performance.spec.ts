/**
 * Thirty-layer responsiveness, measured in a real browser.
 *
 * Phase 2's exit criterion says editing a thirty-layer document stays responsive. To check that
 * claim, this spec:
 *
 * 1. opens a **real thirty-layer document** — ten placed catalogue graphics with their attribution
 *    records, ten wrapping text layers and ten shapes — built by the editor's own commands
 *    (`src/testing/thirty-layers.ts`) and proves the browser really painted it;
 * 2. drives **real interactions** through the production build: selecting one layer and a group,
 *    dragging a layer and a group, resizing from a handle, committing inspector values, changing
 *    opacity from the keyboard, hiding and locking a layer, and undo/redo;
 * 3. measures the two things a person actually feels — how long the result took to appear after the
 *    input, and how evenly the frames kept coming during a drag — after a warm-up pass, in a
 *    **controlled CPU-slowdown phase** that the budget is checked against, and again unthrottled for
 *    context.
 *
 * The budget below was written before the first measurement and is not adjusted to fit results: a
 * benchmark whose threshold moves with the numbers proves nothing. Method, thresholds, measured
 * results, the proxy's limitations and how to read the report are in docs/PERFORMANCE.md.
 */

import { cpus } from 'node:os';

import { expect, test, type Page } from '@playwright/test';

import { CURRENT_SCHEMA_VERSION, migrateDocument } from '../src/core/documents/migrations';
import { hitTestScene } from '../src/core/documents/scene-geometry';
import type { Scene } from '../src/core/documents/layer-types';
import { thirtyLayerDocument } from '../src/testing/thirty-layers';
import { STORAGE_KEY, layerButton, pointInDocument } from './fixtures';
import {
  PerfReport,
  describeDistribution,
  installPerfRecorder,
  measureFrames,
  measureInteraction,
  percentile,
  resetPerfRecorder,
  takeLongTasks,
  takeSlowEvents,
  throttleCpu,
  type FrameStats,
  type InteractionSample,
} from './perf';
import { readInkBands } from './pixels';

/**
 * The document every measurement runs on. Deterministic: the builder is fixed, so two runs describe
 * the same picture and the numbers are comparable between runs.
 */
const DOCUMENT = thirtyLayerDocument();
const ENVELOPE = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  savedAt: '2026-02-01T12:00:00.000Z',
  documents: [DOCUMENT],
};

/**
 * The acceptance budget — decided before the first measurement, and never widened afterwards.
 *
 * - **200 ms p95 / 500 ms worst** for a discrete interaction. A healthy interaction in a thirty-layer
 *   document is a few milliseconds of work; at a four-fold CPU slowdown that is still an order of
 *   magnitude inside the budget, so anything that trips it is a real regression rather than noise.
 *   (For scale: Web Vitals calls 200 ms a *good* response on unmodified hardware.)
 * - **100 ms p95 / 500 ms worst** between frames during a drag, and at most a fifth of frames slower
 *   than 50 ms. A drag that paints every 100 ms is visibly jerky; 16 ms would be a false precision at
 *   a 4x slowdown.
 * - **600 ms** for the longest single main-thread block in a phase. That is where "slow" becomes
 *   "frozen", and it is the one number that must not be traded away.
 */
const BUDGET = {
  interactionP95: 200,
  interactionWorst: 500,
  frameP95: 100,
  frameWorst: 500,
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
 * The suite default is "wait forever", which turned one wrong selector into a seven-minute timeout.
 * Twenty seconds is far longer than any of these interactions take (the budget allows 500 ms) but
 * short enough that a broken selector fails the scenario, is reported with its measurements, and
 * lets the rest of the benchmark run.
 */
const ACTION_TIMEOUT = 20_000;

/** Bounded, but long enough for a populated benchmark: two phases over ten scenarios. */
const TEST_TIMEOUT = 8 * 60_000;

type Outcome = InteractionSample | FrameStats;

type Scenario = {
  readonly name: string;
  readonly how: string;
  readonly metric: 'interaction' | 'frames';
  /** Puts the document and the selection into the state this measurement needs. */
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

/** Leaves a layer visible or hidden, clicking only when the row is not already in that state. */
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

/** Selects exactly one layer from the list, which is also the keyboard-reachable path to a selection. */
async function selectOnlyLayer(page: Page, name: string): Promise<void> {
  await layerButton(page, name).click();
  await expect(page.getByLabel('Layer name')).toHaveValue(name);
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
 * Layers overlap in a thirty-layer document, so "drag the Tile" needs a grab point where the Tile is
 * really on top. Scanning and asking `hitTestScene` — the same function the pointer handler runs —
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
        await extendSelection(page, 'Card A');
      });
    },
  },
  {
    name: 'hide-layer',
    how: 'click Hide on a layer row',
    metric: 'interaction',
    prepare: async (page) => {
      await setVisibility(page, 'Subhead', true);
    },
    run: async (page) => {
      const measured = await measureInteraction(page, 'hide-layer', ['click'], async () => {
        await rowToggle(page, 'Subhead', 'Hide').click();
      });
      await setVisibility(page, 'Subhead', true);
      return measured;
    },
  },
  {
    name: 'lock-layer',
    how: 'click Lock on a layer row',
    metric: 'interaction',
    prepare: async (page) => {
      await setLocked(page, 'Halo', false);
    },
    run: async (page) => {
      const measured = await measureInteraction(page, 'lock-layer', ['click'], async () => {
        await rowToggle(page, 'Halo', 'Lock').click();
      });
      await setLocked(page, 'Halo', false);
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
      await selectOnlyLayer(page, 'Halo');
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
      await setVisibility(page, 'Tile', true);
    },
    run: async (page) => {
      // A real edit first, so there is something to step back to; then the measured step back.
      await rowToggle(page, 'Tile', 'Hide').click();
      await expect(historyButton(page, 'Undo')).toBeEnabled();
      const measured = await measureInteraction(page, 'undo', ['click'], async () => {
        await historyButton(page, 'Undo').click();
      });
      await expect(historyButton(page, 'Redo')).toBeEnabled();
      await historyButton(page, 'Redo').click();
      await setVisibility(page, 'Tile', true);
      return measured;
    },
  },
  {
    name: 'redo',
    how: 'redo an edit from the history panel',
    metric: 'interaction',
    prepare: async (page) => {
      await setVisibility(page, 'Caption', true);
    },
    run: async (page) => {
      await rowToggle(page, 'Caption', 'Hide').click();
      await historyButton(page, 'Undo').click();
      await expect(historyButton(page, 'Redo')).toBeEnabled();
      const measured = await measureInteraction(page, 'redo', ['click'], async () => {
        await historyButton(page, 'Redo').click();
      });
      await setVisibility(page, 'Caption', true);
      return measured;
    },
  },
  {
    name: 'drag-layer',
    how: 'drag one selected layer across the canvas',
    metric: 'frames',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Tile');
    },
    run: async (page, sample) => {
      const direction = sample % 2 === 0 ? 1 : -1;
      return dragLayer(page, 'Tile', { x: 40 * direction, y: 30 * direction });
    },
  },
  {
    name: 'drag-group',
    how: 'drag a three-layer selection',
    metric: 'frames',
    prepare: async (page) => {
      await selectOnlyLayer(page, 'Intro copy');
      await extendSelection(page, 'Programme copy');
      await extendSelection(page, 'Quote');
    },
    run: async (page, sample) => {
      const direction = sample % 2 === 0 ? 1 : -1;
      const from = grabPoint(await storedScene(page), 'Programme copy');
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
  await page.goto(`/workspace/${String(DOCUMENT.id)}`);
  await expect(page.getByTestId('artboard')).toBeVisible();
  await expect(page.locator('[data-testid^="layer-row-"]')).toHaveCount(
    DOCUMENT.scene.layers.length,
  );
  // Every graphic finished decoding: the stage only shows this note while one is outstanding.
  await expect(page.getByText('Graphics are still loading')).toHaveCount(0, { timeout: 30_000 });
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
    await scenario.prepare(page);
    await scenario.run(page, 0);
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
        // A scenario that cannot complete is reported and abandoned: its remaining samples would only
        // repeat the same failure, and the rest of the benchmark still has to run.
        scenarioError = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    const longTasks = await takeLongTasks(page);
    const slowEvents = await takeSlowEvents(page);
    const observed = `long tasks ${String(longTasks.count)} (worst ${longTasks.max.toFixed(0)} ms), input events over 16 ms ${String(slowEvents.count)} (worst ${slowEvents.max.toFixed(0)} ms)`;

    if (scenarioError !== null) {
      broken.add(scenario.name);
      report.fail(`${phase} ${scenario.name}`, scenarioError);
      continue;
    }

    if (scenario.metric === 'interaction') {
      const p95 = percentile(interactions, 0.95);
      const worst = interactions.length === 0 ? 0 : Math.max(...interactions);
      const failed =
        throttled &&
        (interactions.length < counts.interaction ||
          p95 > BUDGET.interactionP95 ||
          worst > BUDGET.interactionWorst);
      report.add({
        scenario: scenario.name,
        how: scenario.how,
        phase,
        samples: interactions.length,
        p50: percentile(interactions, 0.5),
        p95,
        worst,
        observed,
        budget: throttled
          ? `p95 ${String(BUDGET.interactionP95)} ms / worst ${String(BUDGET.interactionWorst)} ms`
          : 'reported only',
        verdict: failed ? 'fail' : throttled ? 'pass' : 'reported',
      });
      if (failed) {
        report.note(
          `${phase} ${scenario.name}: ${describeDistribution(interactions)}. Samples: [${interactions
            .map((value) => value.toFixed(1))
            .join(', ')}] ms.`,
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
        worst > BUDGET.frameWorst ||
        slowShare > BUDGET.frameOver50Share);
    const longTaskFailed = throttled && longTasks.max > BUDGET.longTaskWorst;
    report.add({
      scenario: scenario.name,
      how: `${scenario.how} (${String(gaps.length)} frame gaps over ${String(drags.length)} drags)`,
      phase,
      samples: drags.length,
      p50: percentile(gaps, 0.5),
      p95,
      worst,
      observed: `${observed}, ${(slowShare * 100).toFixed(0)}% of gaps over 50 ms`,
      budget: throttled
        ? `p95 ${String(BUDGET.frameP95)} ms / worst ${String(BUDGET.frameWorst)} ms, ≤ ${String(BUDGET.frameOver50Share * 100)}% over 50 ms`
        : 'reported only',
      verdict: failed || longTaskFailed ? 'fail' : throttled ? 'pass' : 'reported',
    });
    if (failed) {
      report.note(
        `${phase} ${scenario.name}: frame gaps ${describeDistribution(gaps)} with ${(slowShare * 100).toFixed(0)}% over 50 ms.`,
      );
    }
    if (longTaskFailed) {
      report.note(
        `${phase} ${scenario.name}: the longest main-thread block was ${longTasks.max.toFixed(0)} ms, over the ${String(BUDGET.longTaskWorst)} ms budget.`,
      );
    }
  }

  // Back to full speed before anything else runs in this browser.
  await throttleCpu(page, 1);
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
    commit: process.env.GITHUB_SHA ?? 'local',
  };
}

test.describe('a thirty-layer document in a real browser', () => {
  test.describe.configure({ timeout: TEST_TIMEOUT });

  test.beforeEach(async ({ page }) => {
    // Bounded per action: a wrong selector must fail one scenario in seconds, not eat the test.
    page.setDefaultTimeout(ACTION_TIMEOUT);
    await installPerfRecorder(page);
  });

  test('paints thirty real layers, graphics included', async ({ page }) => {
    await openFixture(page);

    const layers = DOCUMENT.scene.layers;
    expect(layers).toHaveLength(30);
    const counts: Record<string, number> = {};
    for (const layer of layers) counts[layer.type] = (counts[layer.type] ?? 0) + 1;
    expect(counts).toEqual({ rect: 7, ellipse: 3, image: 10, text: 10 });
    // The graphics are placed catalogue records, so the document carries their licences.
    expect(DOCUMENT.attribution).toHaveLength(10);
    await expect(page.getByRole('img', { name: /30 layers/ })).toBeVisible();

    // The browser really drew it: ink where the headline text sits, and where the graphics strip is.
    const headline = await readInkBands(page, { x: 48, y: 40, width: 700, height: 92 });
    expect(headline.bands.length, 'the headline text should be painted').toBeGreaterThan(0);
    const strip = await readInkBands(page, { x: 60, y: 512, width: 380, height: 104 });
    expect(strip.inkRows, 'the placed graphics should be painted').toBeGreaterThan(10);
  });

  test('stays inside the recorded budget while editing', async ({ page }) => {
    await openFixture(page);

    const report = new PerfReport('Thirty-layer responsiveness (production build, in Chromium)', {
      ...environment(),
      browser: `Chromium ${page.context().browser()?.version() ?? 'unknown'} (Playwright)`,
    });
    report.note(
      `Gated phase: CDP \`Emulation.setCPUThrottlingRate: ${String(THROTTLE_RATE)}\`, ${String(SAMPLES.throttled.interaction)} interaction samples and ${String(SAMPLES.throttled.frames)} drag samples per scenario, after one unrecorded warm-up pass.`,
    );
    report.note(
      `Reported phase: the same scenarios at full speed (${String(SAMPLES.unthrottled.interaction)} / ${String(SAMPLES.unthrottled.frames)} samples). GitHub runners vary, so this phase is context rather than a gate.`,
    );
    report.note(
      "Latency is measured in the page: from the input event's own timestamp to the second animation frame after it. Frame gaps are the intervals between animation frames while the pointer moves.",
    );

    const broken = new Set<string>();
    await runPhase(page, 'throttled', report, broken);
    await runPhase(page, 'unthrottled', report, broken);

    // Left in the log for anyone reading the run, and written to test-results/perf-report.md for the
    // CI job that publishes it onto the pull request.
    process.stdout.write(`\n${report.markdown()}\n`);

    expect(report.failureLines(), `\n${report.markdown()}`).toEqual([]);
  });
});
