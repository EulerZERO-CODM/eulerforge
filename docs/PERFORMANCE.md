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
- `docs/perf-reports/<short-sha>.md` — the report CI published for a commit, copied verbatim, for every run
  §6 transcribes. The pull-request comment is rewritten on each run rather than appended, so these files
  are what make a quoted number checkable after the next run has replaced it;
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

Preparation is itself verified, because a preparation that only *looks* done is how a benchmark ends up
measuring the wrong thing. Rows are addressed by the layer id stored in the document (never by the name
the row happens to show), every label lookup is scoped to the selection inspector, each inspector commit
is confirmed against the document the application actually saved before the next one is made, a layer
about to be dragged is put back at its fixture frame and made visible and unlocked, and the scenario
fails — with the page's own account of the selection, first in the message — rather than measuring
anything else.

## 6. Measured results

### The two environments these numbers come from

- **CI — the gate.** A GitHub-hosted Ubuntu runner: Node v22.23.3, Chromium 156.0.8078.4 (Playwright's own
  build), 2 vCPU AMD EPYC (the run below reports a 7763; earlier runs on the same workflow reported a 9V74
  and a 9V45 — see “Runner variance”), viewport 1440 × 960 at device pixel ratio 2. The
  `Browser (Chromium)` job runs this benchmark against the production build and fails the pull request when
  a *gated* scenario misses its budget. This environment's numbers are the acceptance evidence.
- **A development sandbox — reproduction and iteration.** Node v22.22.3, Chromium 153.0.8010.0, 2 vCPU
  Intel Xeon @ 2.60 GHz. The sandbox cannot reach Playwright's browser CDN, so it runs a Chromium taken
  from the `@sparticuz/chromium` npm package — a different build from CI's. It is the right place to
  reproduce *behaviour* (locators, preparation, history state) and the wrong place to compare timings with
  CI.
- **No mid-range laptop has run this benchmark.** The four-fold throttle stands in for that hardware; §4
  says what the proxy can and cannot mean.

Every run's report header names its own environment — runtime, browser build, CPU model and core count —
and the commit it measured (`GITHUB_HEAD_SHA` in CI, `local` in the sandbox).

### The acceptance run: CI, both phases, all twelve scenarios

Every complete CI run of this benchmark that has a durable report, newest first. `43c4008` is the commit
that fixed the harness's preparation; **every commit after it changes documentation only**, so `9eb530e`,
`5a81f69`, `a585815`, `ec28a27`, `bd9e4bc`, `712356f` and anything that follows them measure
byte-identical application code with a byte-identical benchmark — each row below is the same measurement,
repeated, on a different runner instance.

