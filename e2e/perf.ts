/**
 * Performance instrumentation for the browser benchmark.
 *
 * The benchmark has to answer a question about the *interface*: does editing a thirty-layer document
 * still feel immediate? So every number here is collected in the page, from the browser's own clock,
 * around interactions a person performs — not from a synthetic loop over a pure function.
 *
 * Three measurements, each answering a different complaint:
 *
 * 1. **Interaction latency** — how long the page took to show the result of one discrete input:
 *    a click, a key press, a committed inspector value. The clock starts at the input event's own
 *    `timeStamp` and stops on the animation frame *after* the one that followed it, because a frame
 *    that arrives while the main thread is still busy cannot be showing the finished result yet.
 *    This is the same shape as the metric a field-performance tool would report, minus the field.
 * 2. **Frame gaps during a drag** — the gap between consecutive animation frames while the pointer
 *    is moving. A drag that paints every 200ms is visibly broken no matter how fast any single
 *    operation is, and this is the measurement that catches it.
 * 3. **Long tasks and slow events** — the browser's own `PerformanceObserver` entries for main-thread
 *    tasks over 50ms and input events over 16ms. These explain *why* the first two got worse, and a
 *    single 600ms task is what a person experiences as a freeze.
 *
 * Nothing in this file ships: it is injected into the page by the test, uses no application hooks,
 * and the app never imports it (ADR-0018 keeps the harness outside the product).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

/** One measured interaction: the input event that started it, and the delay until it was on screen. */
export type InteractionSample = {
  readonly name: string;
  readonly ms: number;
  readonly event: string;
};

export type FrameStats = {
  readonly frames: number;
  /** Wall time the frame loop covered, in ms. */
  readonly span: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  /** Gaps longer than 50ms: the line past which a drag reads as stuttering. */
  readonly over50: number;
  /** Every gap, so several drags can be pooled into one distribution. */
  readonly gaps: readonly number[];
};

export type LongTaskStats = {
  readonly count: number;
  readonly total: number;
  readonly max: number;
};

export type SlowEventStats = {
  readonly count: number;
  readonly max: number;
};

type PageApi = {
  begin: (name: string, kinds: readonly string[]) => void;
  /** Whether a measurement has landed yet: the two `requestAnimationFrame` hops are not instant. */
  has: (name: string) => boolean;
  take: (name: string) => readonly InteractionSample[];
  startFrames: () => void;
  stopFrames: () => FrameStats;
  /** Drains every observation collected so far: long tasks and slow input events. */
  takeObserved: () => readonly { readonly name: string; readonly duration: number }[];
  reset: () => void;
};

declare global {
  interface Window {
    __forgePerf: PageApi;
  }
}

/**
 * Installs the recorder before the application boots.
 *
 * `addInitScript` runs on every navigation, so the recorder survives the reloads some scenarios use.
 */
export async function installPerfRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Pending = { readonly name: string; readonly kinds: readonly string[] };
    type Sample = { readonly name: string; readonly ms: number; readonly event: string };

    const samples: Sample[] = [];
    const longTasks: { readonly name: string; readonly duration: number }[] = [];
    let pending: Pending | null = null;
    let frameTimes: number[] = [];
    let openMoves: number[] = [];
    let recordingFrames = false;
    let loop = 0;

    /** One frame loop, used both for gap statistics and to time pointer-move handling. */
    const tick = (timestamp: number): void => {
      if (!recordingFrames) return;
      frameTimes.push(timestamp);
      for (const moved of openMoves) {
        samples.push({ name: 'pointermove', ms: timestamp - moved, event: 'pointermove' });
      }
      openMoves = [];
      loop = window.requestAnimationFrame(tick);
    };

    const onInput = (event: Event): void => {
      if (pending && pending.kinds.includes(event.type)) {
        const armed = pending;
        pending = null;
        const start = event.timeStamp;
        const kind = event.type;
        // Two frames: React commits on the first, the canvas repaint lands with it; the second is the
        // earliest moment the result can honestly be called "on screen".
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame((second) => {
            samples.push({ name: armed.name, ms: second - start, event: kind });
          });
        });
      }
      if (recordingFrames && event.type === 'pointermove') openMoves.push(event.timeStamp);
    };

    // Capture phase: the recorder must see the event even if a handler stops propagation.
    for (const kind of ['click', 'keydown', 'pointerdown', 'change']) {
      window.addEventListener(kind, onInput, true);
    }
    window.addEventListener('pointermove', onInput, true);

    const observer = (entryTypes: readonly string[]): void => {
      for (const entryType of entryTypes) {
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              longTasks.push(
                entryType === 'longtask'
                  ? { name: 'longtask', duration: entry.duration }
                  : { name: 'slow-event', duration: entry.duration },
              );
            }
          }).observe({ type: entryType, buffered: true });
        } catch {
          // An unsupported entry type simply reports nothing; the measurements above still work.
        }
      }
    };
    observer(['longtask', 'event']);

    const read = (sorted: readonly number[], fraction: number): number => {
      if (sorted.length === 0) return 0;
      const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
      return sorted[Math.max(0, index)] ?? 0;
    };

    window.__forgePerf = {
      begin(name, kinds) {
        pending = { name, kinds };
      },
      has(name) {
        return samples.some((sample) => sample.name === name);
      },
      take(name) {
        const taken = samples.filter((sample) => sample.name === name);
        for (const sample of taken) samples.splice(samples.indexOf(sample), 1);
        return taken;
      },
      startFrames() {
        frameTimes = [];
        openMoves = [];
        recordingFrames = true;
        window.cancelAnimationFrame(loop);
        loop = window.requestAnimationFrame(tick);
      },
      stopFrames() {
        recordingFrames = false;
        window.cancelAnimationFrame(loop);
        const gaps: number[] = [];
        for (let index = 1; index < frameTimes.length; index += 1) {
          gaps.push((frameTimes[index] ?? 0) - (frameTimes[index - 1] ?? 0));
        }
        const sorted = [...gaps].sort((a, b) => a - b);
        const first = frameTimes[0] ?? 0;
        const last = frameTimes[frameTimes.length - 1] ?? first;
        return {
          frames: frameTimes.length,
          span: last - first,
          p50: read(sorted, 0.5),
          p95: read(sorted, 0.95),
          max: sorted.length === 0 ? 0 : (sorted[sorted.length - 1] ?? 0),
          over50: gaps.filter((gap) => gap > 50).length,
          gaps,
        };
      },
      takeObserved() {
        return longTasks.splice(0, longTasks.length);
      },
      reset() {
        samples.length = 0;
        longTasks.length = 0;
        openMoves = [];
        frameTimes = [];
        pending = null;
      },
    };
  });
}

