/**
 * Performance instrumentation for the browser suite.
 *
 * The thirty-layer acceptance criterion is a statement about the *interface feeling responsive*, so
 * the numbers here are collected the way a user experiences the delay rather than the way a profiler
 * would report it:
 *
 * 1. **Interaction latency** - the time from the input event the browser dispatched (a `click`, a
 *    `keydown`, a `pointerdown`) to the second animation frame after it. Two frames is the smallest
 *    honest proxy for "the result is on screen": one frame carries React's commit plus the canvas
 *    repaint, the next one is slack for the compositor. The clock starts at the event's own
 *    `timeStamp`, so Playwright's protocol round trip is not counted as the user's delay.
 * 2. **Frame gaps during a drag** - an animation-frame loop records every frame timestamp while the
 *    pointer is moving. A gap between frames is exactly "the drag stuttered".
 * 3. **Long tasks and slow events** - `PerformanceObserver` entries for tasks over 50ms and for
 *    input events over 16ms, which is the browser's own account of what blocked the main thread.
 *
 * Nothing here is added to the application: the recorder is injected into the page by the test, and
 * the selectors it uses are the same inert `data-*` hooks the rest of the suite already relies on.
 */

import { cpus, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

export type InteractionSample = {
  readonly name: string;
  /** Milliseconds from the input event to the second animation frame after it. */
  readonly ms: number;
  /** Which event the measurement started from, so a spec can prove the input really happened. */
  readonly event: string;
};

export type FrameStats = {
  /** Frames observed while the drag was in progress. */
  readonly frames: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  /** Frames that took longer than 50ms, the usual "this stuttered" line. */
  readonly over50: number;
  /** Wall time the frame loop was watching. */
  readonly span: number;
  /** Every gap between consecutive frames, so a caller can pool several drags. */
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

export type PerfGlobal = {
  begin(name: string, kinds: readonly string[]): void;
  take(name: string): InteractionSample[];
  startFrames(): void;
  stopFrames(): FrameStats;
  takeLongTasks(): { readonly start: number; readonly duration: number }[];
  takeSlowEvents(): { readonly name: string; readonly duration: number }[];
  reset(): void;
};

declare global {
  interface Window {
    __forgePerf: PerfGlobal;
  }
}

/** Installs the recorder before the application loads. */
export async function installPerfRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Sample = { name: string; ms: number; event: string };
    type Pending = { name: string; kinds: readonly string[] } | null;

    const samples: Sample[] = [];
    const longTasks: { start: number; duration: number }[] = [];
    const slowEvents: { name: string; duration: number }[] = [];
    let pending: Pending = null;
    let frames: number[] = [];
    let recording = false;
    let loop = 0;

    const loopFrame = (timestamp: number): void => {
      frames.push(timestamp);
      loop = window.requestAnimationFrame(loopFrame);
    };

    const onInput = (event: Event): void => {
      if (pending && pending.kinds.includes(event.type)) {
        const name = pending.name;
        pending = null;
        const start = event.timeStamp;
        const kind = event.type;
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame((second) => {
            samples.push({ name, ms: second - start, event: kind });
          });
        });
      }
    };

    for (const kind of ['click', 'keydown', 'pointerdown', 'pointerup', 'input', 'change']) {
      window.addEventListener(kind, onInput, true);
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ start: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: 'longtask', buffered: false });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          slowEvents.push({ name: entry.name, duration: entry.duration });
        }
      }).observe({
        // `durationThreshold` is a real option the DOM typings do not carry yet; 16ms is the lowest
        // value Chromium honours, so everything the browser considers slow enough to report arrives.
        type: 'event',
        durationThreshold: 16,
        buffered: false,
      } as PerformanceObserverInit);
    } catch {
      // A browser without one of these entry types simply reports nothing for it; the interaction and
      // frame measurements above do not depend on them.
    }

    window.__forgePerf = {
      begin(name, kinds) {
        pending = { name, kinds };
      },
      take(name) {
        const taken = samples.filter((sample) => sample.name === name);
        for (const sample of taken) samples.splice(samples.indexOf(sample), 1);
        return taken;
      },
      startFrames() {
        frames = [];
        if (!recording) {
          recording = true;
          loop = window.requestAnimationFrame(loopFrame);
        }
      },
      stopFrames() {
        recording = false;
        window.cancelAnimationFrame(loop);
        const sorted = [...frames].sort((a, b) => a - b);
        const gaps: number[] = [];
        for (let index = 1; index < frames.length; index += 1) {
          gaps.push((frames[index] ?? 0) - (frames[index - 1] ?? 0));
        }
        gaps.sort((a, b) => a - b);
        const read = (percent: number): number =>
          gaps.length === 0
            ? 0
            : (gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * percent))] ?? 0);
        return {
          frames: frames.length,
          p50: read(0.5),
          p95: read(0.95),
          max: gaps.length === 0 ? 0 : (gaps[gaps.length - 1] ?? 0),
          over50: gaps.filter((gap) => gap > 50).length,
          span: sorted.length === 0 ? 0 : (sorted[sorted.length - 1] ?? 0) - (sorted[0] ?? 0),
          gaps,
        };
      },
      takeLongTasks() {
        return longTasks.splice(0, longTasks.length);
      },
      takeSlowEvents() {
        return slowEvents.splice(0, slowEvents.length);
      },
      reset() {
        samples.length = 0;
        longTasks.length = 0;
        slowEvents.length = 0;
        pending = null;
      },
    };
  });
}

