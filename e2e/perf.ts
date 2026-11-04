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

/**
 * One long animation frame, attributed by the browser.
 *
 * Chrome's Long Animation Frames API reports, for every frame that took 50ms or more, how long the
 * frame lasted, how much of it blocked the main thread, how much was style and layout, and **which
 * scripts ran** — with their function name and source URL. That is the difference between "the drag
 * is slow" and "this function is why", measured in the environment that is slow rather than inferred
 * from a table of totals.
 */
export type LongFrame = {
  readonly duration: number;
  readonly blocking: number;
  readonly styleAndLayout: number;
  readonly renderStart: number;
  readonly scripts: readonly {
    readonly name: string;
    readonly source: string;
    readonly duration: number;
    readonly invoker: string;
  }[];
};

/** Per-script total inside long frames, for the report. */
export type ScriptCost = {
  readonly name: string;
  readonly source: string;
  readonly ms: number;
  readonly count: number;
};

/** The mutable accumulator behind `ScriptCost`, kept internal so the published type stays read-only. */
type ScriptTotal = { name: string; source: string; ms: number; count: number };

type PageApi = {
  begin: (name: string, kinds: readonly string[]) => void;
  /** Whether the sample for this interaction has landed yet. */
  has: (name: string) => boolean;
  take: (name: string) => readonly InteractionSample[];
  startFrames: () => void;
  stopFrames: () => FrameStats;
  takeLongFrames: () => readonly LongFrame[];
  /** Pointer moves seen since the last drain, plus when they arrived. */
  takePointerMoves: () => readonly number[];
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
    const longFrames: LongFrame[] = [];
    const pointerMoves: number[] = [];

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

    /* Event-timing durations include the wait for the next frame to be presented, so on a slowed
       renderer nearly every continuous event (a `pointermove` in a drag) crosses the threshold and
       the count stops describing anything. Only the discrete inputs a person notices are kept. */
    const observableEvents = ['click', 'dblclick', 'keydown', 'pointerdown', 'pointerup', 'change'];

    const observe = (entryType: 'longtask' | 'event'): void => {
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entryType === 'event' && !observableEvents.includes(entry.name)) continue;
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

    /* Long animation frames name the work. A frame that missed its budget is exactly what this
       benchmark is about, and the entry carries the scripts that ran inside it, so a slow CI run
       answers "what took the time" instead of inviting a guess. Unsupported entry types fall through
       to no attribution rather than failing the benchmark. */
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const frame = entry as unknown as {
            duration: number;
            renderStart: number;
            styleAndLayoutStart: number;
            blockingDuration?: number;
            scripts?: readonly {
              name?: string;
              sourceURL?: string;
              duration?: number;
              invoker?: string;
            }[];
          };
          longFrames.push({
            duration: frame.duration,
            blocking: frame.blockingDuration ?? 0,
            styleAndLayout:
              frame.styleAndLayoutStart > 0 ? frame.renderStart - frame.styleAndLayoutStart : 0,
            renderStart: frame.renderStart,
            scripts: (frame.scripts ?? []).map((script) => ({
              name: script.name ?? '(anonymous)',
              source: script.sourceURL ?? '',
              duration: script.duration ?? 0,
              invoker: script.invoker ?? '',
            })),
          });
        }
      }).observe({ type: 'long-animation-frame' });
    } catch {
      // Older browsers do not report it; the other measurements still stand on their own.
    }

    // Every pointer move is timestamped, so a slow drag can be separated into "events arrived
    // slowly" and "the renderer painted slowly" instead of being blamed on the wrong one.
    window.addEventListener(
      'pointermove',
      (event) => {
        pointerMoves.push(event.timeStamp);
      },
      true,
    );

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
      takeLongFrames() {
        return longFrames.splice(0, longFrames.length);
      },
      takePointerMoves() {
        return pointerMoves.splice(0, pointerMoves.length);
      },
      reset() {
        samples.length = 0;
        observed.length = 0;
        longFrames.length = 0;
        pointerMoves.length = 0;
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

/** Shortens a message for the report without hiding that it was shortened. */
function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

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
 *
 * Failures are kept in two lists, because they mean different things. A **budget miss** is a measured
 * scenario that was slower than the budget it was measured against — that is a finding about the
 * product. A **preparation failure** is a scenario the harness could not drive into the state it
 * needs: no measurement was taken, no budget was compared, and the report says so rather than
 * presenting the absence of a number as a result. Both fail the benchmark; only the first is about
 * speed, and a run that produced no measurements must never read as a run that stayed inside budget.
 */
export class PerfReport {
  private readonly rows: ScenarioRow[] = [];
  private readonly notes: string[] = [];
  /** Measured scenarios that were slower than their budget. */
  private readonly overBudget: string[] = [];
  /** Scenarios that could not be measured at all: a test failure, not a budget verdict. */
  private readonly blocked: string[] = [];

  public constructor(
    private readonly title: string,
    private readonly environment: EnvironmentFacts,
    private readonly directory = 'test-results',
  ) {}

  public add(row: ScenarioRow): void {
    this.rows.push(row);
    if (row.verdict === 'fail') {
      this.overBudget.push(
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
  public fail(scenario: string, phase: string, reason: string): void {
    /* A Playwright failure says what it expected, what it got and where it was waiting on the first
       few lines; the rest is a call log. Those lines are what makes a failure diagnosable from the
       check-run annotation alone, so they are kept rather than reduced to "timed out". */
    const lines = reason
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const summary = truncate(lines.slice(0, 4).join(' | '), 320);
    this.blocked.push(`${scenario} (${phase}): not measured — ${summary}`);
    this.rows.push({
      scenario,
      how: 'the scenario could not be completed',
      phase,
      samples: 0,
      p50: 0,
      p95: 0,
      worst: 0,
      observed: truncate(summary, 220),
      budget: 'scenario must run',
      verdict: 'fail',
    });
    this.write();
  }

  /** Every failure, budget misses first. A non-empty list is what fails the benchmark. */
  public failureLines(): readonly string[] {
    return [...this.overBudget, ...this.blocked];
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
      /* The outcome comes before the table on purpose. This markdown is the failure message of the
         spec, and a check-run annotation is truncated at a few thousand characters: putting the
         verdict first is what makes a red run explain itself in the place a reader actually sees. */
      this.overBudget.length === 0 && this.blocked.length === 0
        ? '**Result: every gated scenario stayed inside its budget.**'
        : [
            this.overBudget.length > 0
              ? `**Result: budget missed by ${String(this.overBudget.length)} scenario(s).**`
              : '**Result: no scenario that was measured missed its budget.**',
            '',
            ...this.overBudget.map((failure) => `- ${failure}`),
            ...(this.blocked.length > 0
              ? [
                  '',
                  `**${String(this.blocked.length)} scenario phase(s) could not be measured.** No budget was compared for these, so this run is not a performance result for them — they are harness failures and are reported as such rather than as slowness:`,
                  '',
                  ...this.blocked.map((failure) => `- ${failure}`),
                ]
              : []),
          ].join('\n'),
      '',
      markdownTable(this.rows),
      '',
      ...this.notes.map((note) => `- ${note}`),
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
        failures: this.failureLines(),
        overBudget: this.overBudget,
        blocked: this.blocked,
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

/**
 * Frame cadence while nothing happens: the benchmark's control group.
 *
 * Every drag number is a gap between animation frames. That gap can grow because the *editing* is
 * slow, or because the machine simply cannot produce frames — a shared two-core runner with the
 * server, the test driver and the browser process on the same cores can miss deadline after
 * deadline with a page that is doing nothing at all. Measuring the idle cadence in the same page,
 * at the same CPU throttle, immediately before the drags gives the drag numbers a denominator: a
 * drag cannot be more responsive than the frame source feeding it, and a run whose idle cadence is
 * already far from a display rate is reporting the environment, not the editor.
 *
 * It is reported, never gated. A slow idle cadence does not excuse a slow drag; it stops the report
 * from blaming the editor for something it does not control.
 */
export async function measureIdleCadence(page: Page, durationMs: number): Promise<FrameStats> {
  await page.evaluate(() => {
    window.__forgePerf.startFrames();
  });
  await page.waitForTimeout(durationMs);
  return page.evaluate(() => window.__forgePerf.stopFrames());
}

/** Drains the long animation frames collected since the last drain. */
export async function takeLongFrames(page: Page): Promise<readonly LongFrame[]> {
  return page.evaluate(() => window.__forgePerf.takeLongFrames());
}

/** Drains the timestamps of pointer moves the page has seen since the last drain. */
export async function takePointerMoves(page: Page): Promise<readonly number[]> {
  return page.evaluate(() => window.__forgePerf.takePointerMoves());
}

/**
 * The scripts that ran inside long frames, by total time.
 *
 * This is the part of the report that says *what* was slow. Names are kept even when the browser
 * reports none, and the source is shortened to its file name so a stack of bundled chunks stays
 * readable in a check-run annotation.
 */
export function describeScriptCosts(frames: readonly LongFrame[], limit = 6): string {
  const totals = new Map<string, ScriptTotal>();
  for (const frame of frames) {
    for (const script of frame.scripts) {
      const key = `${script.name}@${script.source}`;
      const entry = totals.get(key) ?? {
        name: script.name,
        source: script.source.split('/').pop() ?? script.source,
        ms: 0,
        count: 0,
      };
      entry.ms += script.duration;
      entry.count += 1;
      totals.set(key, entry);
    }
  }
  if (totals.size === 0) return 'none attributed';
  return [...totals.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit)
    .map(
      (entry) =>
        `${entry.name} (${entry.source === '' ? 'no source' : entry.source}) ${entry.ms.toFixed(1)} ms over ${String(entry.count)} frame(s)`,
    )
    .join(', ');
}

/**
 * How the pointer events a drag produced were paced in the page.
 *
 * A drag can be slow because the renderer cannot paint, or because the events themselves arrive
 * slowly — a starved test driver on a two-core runner does the second. Reporting the count and the
 * interval between the first and last move separates the two instead of blaming the renderer for the
 * driver.
 */
export function describePointerPacing(moves: readonly number[]): string {
  if (moves.length < 2) return `(${String(moves.length)} event(s), too few to pace)`;
  const first = moves[0] ?? 0;
  const last = moves[moves.length - 1] ?? first;
  const span = last - first;
  const intervals: number[] = [];
  for (let index = 1; index < moves.length; index += 1) {
    intervals.push((moves[index] ?? 0) - (moves[index - 1] ?? 0));
  }
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)] ?? 0;
  return `over ${(span / 1000).toFixed(2)} s (median interval ${median.toFixed(1)} ms)`;
}
