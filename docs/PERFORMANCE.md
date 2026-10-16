# Performance: the thirty-layer benchmark

Phase 2's exit criterion says editing a thirty-layer document stays responsive. Responsiveness is a
claim about a machine and a clock, so it is not asserted in a document — it is measured, in a real
browser, against a budget that was written down before the first measurement and has not been widened
since.

This file records the method, the thresholds, the measured results, the environment those results came
from, and — just as important — what the proxy used to obtain them can and cannot stand for.

- Benchmark: `e2e/performance.spec.ts` (Playwright, Chromium, production build)
- Instrumentation: `e2e/perf.ts` (page-side, injected by the test, never imported by the application)
- Pixel check: `e2e/pixels.ts` (proves the artwork was really painted, not just planned)
- Fixture: `src/testing/thirty-layers.ts` and its own test `src/testing/thirty-layers.test.ts`

## 1. What is measured

Three measurements, each answering a different complaint a person would make about a slow editor.

| Measurement | Question it answers | Where the clock comes from |
| --- | --- | --- |
| **Interaction latency** | "How long after I clicked/pressed the key did the result appear?" | The input event's own `timeStamp` to the **second** animation frame after it, measured in the page |
| **Frame gaps during a drag** | "Does the canvas move smoothly while I drag?" | Intervals between consecutive animation frames while the pointer keeps moving |
| **Long tasks and slow events** | "Why did the two above get worse?" | `PerformanceObserver` `longtask` entries (main-thread task > 50 ms) and `event` entries (discrete input > 16 ms) |

Latency deliberately stops on the frame *after* the first frame following the input. A frame that
arrives while the main thread is still busy is not yet showing the finished result, and stopping on it
would flatter the implementation.

Only **discrete** input events are counted in the slow-event metric (`click`, `dblclick`, `keydown`,
`pointerdown`, `pointerup`, `change`). Pointer-move events are continuous by nature — a person moving a
mouse produces hundreds of them — so counting them would report a busy pointer as a slow application.

## 2. The document

`src/testing/thirty-layers.ts` builds one deterministic document for every run:

- a **1600 × 1100** poster-sized canvas (`THIRTY_LAYER_CANVAS`), which is where thirty layers stop
  being trivially cheap;
- **thirty layers in four types** — 7 rectangles, 3 ellipses, 10 text layers, 10 placed catalogue
  graphics (`THIRTY_LAYER_COUNTS`, `THIRTY_LAYER_TOTAL = 30`);
- built through the editor's **own commands** (`addLayerCommand`, `placeAssetCommand`,
  `renameLayerCommand`, `setLayerFramesCommand`, the text and shape settings commands), not by
  hand-writing an object that the editor might not accept;
- fixed ids and fixed timestamps (`now: () => NOW`), so two builds are byte-identical;
- real catalogue files from `public/forge-assets/`, each carrying its licence record — the ten placed
  graphics also mean ten attribution records in the document;
- text layers with real copy, wrapped by the application's own metric-based line breaking.

`src/testing/thirty-layers.test.ts` guards the fixture: the counts, the id uniqueness, the byte-identical
rebuild, that the render plan really paints thirty layers with real font metrics and the repository's
own asset files, and that the copy is long enough for wrapping to be exercised.

The benchmark opens that document the way the application would: the record is seeded into
`localStorage` (`eulerforge.v1.documents`) before the app boots, the workspace is opened by URL, and the
spec then waits until no graphic is still loading and none failed. `select-layer`-style assertions are
made against the layer list the application renders, not against the fixture.

Before any measurement, a second test proves the browser really **painted** the artwork: it samples the
canvas (`countColours`, `readInkBands` in `e2e/pixels.ts`) and requires a colour count in the artwork
that a blank or solid surface cannot produce. A benchmark on a canvas that silently failed to draw
would measure nothing.

## 3. The budget

Written before the first measurement and never adjusted to fit a result.

| Phase | Metric | Threshold |
| --- | --- | --- |
| Throttled (gated) | Interaction latency | p95 ≤ **200 ms**, worst ≤ **500 ms** |
| Throttled (gated) | Frame gap during a drag | p95 ≤ **100 ms**, worst ≤ **400 ms**, ≤ **20 %** of gaps over 50 ms |
| Throttled (gated) | Longest single main-thread block | ≤ **600 ms** |
| Unthrottled | Everything | reported, not gated |

Why these numbers:

- **200 ms p95 / 500 ms worst** for a discrete interaction. A healthy interaction in a thirty-layer
  document is a few milliseconds of work; even at a four-fold CPU slowdown that leaves an order of
  magnitude of headroom, so anything that trips it is a regression rather than noise. For scale, Web
  Vitals calls 200 ms a *good* response on unmodified hardware.
- **100 ms p95 between frames**, and at most a fifth of gaps past 50 ms. A drag that paints every
  100 ms is visibly jerky; demanding 16 ms under a four-fold slowdown would be false precision.
- **600 ms** for the longest main-thread block. This is where "slow" becomes "frozen", and it is the one
  number that must not be traded away.