/** Arms the recorder, runs one interaction, and returns what the browser measured for it. */
export async function measureInteraction(
  page: Page,
  options: { readonly name: string; readonly kinds: readonly string[] },
  run: () => Promise<void>,
): Promise<InteractionSample> {
  await page.evaluate(
    ({ name, kinds }) => {
      window.__forgePerf.begin(name, kinds);
    },
    { name: options.name, kinds: options.kinds },
  );
  await run();
  const taken = await page.evaluate((name) => window.__forgePerf.take(name), options.name);
  const sample = taken[0];
  if (!sample) {
    throw new Error(
      `the ${options.name} interaction produced no ${options.kinds.join('/')} event, so nothing was measured`,
    );
  }
  return sample;
}

/** Runs a pointer drag while watching frame timestamps. */
export async function measureFrames(page: Page, run: () => Promise<void>): Promise<FrameStats> {
  await page.evaluate(() => {
    window.__forgePerf.startFrames();
  });
  try {
    await run();
  } finally {
    // The loop must stop even if the drag threw, or the next measurement would inherit its frames.
  }
  return page.evaluate(() => window.__forgePerf.stopFrames());
}

export async function takeLongTasks(page: Page): Promise<LongTaskStats> {
  const entries = await page.evaluate(() => window.__forgePerf.takeLongTasks());
  return {
    count: entries.length,
    total: entries.reduce((sum, entry) => sum + entry.duration, 0),
    max: entries.reduce((peak, entry) => Math.max(peak, entry.duration), 0),
  };
}

export async function takeSlowEvents(page: Page): Promise<SlowEventStats> {
  const entries = await page.evaluate(() => window.__forgePerf.takeSlowEvents());
  return {
    count: entries.length,
    max: entries.reduce((peak, entry) => Math.max(peak, entry.duration), 0),
  };
}

export async function resetPerf(page: Page): Promise<void> {
  await page.evaluate(() => window.__forgePerf.reset());
}

/**
 * Slows the renderer down by `rate`, through the DevTools protocol.
 *
 * GitHub's runners are faster than the laptop the criterion names, so the throttled numbers are the
 * conservative proxy for that laptop and the ones the budget is checked against. The multiplier is
 * documented in docs/PERFORMANCE.md along with what it cannot stand in for.
 */
export async function throttleCpu(page: Page, rate: number): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export type ReportRow = {
  readonly scenario: string;
  readonly metric: string;
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly note: string;
  /** Budget the scenario was checked against, when it has one. */
  readonly budget: string;
  readonly verdict: 'pass' | 'fail' | 'reported';
};

/**
 * Collects the measured numbers and writes them out twice: as the failure message (so a red check-run
 * carries the whole distribution, since the run log is not always reachable) and as a markdown file
 * the CI job publishes onto the pull request.
 */
export class PerfReport {
  private readonly rows: ReportRow[] = [];
  private readonly notes: string[] = [];

  public constructor(
    private readonly title: string,
    private readonly directory = 'test-results',
  ) {}

  public add(row: ReportRow): void {
    this.rows.push(row);
  }

  public note(text: string): void {
    this.notes.push(text);
  }

  public environment(): string {
    const cpu = cpus()[0];
    return [
      `Runtime: Node ${process.version} on ${process.platform} ${process.arch}`,
      `CPU: ${cpu?.model ?? 'unknown'} (${String(cpus().length)} logical cores)`,
      `Memory: ${(totalmem() / 1024 ** 3).toFixed(1)} GiB`,
      `Commit: ${process.env.GITHUB_SHA ?? 'local'}`,
    ].join('\n');
  }

  public markdown(): string {
    const header = [
      `### ${this.title}`,
      '',
      this.environment(),
      '',
      '| Scenario | Metric | n | p50 | p95 | worst | Budget | Result |',
      '| --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
    ];
    const body = this.rows.map(
      (row) =>
        `| ${row.scenario} | ${row.metric} | ${String(row.samples)} | ${row.p50.toFixed(1)}ms | ${row.p95.toFixed(1)}ms | ${row.max.toFixed(1)}ms | ${row.budget} | ${row.verdict} |`,
    );
    const notes = this.notes.length === 0 ? [] : ['', ...this.notes.map((note) => `- ${note}`)];
    return [...header, ...body, ...notes, ''].join('\n');
  }

  public write(): string {
    const markdown = this.markdown();
    try {
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(join(this.directory, 'perf-report.md'), markdown, 'utf8');
    } catch {
      // Writing the report is a convenience; the assertion messages carry the same content.
    }
    return markdown;
  }
}

/** A stable, readable summary of a distribution, used in assertion messages. */
export function describe(values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  return `n=${String(values.length)} p50=${percentile(values, 0.5).toFixed(1)}ms p95=${percentile(values, 0.95).toFixed(1)}ms max=${(sorted[sorted.length - 1] ?? 0).toFixed(1)}ms [${sorted.map((value) => value.toFixed(1)).join(', ')}]`;
}
