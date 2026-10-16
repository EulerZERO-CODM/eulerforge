<!--
The report CI published for this commit, copied verbatim from the browser job's comment on
pull request #2 (marker `<!-- eulerforge-perf-report -->`). The job rewrites that one comment on
every run, so this file is the durable copy.
Commit: bd9e4bc9d88ebcb7eaac64a8230013633d79f2f3
Workflows: pull request 38902518079 · push 38902512572
-->

<!-- eulerforge-perf-report -->

### Thirty-layer responsiveness (production build, in Chromium)

- Runtime: Node v22.23.3 on linux x64
- Browser: Chromium 156.0.8078.4 (Playwright)
- CPU: 2 vCPU — AMD EPYC 9V45 96-Core Processor
- Commit: bd9e4bc9d88ebcb7eaac64a8230013633d79f2f3

**Result: every gated scenario stayed inside its budget.**

| Scenario | What the user does | Phase | n | p50 | p95 | worst | Observed | Budget | Result |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| `select-layer` | click a layer in the layer list | throttled | 12 | 25.7 ms | 27.9 ms | 27.9 ms | long tasks 0 (worst 0 ms), input events over 16 ms 36 (worst 48 ms) | p95 200 ms / worst 500 ms | pass |
| `select-group` | shift-click a second layer into the selection | throttled | 12 | 27.1 ms | 28.3 ms | 28.3 ms | long tasks 0 (worst 0 ms), input events over 16 ms 72 (worst 40 ms) | p95 200 ms / worst 500 ms | pass |
| `hide-layer` | click Hide on a layer row | throttled | 12 | 27.3 ms | 43.8 ms | 43.8 ms | long tasks 0 (worst 0 ms), input events over 16 ms 72 (worst 72 ms) | p95 200 ms / worst 500 ms | pass |
| `lock-layer` | click Lock on a layer row | throttled | 12 | 27.8 ms | 29.4 ms | 29.4 ms | long tasks 0 (worst 0 ms), input events over 16 ms 72 (worst 64 ms) | p95 200 ms / worst 500 ms | pass |
| `inspector-x` | commit a new X in the inspector with Enter | throttled | 12 | 23.4 ms | 41.9 ms | 41.9 ms | long tasks 0 (worst 0 ms), input events over 16 ms 36 (worst 72 ms) | p95 200 ms / worst 500 ms | pass |
| `inspector-width` | commit a new width in the inspector with Enter | throttled | 12 | 29.0 ms | 60.0 ms | 60.0 ms | long tasks 2 (worst 56 ms), input events over 16 ms 36 (worst 88 ms) | p95 200 ms / worst 500 ms | pass |
| `opacity-key` | press an arrow key on the opacity slider | throttled | 12 | 19.5 ms | 32.7 ms | 32.7 ms | long tasks 0 (worst 0 ms), input events over 16 ms 34 (worst 56 ms) | p95 200 ms / worst 500 ms | pass |
| `undo` | undo an edit from the history panel | throttled | 12 | 32.6 ms | 86.1 ms | 86.1 ms | long tasks 1 (worst 74 ms), input events over 16 ms 72 (worst 112 ms) | p95 200 ms / worst 500 ms | pass |
| `redo` | redo an edit from the history panel | throttled | 12 | 30.3 ms | 48.5 ms | 48.5 ms | long tasks 0 (worst 0 ms), input events over 16 ms 141 (worst 72 ms) | p95 200 ms / worst 500 ms | pass |
| `drag-layer` | drag one text layer across the canvas (370 frame gaps over 5 drags) | throttled | 5 | 16.7 ms | 16.8 ms | 16.8 ms | long tasks 0 (worst 0 ms), input events over 16 ms 48 (worst 72 ms), 0% of gaps over 50 ms | p95 100 ms / worst 400 ms, ≤ 20% over 50 ms | pass |
| `drag-group` | drag a three-layer selection (391 frame gaps over 5 drags) | throttled | 5 | 16.7 ms | 16.8 ms | 33.3 ms | long tasks 0 (worst 0 ms), input events over 16 ms 150 (worst 72 ms), 0% of gaps over 50 ms | p95 100 ms / worst 400 ms, ≤ 20% over 50 ms | pass |
| `resize-handle` | drag the bottom-right handle to resize a layer (308 frame gaps over 5 drags) | throttled | 5 | 16.7 ms | 16.7 ms | 16.8 ms | long tasks 0 (worst 0 ms), input events over 16 ms 45 (worst 72 ms), 0% of gaps over 50 ms | p95 100 ms / worst 400 ms, ≤ 20% over 50 ms | pass |
| `select-layer` | click a layer in the layer list | unthrottled | 6 | 25.1 ms | 27.3 ms | 27.3 ms | long tasks 0 (worst 0 ms), input events over 16 ms 15 (worst 32 ms) | reported only | reported |
| `select-group` | shift-click a second layer into the selection | unthrottled | 6 | 26.3 ms | 27.9 ms | 27.9 ms | long tasks 0 (worst 0 ms), input events over 16 ms 36 (worst 40 ms) | reported only | reported |
| `hide-layer` | click Hide on a layer row | unthrottled | 6 | 25.2 ms | 25.8 ms | 25.8 ms | long tasks 1 (worst 59 ms), input events over 16 ms 36 (worst 80 ms) | reported only | reported |
| `lock-layer` | click Lock on a layer row | unthrottled | 6 | 25.1 ms | 26.8 ms | 26.8 ms | long tasks 0 (worst 0 ms), input events over 16 ms 36 (worst 56 ms) | reported only | reported |
| `inspector-x` | commit a new X in the inspector with Enter | unthrottled | 6 | 27.0 ms | 40.5 ms | 40.5 ms | long tasks 0 (worst 0 ms), input events over 16 ms 18 (worst 64 ms) | reported only | reported |
| `inspector-width` | commit a new width in the inspector with Enter | unthrottled | 6 | 31.5 ms | 46.2 ms | 46.2 ms | long tasks 0 (worst 0 ms), input events over 16 ms 18 (worst 72 ms) | reported only | reported |
| `opacity-key` | press an arrow key on the opacity slider | unthrottled | 6 | 28.7 ms | 39.9 ms | 39.9 ms | long tasks 0 (worst 0 ms), input events over 16 ms 12 (worst 64 ms) | reported only | reported |
| `undo` | undo an edit from the history panel | unthrottled | 6 | 38.1 ms | 51.6 ms | 51.6 ms | long tasks 0 (worst 0 ms), input events over 16 ms 36 (worst 64 ms) | reported only | reported |
| `redo` | redo an edit from the history panel | unthrottled | 6 | 31.1 ms | 97.7 ms | 97.7 ms | long tasks 1 (worst 83 ms), input events over 16 ms 69 (worst 112 ms) | reported only | reported |
| `drag-layer` | drag one text layer across the canvas (227 frame gaps over 3 drags) | unthrottled | 3 | 16.7 ms | 16.8 ms | 16.8 ms | long tasks 0 (worst 0 ms), input events over 16 ms 30 (worst 64 ms), 0% of gaps over 50 ms | reported only | reported |
| `drag-group` | drag a three-layer selection (234 frame gaps over 3 drags) | unthrottled | 3 | 16.7 ms | 16.8 ms | 33.4 ms | long tasks 1 (worst 50 ms), input events over 16 ms 91 (worst 112 ms), 0% of gaps over 50 ms | reported only | reported |
| `resize-handle` | drag the bottom-right handle to resize a layer (192 frame gaps over 3 drags) | unthrottled | 3 | 16.7 ms | 16.7 ms | 16.8 ms | long tasks 0 (worst 0 ms), input events over 16 ms 27 (worst 72 ms), 0% of gaps over 50 ms | reported only | reported |

- Gated phase: CDP `Emulation.setCPUThrottlingRate: 4`, 12 interaction samples and 5 drag samples per scenario, after one unrecorded warm-up pass.
- Reported phase: the same scenarios at full speed (6 / 3 samples). GitHub runners vary, so this phase is context rather than a gate; docs/PERFORMANCE.md says why.
- Latency is measured in the page: from the input event's own timestamp to the second animation frame after it. Frame gaps are the intervals between animation frames while the pointer moves.