/**
 * Runs one interaction and returns what the page measured for it.
 *
 * @param kinds the event types that may start the clock. Passing the wrong kind is a test defect, so
 *   it fails loudly instead of silently measuring the next interaction.
 */
const SAMPLE_WAIT_MS = 5_000;

export async function measureInteraction(
  page: Page,
  name: string,
  kinds: readonly string[],
  run: () => Promise<void>,
): Promise<InteractionSample> {
  await page.evaluate(
    ({ armedName, armedKinds }) => {
      window.__forgePerf.begin(armedName, armedKinds);
    },
    { armedName: name, armedKinds: kinds },
  );
  await run();
  // The clock stops on the second frame after the input, so the sample can arrive a frame or two
  // after the interaction is over. Waiting for it is what keeps this measurement honest instead of
  // racing it: the alternative would be to give up quietly and report the *next* interaction.
  try {
    await page.waitForFunction((armedName) => window.__forgePerf.has(armedName), name, {
      timeout: SAMPLE_WAIT_MS,
    });
  } catch {
    // Nothing arrived in time; the message below says so with the detail that matters.
  }
  const taken = await page.evaluate((armedName) => window.__forgePerf.take(armedName), name);
  const sample = taken[0];
  if (!sample) {
    throw new Error(
      `“${name}” produced no ${kinds.join('/')} event, so nothing could be measured — the interaction never reached the page`,
    );
  }
  return sample;
}

/**
 * Runs a drag with the frame loop watching.
 *
 * The loop is stopped in a `finally`, so a failing drag cannot leave a recorder running into the next
 * measurement.
 */
export async function measureFrames(page: Page, run: () => Promise<void>): Promise<FrameStats> {
  await page.evaluate(() => {
    window.__forgePerf.startFrames();
  });
  let stats: FrameStats | null = null;
  try {
    await run();
  } finally {
    // Always, including on failure: a recorder left running would pollute the next measurement.
    stats = await page.evaluate(() => window.__forgePerf.stopFrames());
  }
  return stats;
}

/** Drains the long-task entries collected since the last drain. */
export async function takeLongTasks(page: Page): Promise<LongTaskStats> {
  const entries = await page.evaluate(() => window.__forgePerf.takeObserved());
  const tasks = entries.filter((entry) => entry.name === 'longtask');
  return {
    count: tasks.length,
    total: tasks.reduce((sum, entry) => sum + entry.duration, 0),
    max: tasks.reduce((peak, entry) => Math.max(peak, entry.duration), 0),
  };
}

/** Drains the browser's own "this input event was slow" entries since the last drain. */
export async function takeSlowEvents(page: Page): Promise<SlowEventStats> {
  const entries = await page.evaluate(() => window.__forgePerf.takeObserved());
  const events = entries.filter((entry) => entry.name === 'slow-event');
  return {
    count: events.length,
    max: events.reduce((peak, entry) => Math.max(peak, entry.duration), 0),
  };
}

export async function resetPerfRecorder(page: Page): Promise<void> {
  await page.evaluate(() => window.__forgePerf.reset());
}