The rule for future maintainers: **only tighten these, and only with evidence from a run that passed.**
A failure here is a finding about the product. Widening the budget to make a red run green would delete
the only thing the benchmark exists to say.

## 4. The controlled slowdown

The gated phase runs with the DevTools protocol's CPU throttling at **4×**
(`Emulation.setCPUThrottlingRate`, see `throttleCpu` in `e2e/perf.ts`). A GitHub-hosted runner is a
shared 2-vCPU machine, not the machine a designer uses, and CI hardware is usually *faster* and more
consistent than a mid-range laptop; without a slowdown the benchmark would mostly prove that fast
hardware is fast.

**What the proxy does stand for:** it multiplies the cost of main-thread JavaScript, style, layout and
paint work, which is exactly where the risks live in an editor like this one — render-plan construction,
React re-renders, state updates, image handling. A regression that makes the critical path twice as
expensive shows up in this phase.

**What it does not stand for:** it does not slow the GPU or the compositor, it does not reproduce a
laptop's thermal throttling, memory pressure, disk or network latency, it does not model a different
CPU micro-architecture, and 4× is a multiplier on an unknown baseline rather than a simulation of any
particular device. It is a **regression gate**, not a claim about a specific machine.

**Therefore:** this repository does not claim that mid-range-laptop performance was verified. What has
been verified is that the measured interactions stay inside a fixed budget on CI hardware under a
four-fold slowdown. A measurement on real hardware would be a welcome addition and is not something
this project has evidence for.

## 5. Running it

```bash
npm ci
npx playwright install chromium      # needs the browser CDN
npm run build                        # the benchmark measures the production build
npm run test:e2e -- performance      # or: npx playwright test e2e/performance.spec.ts
```

The suite starts the production server itself (`playwright.config.ts`: `npm run start`, port 3120,
1440 × 960 at DPR 2, one worker, no retries). Running the whole benchmark takes about four minutes
including the warm-up.

The benchmark writes two artefacts and one comment:

- `test-results/perf-report.md` and `test-results/perf-report.json` — written after **every** row, so a
  run that fails halfway still publishes what it managed to measure;
- a pull-request comment (marker `<!-- eulerforge-perf-report -->`) published by the browser job in
  `.github/workflows/ci.yml`, including when the job fails;
- the same markdown as the assertion message, so a red check-run annotation carries its own evidence.

### Samples per scenario

| Phase | Interaction scenarios | Drag scenarios |
| --- | --- | --- |
| Throttled (gated) | 12 samples | 5 drags |
| Unthrottled (reported) | 6 samples | 3 drags |

Each phase runs the full scenario list **once unrecorded** first. The first pass in a phase pays for
caches, decoded graphics and JIT warm-up; folding that into the recorded samples would report cold-start
cost as steady-state behaviour.

Twelve scenarios are measured: `select-layer`, `select-group`, `hide-layer`, `lock-layer`, `inspector-x`,
`inspector-width`, `opacity-key`, `undo`, `redo` (interaction latency) and `drag-layer`, `drag-group`,
`resize-handle` (frame gaps). Drag scenarios report the pooled gap distribution over all their drags, so
"n" is the number of drags and the p95 is over every gap those drags produced.

One scenario failing does not abort the run: each is measured inside its own guard, a broken
preparation step records a failure row, and the next scenario still runs. The final gate is
`expect(report.failureLines(), report.markdown()).toEqual([])`, so a red run always shows the table it
was based on.

## 6. Measured results

### Environment

Every browser measurement in this repository so far comes from CI, because the sandbox used to develop
it cannot download a Chromium binary (the browser CDN is blocked) — see the limitations section. The
numbers below are therefore **CI numbers**, and the report header repeats the environment for each run:

- Runtime: Node v22.23.3 on linux x64
- Browser: Chromium 156.0.8078.4 (Playwright)
- CPU: 2 vCPU — AMD EPYC 9V45 96-Core Processor (GitHub-hosted Ubuntu runner)
- Viewport: 1440 × 960 at device pixel ratio 2
- Gated phase: `Emulation.setCPUThrottlingRate: 4`

### Gated (throttled) phase

Measured by the CI run of `4d00ff2` (the run that also fixed the harness assertions this table was
published with; the measured application code and the fixture are the same). All twelve scenarios
passed:

| Scenario | What the user does | n | p50 | p95 | worst |
| --- | --- | ---: | ---: | ---: | ---: |
| `select-layer` | click a layer in the layer list | 12 | 25.5 ms | 28.1 ms | 28.1 ms |
| `select-group` | shift-click a second layer into the selection | 12 | 24.8 ms | 26.1 ms | 26.1 ms |
| `hide-layer` | click Hide on a layer row | 12 | 25.8 ms | 63.5 ms | 63.5 ms |
| `lock-layer` | click Lock on a layer row | 12 | 26.1 ms | 42.6 ms | 42.6 ms |
| `inspector-x` | commit a new X in the inspector with Enter | 12 | 32.0 ms | 48.2 ms | 48.2 ms |
| `inspector-width` | commit a new width in the inspector with Enter | 12 | 26.1 ms | 73.5 ms | 73.5 ms |
| `opacity-key` | press an arrow key on the opacity slider | 12 | 29.0 ms | 44.0 ms | 44.0 ms |
| `undo` | undo an edit from the history panel | 12 | 25.5 ms | 27.8 ms | 27.8 ms |
| `redo` | redo an edit from the history panel | 12 | 32.9 ms | 69.2 ms | 69.2 ms |
| `drag-layer` | drag one text layer across the canvas | 5 | 16.7 ms | 16.7 ms | 16.8 ms |
| `drag-group` | drag a three-layer selection | 5 | 16.7 ms | 16.7 ms | 16.8 ms |
| `resize-handle` | drag the bottom-right handle to resize a layer | 5 | 16.7 ms | 16.7 ms | 16.8 ms |

(Drag rows show the **gap between animation frames**, not the latency of one interaction: 16.7 ms is
one frame at 60 Hz, which means the drag kept painting at display rate. Frame gaps over 50 ms: 0 % in
all three drag scenarios through the run — 382 pooled gaps for `drag-layer`, 392 for `drag-group`.)

Observed alongside the latency: long tasks were 0–2 per phase with a worst block of 60–76 ms, far below
the 600 ms freeze budget, and discrete input events over 16 ms ran between 25 and 144 per scenario with
a worst of 112 ms. No scenario came near a threshold.

### Unthrottled phase (context, not gated)

Same scenarios at full speed, half the samples: `select-layer` p50 24.5 ms / p95 25.7 ms,
`hide-layer` 25.0 / 41.3, `lock-layer` 24.8 / 26.3, `undo` 25.0 / 33.0, `redo` 24.3 / 28.3. The
unthrottled phase is published because it shows how much of the cost is the slowdown itself, and it is
deliberately not a gate: on a shared runner the fast phase is the one most exposed to a noisy neighbour,
so gating on it would make the benchmark flaky rather than informative.

### Runner variance, stated plainly

An earlier CI run on the same document (`085f79a`) reported `select-layer` p50 **39.8 ms** / p95
**43.1 ms**, where `4d00ff2` reported 25.5 / 28.1 — a difference of about 60 % on identical application
code and the same fixture. Both runs passed. Shared CI runners have real, measurable variance, which is
why the budget is set an order of magnitude above the observed cost rather than a margin around it, and
why a single number from a single run is never the whole story. What the benchmark is for is catching a
*gross* regression — a doubled critical path, a per-frame re-plan, a synchronous decode — not for
adjudicating 15 ms.

## 7. What was profiled, and why nothing was optimised

Before writing the benchmark, the render and interaction paths were measured directly (Node, via
`vite-node`, over the pure functions the editor calls) on the same thirty-layer scene:

| Step | p50 | p95 |
| --- | ---: | ---: |
| `buildRenderPlan` | 2.02 ms | 2.22 ms |
| `paintPlan` | 1.13 ms | (not sampled) |
| plan + paint together | 3.29 ms | (not sampled) |
| `resolveGesture` (1 layer / 30 layers) | 0.03 ms | 0.09 ms |
| one document commit | 0.07 ms | (not sampled) |

The only large number was a **cold** `paintPlan` at 458 ms, which is first-call cost — graphics decode and
the canvas context warming up — and is exactly the cost the benchmark's unrecorded warm-up pass exists to
keep out of the recorded samples.

There was no hot spot to fix, so none was fixed: no speculative architecture rewrite, no change to the
render plan, no edit to the gesture path. Optimising where the evidence does not point is how an editor
gets a benchmark-shaped bug. What the profiling did produce is the coalescing work already in the
history (`replaceLatest` with an explicit coalescing key for a single interaction, so a drag or a slider
is one undo step), which is a correctness fix first and a cost fix second.

## 8. Limitations

- **No mid-range laptop has run this benchmark.** All browser numbers are CI numbers. The 4× throttle is
  a proxy and stands for CPU-bound main-thread work only (see above).
- **Chromium only.** Firefox and WebKit are unverified, including for timing.
- **No GPU/thermal/memory modelling.** A device that thermally throttles or swaps will behave worse than
  these numbers, and this benchmark would not predict by how much.
- **Weak hardware detection.** The report prints the runner's CPU model and core count; it does not
  normalise for them, so runs on different runner classes should be compared as separate series.
- **Small samples by design.** Twelve interaction samples and five drags per phase are enough to catch a
  gross regression on a fast path and not enough to make fine distinctions; the p50/p95/worst triple is
  reported rather than a mean precisely so the spread is visible.
- **Preparation failures are test failures, not budget failures.** If the workspace cannot be driven into
  the state a scenario needs, the scenario is recorded as failed *with the selection state the page
  reported* — it does not silently measure something else, and it does not touch the budget.
- **One document shape.** A 1600 × 1100 canvas with 30 layers is one point in the space; a document with
  a single huge image layer, or a hundred text layers, is not covered.