| Run | Workflows — pull request · push | Browser (Chromium) jobs | Verdict | Report |
| --- | --- | --- | --- | --- |
| `712356f` | [38903342825](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38903342825) · [38903334641](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38903334641) | `116980722368` · `116980696527`, both **success** | every gated scenario inside its budget | [`perf-reports/712356f.md`](perf-reports/712356f.md) |
| `bd9e4bc` | [38902518079](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38902518079) · [38902512572](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38902512572) | `116977966407` · `116977948966`, both **success** | every gated scenario inside its budget | [`perf-reports/bd9e4bc.md`](perf-reports/bd9e4bc.md) |
| `ec28a27` | [38901511905](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38901511905) · [38901506376](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38901506376) | `116974623843` · `116974642009`, both **success** | every gated scenario inside its budget | [`perf-reports/ec28a27.md`](perf-reports/ec28a27.md) |
| **`a585815`** ← transcribed below | [38884557554](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38884557554) · [38884551247](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38884551247) | `116919037368` · `116919016584`, both **success** | 44 browser specs passed; every gated scenario inside its budget | [`perf-reports/a585815.md`](perf-reports/a585815.md) |
| `5a81f69` | [38883655191](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38883655191) · [38883648322](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38883648322) | `116916083301` · `116916061574`, both **success** | every gated scenario inside its budget | not archived — see the note below |
| `9eb530e` | [38882742579](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38882742579) · [38882736633](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38882736633) | `116913092201` · `116913111091`, both **success** | every gated scenario inside its budget | not archived; key rows transcribed below |
| `43c4008` | [38881828160](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38881828160) · [38881820021](https://github.com/EulerZERO-CODM/eulerforge/actions/runs/38881820021) | `116910114267` · `116910141359`, both **success** | 44 browser specs passed (5.0 m); every gated scenario inside its budget | not archived; key rows transcribed below |

Every run in this table has a copy of its report in `docs/perf-reports/`, named for the commit CI measured,
so the numbers in this section stay checkable after the browser job rewrites the live comment. A
documentation-only push is still a push, so CI benchmarks it and rewrites the comment again: the live comment
can therefore be **newer** than the last row here, and its header names the commit it measured. The table is
the list of runs whose reports were archived, not a claim to contain the newest run in existence. The runs
marked “not archived” predate the archive convention.

The numbers below are the run CI published for **`a585815`**, transcribed from its report without editing
a digit. That report is archived verbatim in [`docs/perf-reports/a585815.md`](perf-reports/a585815.md),
because the browser job rewrites **one** comment per pull request instead of adding a new one: the live
comment always holds the newest run's report, so a number is only quotable for as long as it stays newest
unless a copy is kept. Every report transcribed into this section gets such a file, named for the commit CI
measured.

- Commit: `a585815d1be7c1134e314b512f7ab8163a84c9fc`
- Browser: Chromium 156.0.8078.4 (Playwright) · Runtime: Node v22.23.3 on linux x64
- CPU: 2 vCPU — AMD EPYC 7763 64-Core Processor (GitHub-hosted Ubuntu runner)
- Gated phase: CDP `Emulation.setCPUThrottlingRate: 4`, 12 interaction samples and 5 drag samples per
  scenario, after one unrecorded warm-up pass
- Report as published: [`docs/perf-reports/a585815.md`](perf-reports/a585815.md) · job `116919037368`

**Result: every gated scenario stayed inside its budget.**

| Scenario | Phase | n | p50 | p95 | worst |
| --- | --- | ---: | ---: | ---: | ---: |
| `select-layer` | throttled | 12 | 24.2 ms | 39.1 ms | 39.1 ms |
| `select-group` | throttled | 12 | 23.6 ms | 40.0 ms | 40.0 ms |
| `hide-layer` | throttled | 12 | 25.1 ms | 56.8 ms | 56.8 ms |
| `lock-layer` | throttled | 12 | 23.5 ms | 40.6 ms | 40.6 ms |
| `inspector-x` | throttled | 12 | 47.1 ms | 64.1 ms | 64.1 ms |
| `inspector-width` | throttled | 12 | 47.2 ms | 63.6 ms | 63.6 ms |
| `opacity-key` | throttled | 12 | 26.1 ms | 51.2 ms | 51.2 ms |
| `undo` | throttled | 12 | 49.9 ms | 59.7 ms | 59.7 ms |
| `redo` | throttled | 12 | 40.0 ms | 66.5 ms | 66.5 ms |
| `drag-layer` | throttled | 5 | 16.7 ms | 16.8 ms | 33.4 ms |
| `drag-group` | throttled | 5 | 16.7 ms | 16.8 ms | 33.3 ms |
| `resize-handle` | throttled | 5 | 16.7 ms | 16.8 ms | 33.4 ms |

The three drag rows are **gaps between animation frames**, not interaction latency: 16.7 ms is one frame at
60 Hz, so the drags kept painting at display rate. Pooled over the run: 427 gaps for `drag-layer`, 399 for
`drag-group`, 340 for `resize-handle`, with **0 % of them over 50 ms** in all three. Long tasks were 0–9 per
scenario with a worst single block of 64 ms (`redo`) against the 600 ms freeze budget — one order of
magnitude away from “frozen”. Input events over 16 ms ran 28–150 per scenario with a worst of 152 ms, and
the slowest single interaction in the run was 66.5 ms (`redo`) against the 500 ms worst-case budget.

The same run's unthrottled phase, published for context and deliberately **not** gated — GitHub runners vary,
so gating on the fast phase would make the benchmark flaky rather than informative: interactions p50
22.2–53.1 ms and p95 22.5–63.4 ms; drag gaps p50 16.7 ms with a worst of 50.0 ms over 276 / 251 / 224 gaps,
0 % over 50 ms.

The runs that followed — `ec28a27`, `bd9e4bc` and `712356f`, all documentation-only, so the same application
and the same harness — are archived beside it and land in the same band on different runner instances:

| Archived run | Gated interactions, p95 range | `select-layer` p95 | `undo` p95 | `redo` p95 | Drag gaps (5 drags each) | Longest block |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| `712356f` | 16.7–66.6 ms | 41.7 ms | 66.6 ms | 51.6 ms | 433 / 399 / 339, 0 % over 50 ms | 58 ms |
| `bd9e4bc` | 16.7–86.1 ms | 27.9 ms | 86.1 ms | 48.5 ms | 370 / 391 / 308, 0 % over 50 ms | 83 ms |
| `ec28a27` | 41.2–66.2 ms | 42.7 ms | 54.1 ms | 54.4 ms | 430 / 403 / 333, 0 % over 50 ms | 106 ms |

The reported CPU moves between runs on identical code: `bd9e4bc` ran on an AMD EPYC **9V45**, `abc7982` on a
9V74, and `a585815`, `ec28a27`, `43c4008` and `712356f` on a 7763. That is the runner class changing under the
job, not the application changing under the benchmark — which is why the budget is a regression gate rather
than a stopwatch. Every one of these rows is inside the same fixed budget.

For comparison, the earlier complete run transcribed at the time — `43c4008`, the run that fixed the harness
— reported `select-layer` 18.8 / 37.7 ms, `undo` 40.2 / 49.6 ms and `redo` 38.0 / 62.6 ms p50 / p95, with
drag gaps 431, 398 and 338 at a 16.7 ms median and 0 % over 50 ms. Same shape, different runner: this is a
regression gate, not a stopwatch, and a number from one run is never evidence about a machine class.

### The same harness in the sandbox, for reproduction

The identical scenarios were run in the sandbox against the production build, under the same throttle and
the same sample counts, three times in a row while the fix was being verified — the last of which reported:

| Scenario | Phase | n | p50 | p95 | worst |
| --- | --- | ---: | ---: | ---: | ---: |
| `select-layer` | throttled | 12 | 23.6 ms | 40.8 ms | 40.8 ms |
| `select-group` | throttled | 12 | 24.5 ms | 42.2 ms | 42.2 ms |
| `hide-layer` | throttled | 12 | 23.9 ms | 38.2 ms | 38.2 ms |
| `lock-layer` | throttled | 12 | 25.2 ms | 42.2 ms | 42.2 ms |
| `inspector-x` | throttled | 12 | 28.0 ms | 48.6 ms | 48.6 ms |
| `inspector-width` | throttled | 12 | 27.2 ms | 86.3 ms | 86.3 ms |
| `opacity-key` | throttled | 12 | 25.2 ms | 48.3 ms | 48.3 ms |
| `undo` | throttled | 12 | 35.6 ms | 46.1 ms | 46.1 ms |
| `redo` | throttled | 12 | 34.6 ms | 59.8 ms | 59.8 ms |
| `drag-layer` | throttled | 5 | 16.7 ms | 16.8 ms | 33.4 ms |
| `drag-group` | throttled | 5 | 16.7 ms | 16.8 ms | 33.4 ms |
| `resize-handle` | throttled | 5 | 16.7 ms | 16.7 ms | 16.8 ms |

Same picture: every gated scenario inside its budget, drag gaps at display rate, 0 % over 50 ms. It is
published because it shows the harness is reproducible outside CI — not as a substitute for the CI runs
above, whose browser build, CPU and runner class are different, and not as evidence about any particular
machine.

### Historical: the CI failure these measurements replaced, and why it failed

Everything in this subsection is **history**, kept because the fix is only credible with the failure it
fixed. `abc7982` is not the head of anything and its numbers are not a current result.

Before the fix, CI kept failing the same job on a *preparation*, not on latency. At `abc7982` the job
(Browser (Chromium) check run `116862619447`) measured eleven scenarios and could not prepare the twelfth:

| Scenario | n | p50 | p95 | worst | Job outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| `select-layer` | 12 | 25.4 ms | 44.4 ms | 44.4 ms | pass |
| `select-group` | 12 | 25.2 ms | 41.6 ms | 41.6 ms | pass |
| `hide-layer` | 12 | 25.8 ms | 42.7 ms | 42.7 ms | pass |
| `lock-layer` | 12 | 25.6 ms | 42.0 ms | 42.0 ms | pass |
| `inspector-x` | 12 | 32.2 ms | 51.6 ms | 51.6 ms | pass |
| `inspector-width` | 12 | 47.8 ms | 59.5 ms | 59.5 ms | pass |
| `opacity-key` | 12 | 43.1 ms | 70.8 ms | 70.8 ms | pass |
| `undo` | 12 | 25.4 ms | 25.9 ms | 25.9 ms | pass |
| `redo` | 12 | 36.7 ms | 54.0 ms | 54.0 ms | pass |
| `drag-layer` | 5 | 16.7 ms | 16.7 ms | 16.8 ms | pass |
| `drag-group` | 5 | 16.7 ms | 16.7 ms | 33.3 ms | pass |
| `resize-handle` | 0 | — | — | — | **not measured** |

The job failed, and that is the correct outcome: `resize-handle` was never driven into the state it
measures, so the benchmark had no result to report for it — a preparation failure is a *test* failure and
is never counted as a fast measurement. The report said so in its own words (“1 scenario phase(s) could not
be measured”), the failing row read `scenario must run`, and the check-run annotation carried the selection
state the page reported at that moment.

Four harness defects in the *old harness* were behind it — the current one is described in “The acceptance
run” above:

1. Rows were found by the layer's *name*. The name-keyed lookup stopped resolving the moment the layer was
   renamed by something else, turning a measurement into a twenty-second timeout that described nothing.
2. Inspector fields were addressed document-wide (`getByLabel('Layer name')`), which is ambiguous by
   construction in a document with ten text layers.
3. A preparation step could *look* done — a field showing the value it was filled with — while the commit
   behind it had not reached the document: two inspector commits issued back-to-back can race, because the
   second handler still closes over the frame from before the first.
4. The resize scenario did not reset the layer's frame between samples, and `page.mouse` does not hit-test:
   once the handle had been dragged past the artboard's edge, the next sample's press landed on the
   inspector rail, and Chromium dragged the “Layer name” label's text into the name field — renaming a
   layer of the document under measurement. That rename is what broke the name-keyed lookups in (1); §8
   records the reproduction in full.

The harness now addresses rows by the id in the document, scopes every label lookup to the selection
inspector, resets the frames a scenario depends on before every sample and confirms each committed value
against the document the application saved, verifies that the row it selected is the row the inspector is
editing, checks with the page's own hit test that a raw pointer press really is aimed at the control it
means to press, and fails a scenario if the document it is measuring is no longer the fixture document
(§8).

### Runner variance, stated plainly

`select-layer`, in every CI run of this benchmark on this branch whose numbers were transcribed at the time:

| Run | `select-layer` p50 | `select-layer` p95 | `undo` p95 | `redo` p95 | Harness |
| --- | ---: | ---: | ---: | ---: | --- |
| `712356f` | 24.9 ms | 41.7 ms | 66.6 ms | 51.6 ms | fixed (documentation-only commit) |
| `bd9e4bc` | 25.7 ms | 27.9 ms | 86.1 ms | 48.5 ms | fixed (documentation-only commit) |
| `ec28a27` | 25.5 ms | 42.7 ms | 54.1 ms | 54.4 ms | fixed (documentation-only commit) |
| `a585815` (transcribed in §6) | 24.2 ms | 39.1 ms | 59.7 ms | 66.5 ms | fixed |
| `43c4008` | 18.8 ms | 37.7 ms | 49.6 ms | 62.6 ms | fixed |
| `9eb530e` | 24.5 ms | 40.7 ms | 68.2 ms | 68.0 ms | fixed (documentation-only commit) |
| `abc7982` | 25.4 ms | 44.4 ms | 25.9 ms | 54.0 ms | pre-fix; `resize-handle` never measured |
| `085f79a` | 39.8 ms | 43.1 ms | — | — | pre-fix, earlier |

That is a spread of more than a factor of two on identical application code, with every run passing
whichever rows it managed to measure. Two things about this table are deliberate:

- **It lists only runs whose numbers were written down when they ran.** The browser job rewrites one
  comment per pull request, so an earlier run's report is *replaced*, not added to. `5a81f69` passed the
  same benchmark on the same code, and its figures are no longer quotable anywhere: they were not copied out
  before the next run overwrote them. That is why `a585815`, `ec28a27`, `bd9e4bc` and `712356f` have files
  under `docs/perf-reports/`, and why every run transcribed from here on gets one.
- **`abc7982` is a pre-fix run**, shown for the trend in the rows it *did* measure (eleven of twelve): it is
  not a complete result and its `undo`/`redo` figures come from a different sequence of preceding edits.

Shared CI runners have real, measurable variance, which is why the budget sits an order of magnitude above
the observed cost rather than a margin around it, and why a single number from a single run is never the
whole story. What the benchmark is for is catching a *gross* regression — a doubled critical path, a
per-frame re-plan, a synchronous decode — not adjudicating 15 ms.

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

- **No mid-range laptop has run this benchmark.** The numbers in this document come from a shared CI
  runner and from a 2-vCPU sandbox container with a 153-build of Chromium; neither is a laptop. The 4×
  throttle is a proxy and stands for CPU-bound main-thread work only (see §4), and a machine that
  thermally throttles or swaps will behave worse than either environment without this benchmark saying by
  how much.
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
  reported* — it does not silently measure something else, and it does not touch the budget. The run's
  gate is `expect(report.failureLines(), report.markdown()).toEqual([])`, so a scenario that never ran
  cannot be mistaken for a scenario that passed: it prints `scenario must run` and fails the job.
- **The measured document is checked to still be the fixture.** Before each measurement the harness
  asserts that the layer it is about to select carries the name the fixture gave it, and after every
  scenario it compares every layer name in the saved document with the fixture. A renamed layer is
  reported as a failure of that scenario rather than published as a measurement of "the thirty-layer
  fixture".
- **The harness renamed a document layer once, and the cause is now known and guarded.** In the CI run
  of `abc7982` the layer `Content card` was persisted as `ContLayer nameent card`, and the benchmark then
  failed to prepare the next scenario that addressed a row by name. It was reproduced locally by running
  the pre-fix harness with the page instrumented, which recorded the exact sequence:

  ```
  [drift] keydown key="Enter" on BUTTON[layer-name-lyr-30-2]
  [drift] drop data="" on INPUT[_r_cd_] value="Content card"
  [drift] beforeinput data="Layer name\n" on INPUT[_r_cd_] value="Content card"
  [drift] input data="Layer name" on INPUT[_r_cd_] value="ContLayer nameent card"
  ```

  A native drag-and-drop, not a keystroke: the resize scenario did not reset the layer's frame between
  samples, so after the first sample the handle's box sat *outside* the artboard (measured: surface
  `right 802.5, bottom 628.4`; handle centre `833.1, 629.4`). `page.mouse` presses exactly where it is
  told and does not hit-test, so the next sample's press landed on the inspector rail — on the
  “Layer name” label — and Chromium turned the press-and-move into a drag of that label's text, dropping
  it into the name field and renaming the layer.

  The harness now (a) puts the layer back at its fixture frame before every sample, (b) verifies each
  committed value against the document the application saved, (c) chooses a press point that the page's
  own hit test says really is the control (`pressPoint`), (d) refuses a drag whose start point is not on
  the artboard, (e) drops any text selection before a pointer scenario, and (f) checks after every
  scenario that the document is still the fixture document, so a rename of any origin fails the
  benchmark loudly instead of being published as a measurement.
- **One document shape.** A 1600 × 1100 canvas with 30 layers is one point in the space; a document with
  a single huge image layer, or a hundred text layers, is not covered.