/**
 * Slows the renderer down with the DevTools protocol, the documented CI proxy for slower hardware.
 *
 * `rate: 1` restores full speed. See docs/PERFORMANCE.md for what this can and cannot stand in for.
 */
export async function throttleCpu(page: Page, rate: number): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Emulation.setCPUThrottlingRate', { rate });
  } finally {
    await session.detach();
  }
}

/** Nearest-rank percentile over a small sample, which is all a distribution of twelve needs. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

/** A readable summary of a distribution, used in assertion messages and the report. */
export function describeDistribution(values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  return `n=${String(values.length)} p50=${percentile(values, 0.5).toFixed(1)}ms p95=${percentile(values, 0.95).toFixed(1)}ms worst=${(sorted[sorted.length - 1] ?? 0).toFixed(1)}ms`;
}

export type ScenarioRow = {
  readonly scenario: string;
  readonly how: string;
  readonly phase: string;
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly worst: number;
  /** Long-task and slow-event counts observed while the scenario ran. */
  readonly observed: string;
  /** The budget this row was measured against, or `reported` for an ungated phase. */
  readonly budget: string;
  readonly verdict: 'pass' | 'fail' | 'reported';
};

export type EnvironmentFacts = {
  readonly runtime: string;
  readonly browser: string;
  readonly cpu: string;
  readonly commit: string;
};

function markdownTable(rows: readonly ScenarioRow[]): string {
  const header =
    '| Scenario | What the user does | Phase | n | p50 | p95 | worst | Observed | Budget | Result |';
  const divider = '| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |';
  const body = rows.map(
    (row) =>
      `| \`${row.scenario}\` | ${row.how} | ${row.phase} | ${String(row.samples)} | ${row.p50.toFixed(1)} ms | ${row.p95.toFixed(1)} ms | ${row.worst.toFixed(1)} ms | ${row.observed} | ${row.budget} | ${row.verdict} |`,
  );
  return [header, divider, ...body].join('\n');
}

/**
 * Collects measurements and writes the report twice: as markdown for the pull request, and as JSON
 * for anything that wants to read the numbers later.
 *
 * Every row is written into the file as soon as it is measured, so a run that fails halfway still
 * publishes what it managed to measure. The same markdown is handed to the assertion message, which
 * is what makes a red check-run carry its own evidence.
 */
export class PerfReport {
  private readonly rows: ScenarioRow[] = [];
  private readonly notes: string[] = [];
  private readonly failures: string[] = [];

  public constructor(
    private readonly title: string,
    private readonly environment: EnvironmentFacts,
    private readonly directory = 'test-results',
  ) {}

  public add(row: ScenarioRow): void {
    this.rows.push(row);
    if (row.verdict === 'fail') {
      this.failures.push(
        `${row.scenario}: p95 ${row.p95.toFixed(1)}ms / worst ${row.worst.toFixed(1)}ms against ${row.budget}`,
      );
    }
    this.write();
  }

  public note(text: string): void {
    this.notes.push(text);
    this.write();
  }

  /** Records a scenario that threw, so the report says so even if the exception is not a budget miss. */
  public fail(scenario: string, reason: string): void {
    this.failures.push(`${scenario}: ${reason}`);
    this.rows.push({
      scenario,
      how: 'the scenario could not be completed',
      phase: 'setup',
      samples: 0,
      p50: 0,
      p95: 0,
      worst: 0,
      observed: reason.split('\n')[0]?.slice(0, 160) ?? reason,
      budget: 'scenario must run',
      verdict: 'fail',
    });
    this.write();
  }

  public failureLines(): readonly string[] {
    return this.failures;
  }

  public markdown(): string {
    return [
      `### ${this.title}`,
      '',
      `- Runtime: ${this.environment.runtime}`,
      `- Browser: ${this.environment.browser}`,
      `- CPU: ${this.environment.cpu}`,
      `- Commit: ${this.environment.commit}`,
      '',
      markdownTable(this.rows),
      '',
      ...this.notes.map((note) => `- ${note}`),
      '',
      this.failures.length === 0
        ? '**Result: every gated scenario stayed inside its budget.**'
        : ['**Result: budget missed**', '', ...this.failures.map((failure) => `- ${failure}`)].join(
            '\n',
          ),
      '',
    ].join('\n');
  }

  public json(): string {
    return `${JSON.stringify(
      {
        title: this.title,
        environment: this.environment,
        rows: this.rows,
        notes: this.notes,
        failures: this.failures,
      },
      null,
      2,
    )}\n`;
  }

  /** Writes both files. Called after every row so a crash mid-run still leaves the evidence behind. */
  public write(): void {
    try {
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(join(this.directory, 'perf-report.md'), this.markdown(), 'utf8');
      writeFileSync(join(this.directory, 'perf-report.json'), this.json(), 'utf8');
    } catch {
      // The report is evidence, not the result: if the disk refuses, the assertion still fails.
    }
  }
}
