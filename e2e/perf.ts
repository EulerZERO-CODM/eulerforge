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
 * and the application never imports it.
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

/** A main-thread task or a slow input event, as the browser itself reported it. */
export type ObservedEntry = {
  readonly kind: 'longtask' | 'slow-event';
  readonly duration: number;
};

type PageApi = {
  begin: (name: string, kinds: readonly string[]) => void;
  /** Whether the sample for this interaction has landed yet. */
  has: (name: string) => boolean;
  take: (name: string) => readonly InteractionSample[];
  startFrames: () => void;
  stopFrames: () => FrameStats;
  /** Drains every observation collected so far: long tasks and slow input events. */
  takeObserved: () => readonly ObservedEntry[];
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
    type Observed = { readonly kind: 'longtask' | 'slow-event'; readonly duration: number };

    const samples: Sample[] = [];
    const observed: Observed[] = [];
    let pending: Pending | null = null;
    let frameTimes: number[] = [];
    let recordingFrames = false;
    let loop = 0;

    /* The events that can start a measurement. `pointermove` is deliberately not among them: a drag
       is measured by its frame gaps, not by a single move event. */
    const kinds = ['click', 'keydown', 'pointerdown', 'pointerup', 'change'];

    const onInput = (event: Event): void => {
      if (pending === null || !pending.kinds.includes(event.type)) return;
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
    };

    // Capture phase: the recorder must see the event even if a handler stops propagation.
    for (const kind of kinds) window.addEventListener(kind, onInput, true);

    const observe = (entryType: 'longtask' | 'event'): void => {
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            observed.push({
              kind: entryType === 'longtask' ? 'longtask' : 'slow-event',
              duration: entry.duration,
            });
          }
        }).observe({
          type: entryType,
          // The events that matter here are the ones over 16ms; `longtask` has no threshold of its own.
          ...(entryType === 'event' ? { durationThreshold: 16 } : {}),
        });
      } catch {
        // An unsupported entry type simply reports nothing; the other measurements still work.
      }
    };
    observe('longtask');
    observe('event');

    const tick = (timestamp: number): void => {
      if (!recordingFrames) return;
      frameTimes.push(timestamp);
      loop = window.requestAnimationFrame(tick);
    };

    const read = (sorted: readonly number[], fraction: number): number => {
      if (sorted.length === 0) return 0;
      const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
      return sorted[Math.max(0, index)] ?? 0;
    };

    window.__forgePerf = {
      begin(name, armedKinds) {
        pending = { name, kinds: armedKinds };
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
        return observed.splice(0, observed.length);
      },
      reset() {
        samples.length = 0;
        observed.length = 0;
        frameTimes = [];
        pending = null;
      },
    };
  });
}

/**
 * How long a measurement may take to land before the recorder says so.
 *
 * The clock stops two animation frames after the input, so the sample can arrive a frame or two after
 * the interaction is over. Waiting for it is what keeps this honest instead of racing it: the
 * alternative would be to give up quietly and report the *next* interaction's number.
 */
const SAMPLE_WAIT_MS = 5_000;

/**
 * Runs one interaction and returns what the page measured for it.
 *
 * @param kinds the event types that may start the clock. Passing the wrong kind is a test defect, so
 *   it fails loudly instead of silently measuring the next interaction.
 */
export async function measureInteraction(
  page: Page,
  name: string,
  kinds: readonly string[],
  action: () => Promise<void>,
): Promise<InteractionSample> {
  await page.evaluate(
    ({ armedName, armedKinds }) => {
      window.__forgePerf.begin(armedName, armedKinds);
    },
    { armedName: name, armedKinds: kinds },
  );
  await action();
  const landed = await page
    .waitForFunction((armedName) => window.__forgePerf.has(armedName), name, {
      timeout: SAMPLE_WAIT_MS,
    })
    .then(
      () => true,
      // A measurement that never arrives is reported by the explicit error below, with the arming
      // detail that actually diagnoses it, rather than as a bare wait-for-function timeout.
      () => false,
    );
  const taken = await page.evaluate((armedName) => window.__forgePerf.take(armedName), name);
  const sample = taken[0];
  if (!sample) {
    throw new Error(
      `“${name}” produced no ${kinds.join('/')} event${landed ? '' : ` within ${String(SAMPLE_WAIT_MS)}ms`}, so nothing could be measured — the interaction never reached the page`,
    );
  }
  return sample;
}

/** Runs a drag with the frame loop watching, always stopping the loop, even when the drag throws. */
export async function measureFrames(page: Page, action: () => Promise<void>): Promise<FrameStats> {
  await page.evaluate(() => {
    window.__forgePerf.startFrames();
  });
  let failure: unknown = null;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  // A recorder left running would pollute the next measurement, so the loop is stopped before the
  // failure is re-thrown.
  const stats = await page.evaluate(() => window.__forgePerf.stopFrames());
  if (failure instanceof Error) throw failure;
  if (failure !== null) throw new Error(`the drag failed: ${typeof failure}`);
  return stats;
}

/** Drains the long tasks and slow input events observed since the last drain. */
export async function takeObserved(page: Page): Promise<readonly ObservedEntry[]> {
  return page.evaluate(() => window.__forgePerf.takeObserved());
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
  /** The budget this row was measured against, or `reported only` for the ungated phase. */
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
  const divider = '| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |';
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
        `${row.scenario} (${row.phase}): p95 ${row.p95.toFixed(1)}ms / worst ${row.worst.toFixed(1)}ms against ${row.budget}`,
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
    const first = reason.split('\n')[0] ?? reason;
    this.failures.push(`${scenario}: ${first.slice(0, 200)}`);
    this.rows.push({
      scenario,
      how: 'the scenario could not be completed',
      phase: 'setup',
      samples: 0,
      p50: 0,
      p95: 0,
      worst: 0,
      observed: first.slice(0, 160),
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
