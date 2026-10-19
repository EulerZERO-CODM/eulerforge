# Decision records

Architecture decisions for Euler's Forge, newest constraints appended. Each record states the
situation, the decision, the reasoning, and what the decision costs. Code references the numbers
(`ADR-0006`) so a reader can get from a boundary in the source to the reasoning behind it.

Status values: **Accepted** (in force), **Superseded** (replaced by a later record).

---

## ADR-0001 — Browser-first application, desktop shell later if it earns its place

**Status:** Accepted

**Context.** The product needs a creative tool that people can try in seconds, and the same code has
to serve beginners and, later, professionals with local file access and performance needs.

**Decision.** Build a browser-first web application (Next.js App Router) with no plugin, download or
install step. Keep the domain layer free of browser APIs so a desktop shell can wrap the same UI
later. A desktop build is a roadmap *exploratory* item, not a commitment.

**Reasoning.** Distribution decides adoption for a beginner-facing tool: a URL beats an installer.
Nothing in the codebase requires server-side compute or privileged APIs today, so nothing is lost by
deferring the desktop decision.

**Consequences.** All persistence must work in a browser profile (ADR-0006). Heavy future engines
(raster, video decode) must be validated for browser performance before they are promised; if one
cannot be, that is a reason to revisit this record rather than to quietly ship a slow experience.

---

## ADR-0002 — Studios are registered data, never hard-coded shell branches

**Status:** Accepted

**Context.** Six disciplines are planned (Design, Photo, Video, Motion, Illustration, 3D). If the
shell grows a branch per discipline, every new studio rewrites navigation, discovery and settings.

**Decision.** A studio is a `StudioDefinition` value registered in `src/core/studios/`. The shell,
navigation, command palette, discovery pages and roadmap all read from the registry. Adding a
discipline is an edit to `definitions.ts` plus (eventually) its own workspace route.

**Reasoning.** One source of truth for "what exists" removes the class of bug where a studio is
listed but unreachable, or reachable but undocumented. It also makes studio metadata reviewable in
one diff.

**Consequences.** Definitions must carry metadata the shell does not understand yet (engines,
capability statuses, learning links). The registry validates structure and the test suite asserts a
clean registry, so a malformed definition fails CI rather than a user's browser.

---

## ADR-0003 — TypeScript strict everywhere; curated type-aware lint; typed routes off

**Status:** Accepted

**Context.** Strict settings and lint rules are only useful if they can stay green. Two failure modes
are common: rules so strict that contributors disable them, and a config so permissive that mistakes
reach users.

**Decision.**

- TypeScript with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`.
- ESLint 9 flat config: `eslint-config-next/core-web-vitals` plus `typescript-eslint`
  `recommendedTypeChecked` with curated stricter rules (no-floating-promises, no-misused-promises,
  no-unnecessary-condition, switch-exhaustiveness-check, consistent-type-imports). The full
  `strictTypeChecked` preset is deliberately not used: it flags intentional patterns (promise-based
  storage interfaces, documented defensive checks) and a config nobody can keep green is worse than
  a smaller one everybody respects.
- Prettier with the Tailwind class-sorting plugin; `format:check` is part of CI.
- Next.js `typedRoutes` is **off**. It depends on files generated into `.next/`, which makes
  `tsc --noEmit` order-dependent. Route integrity is enforced instead by tests that resolve every
  navigation target against the real `src/app` tree (`src/testing/routes.ts`).
- `.next/dev/types` is excluded from the type-check project. Next 16's *development* codegen emits a
  route validator that imports `AppRouteHandlerRoutes` and `NextRequest` unconditionally, which trips
  `noUnusedLocals` in a project that has no route handlers; the production build emits a variant that
  does not. Excluding the dev-only directory keeps `npm run typecheck` deterministic whether or not a
  dev server is running, without weakening any rule. `next build` still type-checks the generated
  production types.

**Reasoning.** The gates exist to catch real regressions (a dead link, a floating promise, an
unhandled storage failure), not to be a style contest.

**Consequences.** `npm run verify` is the single command that reproduces CI locally. Contributors get
warnings-free output as a baseline; new lint suppressions require a comment explaining why.

---

## ADR-0004 — One studio-neutral core; each discipline brings its own engine

**Status:** Accepted

**Context.** 2D vector art, raster photos, timelines, keyframe animation and 3D scenes do not share a
rendering model. The tempting shortcut — one "universal" renderer that every studio funnels through
— produces something that is mediocre at all five.

**Decision.** Forge Core owns only what is genuinely shared: documents and their metadata, units and
geometry, guides, history, persistence, export *interfaces*, assets, learning and the shell. Each
studio declares its own engine boundary (`StudioEngineBoundary`: renderer, pipeline, integration
point, rationale) and will bring its own rendering technology when it is built.

**Reasoning.** Separate engines keep each discipline honest: an illustration kernel does not have to
pretend to be a video decoder. The shared core is what makes the product feel like one application
despite five engines.

**Consequences.** Documents are studio-neutral containers plus discipline-specific payloads added by
migration when that studio ships. Cross-studio hand-off (design → motion, photo → design) is
expressed through document types and asset references, not shared renderer state. The cost is some
duplication in studio implementations; that is accepted deliberately.

---

## ADR-0005 — Versioned document schema with one-way migrations

**Status:** Accepted

**Context.** A document written by today's app will be opened by a much later version. Silent field
loss is unacceptable; so is refusing to open older projects.

**Decision.** Every persisted document carries `schemaVersion`. Migrations are one-way steps
registered in `MIGRATIONS`; `migrateDocument` is the only code path that turns untrusted JSON into a
`ForgeDocument`. Records from a *newer* app version are refused with a clear message rather than
downgraded. Loading reports how many records were migrated and how many were skipped, and the UI
surfaces both.

**Reasoning.** Migrations must be testable and reviewable in isolation. "Newest wins" behaviour
destroys data; refusing loudly is recoverable, silently losing fields is not.

**Consequences.** Schema changes require: a bump of `CURRENT_SCHEMA_VERSION`, a migration step, a
fixture test for the old shape, and a note in this file. Version-less records are treated as v0 so
pre-versioning projects still load.

---

## ADR-0006 — Local-first persistence behind a promise-based boundary; no cloud claims

**Status:** Accepted

**Context.** Accounts and sync do not exist, but the product will eventually need them. Meanwhile,
a browser-only project library must survive corrupt records, quota exhaustion and storage being
unavailable entirely.

**Decision.** All storage goes through `KeyValueStorage` and `DocumentRepository` interfaces. The
only implementation shipped is device-local (`localStorage`, with an in-memory fallback when storage
is unavailable). Interfaces are asynchronous on purpose so a remote adapter does not force a rewrite
of every caller. The UI states on every relevant surface that projects are local to the browser.

**Reasoning.** Making the boundary async now avoids a painful refactor later; keeping the
implementation local now keeps the honesty simple.

**Consequences.** Storage failures surface as typed results, not exceptions: `storage-unavailable`,
`storage-quota-exceeded`, `storage-corrupt`. Corrupt records are skipped and reported rather than
crashing the library. Nothing may imply sync until ADR-0006 is superseded by a record that covers
authentication, conflict handling and data residency.

**Durability reporting (added in the Phase 1 review pass).** The in-memory fallback is real but not
durable, so `createBrowserStorage()` returns the backend *and* its durability (`persistent` or
`volatile`) plus a cause. Three rules follow, and they are enforced by tests rather than by review:

1. **Never claim a save that did not reach the device.** The workspace save indicator only says
   "Saved" for a persistent backend. With a volatile backend it says the document is held in memory,
   and the shell banner, the project library and the Settings storage row all say the same thing.
2. **Server rendering claims nothing.** On the server there is no `window` to inspect, so the cause
   is `server-render` and the state layer reports the status as *undetermined*: no warning is
   rendered, because the browser would immediately contradict it on hydration. The DOM-environment
   tests assert silence for that case.
   Claims are modelled with three phases rather than one boolean. `isVolatile()` answers only "is
   storage refusing writes?", and a two-way test on it made an uninspected browser take the
   persistent branch — the sidebar footer asserted that projects were stored before anything had
   checked. `storagePhase()` now returns `persistent | volatile | undetermined`, wording lives in the
   single `STORAGE_PHASE_CLAIMS` record (`volatile` must state what is lost and when; `undetermined`
   must assert nothing), and every surface that makes a claim switches on the phase exhaustively, so
   a new phase fails to compile until it is given wording.
3. **The fallback must keep working.** Removing it would break server rendering, so it stays; what
   changed is that it is now labelled. Failures that do happen (quota, a refused write) stay visible
   on the save indicator and offer a retry that re-persists the exact revision the user sees.

---

## ADR-0007 — Explicit stores + `useSyncExternalStore` instead of a state library

**Status:** Accepted

**Context.** The application needs shared state across the shell, workspace and settings, without
pulling a large state-management dependency into a foundation phase.

**Decision.** Small store classes expose `getState`/`subscribe` (plus private `setState`), and React
binds to them through `useStore` using `useSyncExternalStore`. Services are constructed once per tab
in `ForgeProvider`.

**Reasoning.** A store per concern is testable in plain Node without a test renderer — the domain
tests instantiate `DocumentsStore` and `DocumentSession` directly. The React binding is ~10 lines.

**Consequences.** No selectors library, no devtools integration, no time-travel debugging. If the
state graph grows to where manual subscription granularity hurts, this record is the one to revisit,
not to quietly work around by adding a second state system.

---

## ADR-0008 — Asset licensing and provenance are first-class, and sample content is labelled

**Status:** Accepted

**Context.** A creative platform that bundles content is a licensing risk the moment a user ships
something commercially. Phase 1 has no real asset library, and pretending otherwise would be both
dishonest and legally sloppy.

**Decision.** Every asset record carries a licence record (attribution, commercial use, share-alike,
plain-language summary) and provenance (source, author, date, verification flag, notes). Phase 1
ships `forge-sample` placeholder records labelled as sample content, plus `planned` records that
document intended integrations and are explicitly *not bundled*. The UI states the sample status
next to results.

**Reasoning.** Provenance and licence are exactly the fields a marketplace or a review workflow will
need later; modelling them now costs little and prevents a content model rewrite.

**Consequences.** Validators and tests enforce: no bundled third-party files, `planned` records
carry "not bundled" notes, unverified provenance is surfaced before commercial use. Adding real
content requires a licence and a verification step, not just a file.

---

## ADR-0009 — Security posture: no secrets, no telemetry, explicit headers

**Status:** Accepted

**Context.** A browser application with local storage has a small but real attack surface: injected
scripts, malicious project files, and well-meaning additions of tracking or secrets.

**Decision.**

- `.env.example` contains only `NEXT_PUBLIC_*` values and no secrets; the rule is documented at the
  top of the file and enforced by review. Anything sensitive in a `NEXT_PUBLIC_*` variable would be
  embedded in the client bundle, so it must never exist.
- Telemetry defaults to `off` and `on` is **rejected by schema validation** until a real adapter and
  a privacy review exist.
- Security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  a restrictive `Permissions-Policy`) ship from `next.config.ts`.
- No `X-Frame-Options`/`frame-ancestors`: hosted preview and proxy environments must be able to embed
  the app during development. A production deployment should add a `frame-ancestors` allow-list at
  the edge, and that is recorded here rather than silently omitted.
- Untrusted input (storage records, project files) only ever enters the domain through the schema
  and migration pipeline.

**Reasoning.** These are the cheap, high-value controls. Anything more (CSP nonces, subresource
integrity) should be added when a deployment target exists to test against.

**Consequences.** No analytics until a privacy decision is recorded. Any future secret or third-party
script requires a new ADR, not a config edit.

---

## ADR-0010 — Registry validation and honest capability flags

**Status:** Accepted

**Context.** The fastest way to make a foundation look finished is to fake the missing parts. That
produces dead buttons, misleading claims and a codebase whose UI cannot be trusted.

**Decision.** Two mechanisms enforce honesty:

1. **Structural validation.** Studios, learning content and the roadmap are validated in tests
   (`getRegistryIssues()`, `validateLearningContent()`, capability references). An `available` studio
   without a route, a lesson linking to a missing lesson, or a roadmap item citing a capability that
   does not exist all fail CI.
2. **A capability ledger.** `src/core/platform/status.ts` lists what exists with a status
   (`implemented` / `partial` / `planned` / `exploratory`), the evidence that verifies it, and the gap
   for anything unfinished. `/platform-status` renders it; tests assert that `implemented` claims
   carry evidence and that named test files exist.

**Reasoning.** Honesty has to be cheaper than dishonesty. If the ledger is the path of least
resistance, capability claims stay accurate as the project grows.

**Consequences.** Adding a feature means adding a ledger entry and evidence. Controls that cannot
work are disabled with the reason visible — for example, planned export formats are selectable so
the requirements are visible, and the download button is disabled with an explanation.

---

## ADR-0011 — Environment configuration is validated at startup, and fails fast

**Status:** Accepted

**Context.** Configuration errors are usually discovered at the worst possible moment: in a preview
deployment, mid-demo. Silent fallbacks hide typos.

**Decision.** `src/config/env.ts` parses `NEXT_PUBLIC_*` values with Zod at module load, throws
`EnvironmentValidationError` listing every offending variable, and freezes the result. The message
points at `.env.example`. Defaults exist for local development so a fresh clone runs with no config.

**Reasoning.** A crash with a readable list beats a subtly wrong build. Explicit `NEXT_PUBLIC_*`
references are written out literally because the Next.js compiler inlines them statically.

**Consequences.** Adding configuration means updating `.env.example`, the schema, the `PublicEnv`
type, and (where it changes behaviour) a test. Until a deployment target exists, no build-time-only
variables are introduced.

---

## ADR-0012 — Roadmap and capability ledger are code, not prose

**Status:** Accepted

**Context.** Roadmaps in markdown drift. Milestones are quietly dropped and "coming soon" claims
outlive their plans.

**Decision.** `src/core/platform/roadmap.ts` holds phases, items, dependencies, completion criteria
and capability links as typed data, rendered at `/roadmap`. `docs/ROADMAP.md` summarises it and
states that the code wins. Tests assert that dependencies resolve, that every item links to a
capability that exists, and that a phase which is not complete contains no `done` items.

**Reasoning.** Prose cannot be type-checked; a data structure can. This is what stops "planned"
becoming "vaguely intended".

**Consequences.** Editing the roadmap is a code change with a test run, which is a deliberate
friction. Public copy should quote `/roadmap` rather than maintain a separate list.

---

## ADR-0013 — Rendering and export are capability-negotiated interfaces, not a promise

**Status:** Accepted

**Context.** Export is where users judge a creative tool, and it is also where a foundation phase is
most tempted to pretend: a button that writes a PNG "placeholder", or a progress bar over nothing.

**Decision.** `src/core/export/formats.ts` declares formats with explicit status and capabilities
(transparency, animation, print-readiness, lossiness). `buildExportChecklist(document, formatId)`
evaluates a real document against the selected format and returns `pass`/`warning`/`blocked` checks
with remedies. Planned formats produce a `blocked` result that names the missing pipeline. The only
implemented export today is the `.forge.json` project file, which has an implemented parser and a
round-trip test.

**Reasoning.** Users can see exactly what each format requires *before* spending time, and the
interface cannot drift into claiming a renderer that does not exist.

**Consequences.** A renderer must be added as a real dependency before its format flips to
`available`; the checklist then gains real checks (resolution, colour, bleed, encoding) rather than
being deleted. Export interfaces live in `src/core/export/**` and remain renderer-agnostic.

---

## ADR-0014 — Accessibility and performance are baseline requirements, not polish

**Status:** Accepted

**Context.** Creative tools habitually become keyboard-hostile and heavy, and retrofitting both is
expensive. A beginner-facing product cannot afford either.

**Decision.**

- Keyboard: every interactive control is reachable and operable, the shell has a skip link, the
  command palette (Cmd/Ctrl + K) reaches every destination, and undo/redo shortcuts are global except
  while typing.
- Assistive technology: Radix primitives for dialogs, menus and tooltips (focus trapping, escape
  handling, correct roles); `aria-current` on the active navigation item; a permanently mounted live
  region for notifications; `role="note"` on callouts; icon-only buttons take a mandatory `label`
  that becomes both `aria-label` and a tooltip.
- Contrast and focus: tokens are chosen for contrast on the dark graphite base and focus is always
  visible with an accent ring, never removed.
- Motion: `prefers-reduced-motion` and an in-app preference both drive `[data-motion='reduce']`.
- Performance: static rendering wherever a route does not need client state; client components are
  leaves; content is plain modules rather than fetched data; no large dependencies without a record.

**Reasoning.** These are cheap at the start and expensive later. Making the icon-only label
mandatory at the type level is the kind of constraint that survives contributor turnover.

**Consequences.** UI changes are reviewed against this list, and component tests assert the
behavioural parts (focus order and roles where practical). A performance budget will get concrete
numbers when a renderer exists to measure; inventing thresholds for an app with no canvas would be
theatre.

---

## ADR-0015 — Canvas zoom is geometry, and 100% means one document pixel per CSS pixel

**Status:** Accepted

**Context.** The workspace stage renders a document's specification (background, safe area, bleed,
grid, centre lines). Its first implementation offered Fit/25/50/100/200% while the canvas box was
sized by CSS maximum-width rules, including a portrait-specific `min(100%, 14rem)`. The control
therefore promised zoom levels the layout silently overrode: 200% on a vertical document rendered
exactly the same box as 100%.

**Decision.** Zoom is computed, not styled:

- `src/core/documents/zoom.ts` resolves a setting plus the measured viewport into an exact CSS-pixel
  box, a percentage for display, and a `clipped` flag. It is framework-free and unit-tested.
- An explicit percentage scales the document's **declared pixel dimensions**. Portrait and landscape
  documents are handled identically — no orientation-specific cap exists.
- `fit` uses the smaller of the two axis ratios and never magnifies past 100%, so 100% keeps exactly
  one meaning. It scales to the viewport the stage measured, and an unmeasurable viewport falls back
  to the declared size rather than to a guess.
- The stage measures its scroll area (`ResizeObserver`, with a window-resize fallback) and passes an
  **absolute** size to the preview. In that mode the preview applies no `max-width`/`max-height`
  cap; it hugs the canvas, and the scroll container (`overflow-auto` with an auto-margin child so
  both edges stay reachable) is how an oversized canvas is explored. Being larger than the pane is
  reported in the interface instead of hidden.
- The zoom control shows the effective percentage next to the select, steps out of `fit` relative to
  what is actually on screen, and states in plain language that a percentage maps document pixels to
  **CSS** pixels — on a high-density display one CSS pixel is drawn with more than one device pixel,
  so 100% is a 1:1 CSS-pixel mapping, not a guarantee of device-pixel identity.

**Reasoning.** A zoom control is a measurement claim. If the interface says 200%, the box must be
twice the declared size, and if that cannot fit the pane, scrolling is the honest answer rather than
a quieter cap. Putting the arithmetic in Forge Core also means the cases that broke last time
(portrait, oversized zooms, fit with an unmeasured viewport) are covered by tests that do not need a
browser.

**Consequences.** The stage needs a measured viewport, so `ResizeObserver` is required in the browser
(with a documented fallback) and tests stub element measurements to exercise `fit`. Fluid previews
(creation flow, project cards) keep their container-fitted behaviour explicitly via
`sizing={{ kind: 'fluid' }}`, so the two meanings of "preview" never blur. Any future zoom mode (a
zoom-to-selection, a percentage between the fixed levels) is added to the core function with tests
rather than to the component's CSS.

## ADR-0016 — One render plan and one painter serve both the artboard and export

**Status:** Accepted

**Context.** Phase 2 needed real drawing. The tempting shortcut is to let the editor be a DOM/SVG
surface and hand export to a canvas library, or to let each of them interpret the document its own
way. Both approaches drift: text wraps one way on screen and another in the file, stacking order
differs, and "what you see is what you export" becomes a claim nobody can test. Pulling in a large
graphics dependency would also have added a second geometry model to keep in sync.

**Decision.**

- The renderer is **Canvas 2D**, and the scene is described once as a **render plan**
  (`src/core/render/plan.ts`): an ordered list of paint operations (background, rect, ellipse, text,
  image) plus the issues found while planning. `src/core/render/paint.ts` draws that plan into any
  object matching `PainterContext` (`globalAlpha`, `fillStyle`, `font`, the shape and image calls).
- The **live artboard** and the **offscreen export** both build a plan from the same document and
  paint it through the same code; they differ only in the transform they apply first (viewport zoom
  versus output scale) and in which canvas implements `PainterContext`. The browser adapter is
  `render/browser-canvas.ts` (moved to `src/lib/browser/canvas.ts` by ADR-0019); tests use recording
  and real-canvas implementations.
- **Text layout, wrapping, alignment and measurement live in the core** (`render/text-layout.ts`,
  `render/measure.ts`) behind an injected `MeasureFactory`. Fonts are system stacks resolved per
  platform, so nothing is downloaded and no webfont can fail at paint time.
- **Guides, safe areas and selection handles stay DOM overlays.** They are interface, not artwork:
  keeping them in the DOM preserves accessibility, keyboard focus and crisp hairlines at any zoom,
  while keeping them out of the canvas guarantees they cannot leak into an export.
- Raster output is produced offscreen at document size × scale, and `export/raster.ts` returns a
  `Blob` plus width, height and byte size. Nothing in `src/core/**` touches `URL.createObjectURL` or
  an `<a>` element; that lives in the single `export/download.ts` adapter (now
  `src/lib/browser/download.ts`, outside the core — ADR-0019).
- Cost: no SVG export, no vector paths, and large documents are rasterised rather than
  incrementally redrawn. Those are roadmap items (Phase 3 owns the path model), not gaps hidden in
  this decision.

**Consequences.** An export cannot silently disagree with the artboard: both consume
`buildRenderPlan`, and the raster tests assert on real pixels through `@napi-rs/canvas`. A layer type
that the renderer does not understand produces a **blocking render issue**, so export refuses by
name instead of emitting an empty file. Because the plan is data, it is also the place to add future
outputs (SVG, PDF) without touching the editor.

## ADR-0017 — No interaction is drag-only, and transient state never enters the document

**Status:** Accepted

**Context.** Direct manipulation invites two well-known shortcuts: features that only exist inside a
drag gesture, and interaction state (selection, hover, in-flight drags) written into the saved
document because it was convenient to keep it in the same object. The first makes the editor
unusable without a pointing device; the second makes history noisy, exports unpredictable and files
impossible to compare. Both are expensive to undo later, so Phase 2 fixed the rules up front.

**Decision.**

- **Every pointer action has a keyboard path.** Selection moves with Arrow keys (Shift extends),
  `Home`/`End` jump to the edges, layers move with the arrow keys, resize is reachable from the
  inspector's numeric fields, and reorder, duplicate, hide, rename and delete are buttons in the
  layer tree with accessible names. The artboard itself is a labelled, focusable region.
- **Transient state lives outside the document.** Selection, snapping toggles, guide visibility, the
  marquee, an in-flight drag and the zoom level live in component state or `src/core/editor`, never
  in `ForgeDocument`. They are therefore never persisted, never exported and never history entries —
  the history list shows edits, not clicks.
- **A gesture commits once.** Pointer moves preview locally; the release resolves the gesture
  (`resolveGesture`) into a patch and commits it with one label. A gesture that changed nothing
  resolves to `unchanged` and produces no commit and no history entry, and cancelling leaves the
  document exactly as it was.
- **Interaction state is not selectable by accident.** The artboard stops the default drag/text
  selection behaviour, and pointer capture is released on both pointer-up and pointer-cancel so a
  lost pointer cannot leave the editor stuck in a gesture.

**Consequences.** Accessibility is a property of the architecture rather than a follow-up task, and
undo history stays meaningful: one drag, one entry, with a label that names what moved. The cost is
duplication — each pointer affordance needs a keyboard equivalent — and the test suite covers both
paths (`document-stage.test.tsx` for the keyboard surface, `gesture.test.ts` for the pointer maths)
so they cannot drift apart. Anything that can only be done by dragging is treated as a bug.

## ADR-0018 — Browser behaviour is verified in a browser, in a separate CI job

**Status:** accepted (Phase 2 review fixes).

**Context.** The Phase 2 review found that the claims which depend on real browser behaviour — native
pointer capture, the browser's own canvas rasteriser, and a file download actually starting — were
covered only by reasoning and by a manual checklist. jsdom cannot supply any of the three: it has no
canvas 2D context, no pointer capture, and no download mechanism, so unit tests over those paths can
only ever assert that the code *called* something. That is not evidence for the claim, and saying
"verified" on that basis would be exactly the kind of overclaiming these ADRs exist to prevent.

**Decision.**

- **A real browser verifies browser behaviour.** `e2e/**` runs `@playwright/test` against the
  production build (`next start`), as its own CI job (`Browser (Chromium)`) that reports its own
  result. It runs on Node 22 alongside — not instead of — the existing `Verify (22.x)` and
  `Verify (24.x)` jobs, and it runs with retries disabled: a browser suite that only passes on the
  second attempt is not evidence. It is deliberately *not* gated on those jobs: a failing unit test
  must not be able to hide whether the product works in a browser, which is the whole reason for
  having a second, independent signal.
- **The harness reads the real product state.** Assertions are made against the document the
  application persisted to `localStorage`, and against bytes the browser actually downloaded. No
  application code is stubbed, mocked or replaced.
- **The application does not depend on the harness.** Nothing under `src/**` imports from `e2e/**`.
  The only hooks the tests use are inert `data-*` attributes that the component tests already rely
  on, and they carry geometry the interface genuinely has (canvas size, zoom, layer ids).
- **Residual gaps are written down, not glossed over.** Whatever the browser suite does not reach is
  listed as a manual check in `docs/ROADMAP.md`, and the roadmap items it belongs to carry a `gap` or
  stay `partial` in the ledger. Three gaps this record originally listed — rendered guide pixels,
  hidden layers in exported pixels, zoom-level text rewrapping — were closed by later specs that
  decode the canvas the browser drew (`e2e/snapping.spec.ts`, `e2e/export.spec.ts`,
  `e2e/text-wrapping.spec.ts`); what is left is other browser engines, responsiveness with a 30-layer
  document, and absolute font metrics that only a reference machine could assert.

**Consequences.** The export, transform and selection claims now have executable evidence from the
environment they are about. The cost is a build plus a Chromium download on every push, and a suite
that has to be kept honest: it fails when the interface changes, which is the point. The risk to
watch is a test that only asserts what a mock would have asserted anyway — so the browser specs
assert persisted state and real file bytes, never the shape of a call.

## ADR-0019 — Browser adapters live outside the core, and ESLint enforces the boundary

**Context.** `AGENTS.md` and this document both say that `src/core/**` is framework-free: domain code
that Node tests, the server renderer and the export pipeline can all run without a browser. Two Phase 2
files broke that rule. `src/core/render/browser-canvas.ts` called `document.createElement('canvas')`,
and `src/core/export/download.ts` used `window`, `document` and `URL.createObjectURL`. Both compiled and
both were tested, but a reader could no longer tell from a path whether importing a module might reach
for a DOM global.

**Decision.**

- **The adapters move out of the core.** `src/lib/browser/canvas.ts` owns the canvas element and the
  `canRasteriseHere()` capability probe; `src/lib/browser/download.ts` owns `downloadBlob()`, the only
  place a file is handed to the browser. Their responsibilities stay narrow: take values in, touch the
  browser, report honestly (a `false` when there is no document to attach an anchor to, a thrown error
  with a readable message when there is no canvas).
- **The core keeps its architecture.** `src/core/export/raster.ts` still takes a *canvas factory* as an
  argument, so the pipeline is unchanged — the live export passes the browser adapter, the tests pass a
  recording canvas or a `@napi-rs/canvas` one. `src/core/export/project-file.ts` returns a payload
  (`projectFilePayload`: contents, file name, MIME type) instead of performing a download, so serialising
  a project file is testable with no browser and no DOM.
- **The rule is executable, not aspirational.** `eslint.config.mjs` restricts, for `src/core/**`:
  browser-only globals (`document`, `window`, `navigator`, storage, `HTMLCanvasElement`, `requestAnimationFrame`,
  and the rest), `URL.createObjectURL`/`revokeObjectURL` by syntax selector (plain `URL` parsing stays
  legal, and `Blob` stays legal because Node provides it), and imports of `src/lib/browser/**`,
  `src/state/**`, `src/components/**`, `src/app/**`, React and Next. The single exemption is the storage
  boundary — `src/core/persistence/storage.ts` and its tests — which probes `window.localStorage` behind a
  server-render guard and reports the volatile fallback (ADR-0006).
- **The fix also closed a hole in the old config.** Flat config replaces a rule's options rather than
  merging them, so the ADR-0018 block that banned importing the Playwright harness from `src/**` was
  silently replacing the components' persistence ban: a component could import
  `src/core/persistence/**` and lint would stay green, while `AGENTS.md` claimed otherwise. The pattern
  lists are now shared constants (`HARNESS_IMPORT_PATTERNS`, `PERSISTENCE_IMPORT_PATTERNS`,
  `CORE_IMPORT_PATTERNS`) and every block that restricts imports states the harness ban alongside its own
  patterns. The persistence patterns also now match the relative forms (`**/core/persistence/**`), which
  the previous `../core/persistence/**` never matched from a component two directories down.

**Consequences.** Every boundary that this repository talks about — components not reaching into
persistence, core not knowing about React, the DOM, the state layer or routes — fails a lint run when it
is crossed, and each was verified by introducing a deliberate violation and watching ESLint report it.
A future module that needs a browser API has one obvious home, and a reviewer can accept or reject it as
a one-line change of a pattern list rather than as an unwritten convention.

## ADR-0020 — The path kernel is its own model, and geometry never learns about SVG or React

**Status:** accepted (Phase 3).

**Context.** Phase 3 needs a vector capability that the Illustration Studio can edit, the renderer can
paint, the export pipeline can serialise and a later Motion Studio can animate. The obvious shortcut is
to make SVG path syntax the in-memory representation: `M/L/C/A` strings, parsed on demand, with the
editor mutating document text. That shortcut fails the requirements in three separate ways. It puts a
*markup* format at the centre of a data model that has to answer geometric questions (bounds,
hit-testing, transforms, boolean combination) cheaply and unambiguously; it makes every edit a string
rewrite, so a node drag has no natural target to address and no round-trip identity; and it welds the
editor's keyboard and pointer behaviour to whatever the last serialiser happened to emit.

The second shortcut is to let the kernel reach for the browser: measure a curve with
`SVGGeometryElement.getTotalLength`, hit-test with `isPointInStroke`, or compute bounds from a rendered
`<path>`. Those APIs are only available in a DOM and only for vector shapes that are attached to a
document, which would make the kernel untestable in Node and unusable in the export path.

**Decision.**

- **One immutable path model, addressed by index.** `src/core/vector/types.ts` defines a path as
  contours of nodes; each node carries a point, an optional `handleIn`/`handleOut`, and a kind
  (corner / smooth / asymmetric). Segments are therefore *between* nodes, and an edit targets
  `{ contourIndex, nodeIndex, side }` — the identity the UI needs and the identity a test can assert.
  A contour that closes records `closed: true` rather than repeating its first node, so a closed shape
  has no duplicate vertex to keep in sync.
- **Geometry is framework-free and dependency-light.** `src/core/vector/**` imports no DOM, no React,
  no storage and no SVG module; ESLint bans those imports for `src/core/**` (ADR-0019), and the kernel
  is covered by Node tests (`path`, `geometry`, `path-data`, `validity`, `ops`, `shapes`, `pen`,
  `pick`, `boolean`). Numbers are the only currency: flattening, arc-length sampling and area
  computation are hand-written where they are small and well understood, and all of them are
  deterministic.
- **SVG is a boundary, not a model.** `src/core/svg/**` converts between the model and markup in both
  directions. The serialiser is deterministic (sorted attribute order, computed `viewBox`, stable
  number formatting at a fixed digit count) and the importer parses markup into the same model. A
  round-trip is therefore a property of the conversion, not of the editor: the tests compare
  coordinates within a documented tolerance (`1e-3` in user units) rather than comparing strings.
- **Tolerances are declared once.** `src/core/vector/tolerance.ts` is the single source: point
  coincidence `1e-6`, flattening step `0.05` px, area epsilon `1e-6`, stroke hit slack `3` px. Nothing
  else is allowed to invent an epsilon, and an operation that changes the effective tolerance (a
  boolean, which flattens first) has to *report* it — which is why the boolean command returns the
  flattening tolerance and the flattened segment counts to the interface.
- **Invalid geometry is a value, not an exception.** Because paths can come from a file, every
  operation returns a `Result<T>` and `validatePath`/`validateVectorContent` name the specific problem
  (`degenerate-contour`, `non-finite-point`, `too-many-nodes`, …). A closed contour with fewer than
  three distinct nodes is rejected rather than silently repaired.

**Consequences.** The editing surface, the painter, the SVG exporter and the interchange path all
consume exactly the same geometry, so an edit cannot mean one thing on screen and another in a file;
the kernel is unit-testable in Node with no canvas; and boolean results can be re-validated for
topological consistency before they are offered to the user. The cost is conversion code in two
places (SVG and the render plan) and a flattening step before boolean operations, which is a visible,
reported approximation rather than a hidden one. Curve-preserving boolean operations remain future
work, and the interface says so where it matters.

## ADR-0021 — Boolean operations come from a reviewed dependency, and the result is checked

**Status:** accepted (Phase 3).

**Context.** Union, difference, intersection and exclusive-or over paths are the part of a vector
editor where hand-written code goes wrong quietly: self-intersections, coincident edges, overlapping
holes and degenerate slivers each produce output that *looks* plausible and is not topologically valid.
The Phase 3 brief asks for reliable output and for a mature library to be evaluated before writing
computational geometry from scratch.

Four candidate libraries were compared on the criteria that matter here — licence, algorithm,
dependency weight, DOM-independence and maintenance: `polygon-clipping` (MIT, Martinez–Rueda sweep on
polygons, no dependencies, plain JavaScript), `martinez-polygon-clipping` (MIT, the upstream of the
same algorithm), `js-angusj-clipper` (a WebAssembly port of Clipper, permissive licence but a WASM
artefact), and `paper.js` (a full graphics framework under a permissive licence). The last two were
rejected for weight and for pulling a framework into the core; the first two are the same algorithm,
with `polygon-clipping` being the maintained one that ships a modern entry point.

**Decision.**

- **Depend on `polygon-clipping@0.15.7` (MIT)** in `src/core/vector/boolean.ts` only. It is pure
  JavaScript with no DOM dependency, so the kernel stays usable in Node; it takes and returns plain
  nested arrays, so no library type leaks into the model.
- **Import it as a default import.** The published module is CommonJS/UMD with an ESM wrapper that
  exports the operations object as the *default*; `import * as` resolves to `undefined` in a browser
  bundle while still working under Node. The regression was found by the browser CI job, so a
  Chromium E2E performs a real boolean operation as a guard.
- **Own the approximation.** Curves are flattened to line segments at `TOLERANCE.flatten` before
  clipping, because the library is polygonal. That is a real limitation, so the command reports the
  tolerance and both flattened segment counts, and the result is a polygonal path with corner nodes —
  the interface states this instead of implying that curves survived.
- **Validate the output.** Every result is re-parsed through `validatePath` and checked for
  topological consistency in `boolean.test.ts`: contour count and nesting for holes, no repeated
  degenerate contours, area identities for difference and intersection, coincidence handling, and the
  documented refusals for empty or invalid input. A boolean that cannot produce a sound path fails
  with a message rather than returning geometry that would silently corrupt a document.
- **Keep the licence record honest.** The dependency is listed with its licence in the repository's
  dependency documentation, and no other vector dependency is added.

**Consequences.** Boolean operations behave predictably on the cases that break naive implementations,
and the failure mode for the polygonal approximation is *visible* rather than silent. The cost is one
runtime dependency in the core, a flattening step that loses curve handles inside the affected shapes,
and output that is denser than its input. Those costs are the reason curve-exact booleans stay
`planned` in the studio registry.

## ADR-0022 — Vector artwork crosses the Design/Illustration boundary as a translation with a report

**Status:** accepted (Phase 3).

**Context.** The two studios hold artwork in different documents, and Phase 3 requires a tested
interchange in both directions *for the supported subset*, with unsupported content named rather than
dropped. The tempting shortcut is to copy the layer list and hope: a text layer becomes a path with no
glyphs, an image layer becomes an empty shape, and the user discovers the loss after the fact.

**Decision.**

- **Interchange is an explicit conversion, not a shared container.** `src/core/documents/interchange.ts`
  takes layers and returns a `Result` with the converted layers, a per-layer list of what was carried
  and a per-layer list of what was refused with a reason (`INTERCHANGE_LIMITATIONS` names each case in
  the interface). Neither studio gains a dependency on the other's editor, and the conversion is
  unit-tested from both directions.
- **The supported subset is stated in one place.** Path layers travel whole, with geometry and style;
  rectangle and ellipse layers travel as their generated paths (their shape has an exact path
  equivalent in the kernel); text, graphics/images, groups with unsupported members, and any style the
  target document type does not support are refused *by name*. Nothing is approximated silently.
- **Rotation, effects and metadata are refused rather than baked.** A rotated layer cannot be
  represented losslessly in a frame-only target without rasterising it, so it is reported; ids, names
  and z-order are preserved so the converted document is still recognisable next to the original.
- **The converted document is a new document, created through the normal path.** The interface calls
  the same `documents.create` used by the creation flow (with the target studio's primary document
  type), so a converted project is validated, persisted and reopenable like any other — and the
  interface links to it.

**Consequences.** A user sees exactly what will move before they press the button, and a refusal is
impossible to mistake for success. The cost is that the conversion is conservative: some artwork a
person might expect to travel does not, and the interface has to say so in plain language.

## ADR-0023 — SVG export is only `available` when the bytes are produced in a browser

**Status:** accepted (Phase 3).

**Context.** `src/core/export/formats.ts` drives what the export panel offers, and a format marked
`available` is a promise that pressing the button writes a real file. Phase 3's SVG payload is built in
the core, but handing bytes to the browser is not: it needs an object URL, an anchor and a click
(same boundary as ADR-0019). A format that is `available` while the panel falls through to the raster
branch would be exactly the kind of misleading capability claim this project forbids.

**Decision.**

- **The core builds a payload; the browser adapter performs the download.**
  `src/core/export/svg-export.ts` returns `{ contents, fileName, mimeType, bytes, unsupported }` with a
  `Result` when the document cannot produce a valid file; `src/lib/browser/download.ts` hands it over.
  Everything except the final click is unit-testable.
- **The readiness checks and the download agree.** `export/checklist.ts` evaluates the same payload, so
  the panel cannot show a green checklist and then download a different file. When layers are omitted
  the export is *blocked* by default; the user may opt in to a partial export, and the interface then
  names how many layers were left out and the payload records them.
- **Evidence comes from the browser.** A Chromium spec performs the export, captures the download,
  reads the file's bytes and re-imports them; the format stays `available` only while that spec passes.
  Format status is also part of the format registry's own tests.
- **Icon sets go through the same path.** The zip writer is pure (a stored-mode ZIP written by hand),
  so the archive is unit-tested, and the browser spec checks the downloaded bytes start with the ZIP
  signature and that the manifest names one file per object.
- **An icon set is a selection export, not a scene export.** The panel is given the workspace
  selection, and one classification (`iconLayersForSelection`) decides which selected layers are
  visible paths. The count shown before the click, the button's enabled state, the layers handed to
  the builder, the files in the archive and the report afterwards all come from that one set. A
  selected layer that is hidden, fully transparent or not a path is named as skipped; a layer that is
  merely present in the document is never included. The builder applies the same visibility rule itself, so
  a caller cannot widen the set by passing the whole scene, and it returns the skipped layers rather
  than dropping them. The regression test asserts the archive's entry list, not just its size, both
  in jsdom (the bytes handed to the adapter) and in Chromium (the downloaded file).

## ADR-0024 — Photo rendering is one pipeline with two backends, not two features

**Status:** accepted (Phase 4).

**Context.** Per-pixel adjustment work is what a GPU is for, and the roadmap commits to a WebGL2
path. But WebGL2 is not guaranteed (headless browsers, blocked drivers, old hardware), and a photo
editor that silently does nothing on such a device is worse than a slower one. Two independent
implementations would also drift: the shader and the CPU code would disagree about exposure by one
stop and nobody would notice until a user compared a preview with an export.

**Decision.**

- **`src/core/photo/pipeline.ts` is the definition.** It is pure, framework-free and returns pixels.
  The WebGL renderer's fragment shader mirrors it, and the CPU renderer *is* it. A 12-swatch chart
  and a masked mix are compared across both renderers in Chromium within **2/255 per channel**; the
  parity test fails the build if they disagree.
- **`auto` is the default renderer.** The engine tries WebGL2, and on refusal falls back to Canvas
  2D *and reports why* (`fallbackReason` is shown in the stage and in the renderer panel). Choosing
  "GPU" explicitly still falls back rather than failing to render, because a document you cannot
  see is not a useful error message; the interface says which renderer produced the last preview.
- **Export always uses the same decision.** The export panel re-renders the saved document at its
  stored size through `renderPhoto`, encodes with the browser's own encoder, and reports the engine,
  dimensions and byte count that produced the file. There is no second export renderer to drift.
- **The working copy is capped at 2048 px on the long edge and previews at 1280 px.**
  `preparePhoto` re-encodes the imported image to that size and stores it in the document, so a
  project reopens without the original file and a 40 MP camera file cannot exhaust memory. The cap
  is a product decision with a cost: the roadmap's 12 MP target is not exercised by the shipped
  pipeline, and the capability ledger says so instead of quoting the target as if it were met.
- **Masking is a strength map, not a selection object.** Strokes are normalised points plus radius,
  hardness and fill, rasterised to one byte per pixel at the render size. That keeps masks this side
  of the document schema (they are serialisable, migratable and tested) and makes the mask cost
  proportional to the render, not to the number of points.

**Consequences.** A browser without WebGL2 edits and exports the same documents, more slowly, and
the UI never pretends otherwise. The cost is that GPU-specific effects (blur, distortion) cannot be
added to one renderer alone, and every adjustment has to be expressible as a per-pixel function plus
a separable blur — which is also what makes the parity test possible.

## ADR-0025 — Motion export is a frame sequence, and the evaluator is the shared truth

**Status:** accepted (Phase 5).

**Context.** A motion editor promises "what you see is what you export". The tempting shape is a
preview implementation and an export implementation that are "kept in sync" — which is precisely how
the two drift apart. A video file would raise the same promise to "what you export plays back
correctly", and a codec is a much larger claim: container, muxing, keyframes, audio and a browser
support matrix that would have to be measured on real devices.

**Decision.**

- **One pure evaluator, two callers.** `src/core/motion/evaluate.ts` takes a document and a time and
  returns the document at that time. The preview paints the result; the exporter evaluates the same
  times and paints through the same `buildRenderPlan`/`paintPlan` pair. Neither has a private path.
- **Export is a PNG sequence plus a manifest, in a zip.** The manifest records the composition, the
  frame rate, the exact times and the file names, so the sequence can be reassembled elsewhere. The
  panel and the studio page say "frame sequence", never "video".
- **Times come from a plan, not from a clock.** `planMotionExport` computes the frame grid (inclusive
  start, exclusive end) before a canvas exists, refuses an empty range, more than 1800 frames, or an
  out-of-range scale, and reports those refusals as sentences. A 30 fps, 2 s export is exactly 60
  frames — not "about 60".
- **Frames are rendered one at a time.** Holding 30 canvases at 1080 px would allocate hundreds of
  megabytes; the exporter renders, encodes and releases each frame, reports progress by count and
  discards the partial archive when it is cancelled.
- **The graph editor edits the same curve the evaluator solves.** Easing is stored as CSS-style cubic
  control points, the editor drags those points, and the preset names map to the same numbers in one
  table — so a curve cannot look different in the editor and in the output.

**Consequences.** The parity claim is testable rather than aspirational: a Chromium spec downloads
the archive, decodes a PNG and compares it with the live preview canvas at the same timestamp. The
cost is that a user who expected an MP4 does not get one, and the studio must say so plainly — which
it does, in the export panel and in the capability ledger.

## ADR-0026 — Browser decoders, IndexedDB for bytes, and two honest exports

**Status:** accepted (Phase 6).

**Context.** Video is the first studio whose input and output are files the browser has to encode
and decode. Three temptations had to be refused: storing media in the document, pretending a
`<video>` element is frame-accurate, and offering "MP4 export" behind a button that cannot deliver
one. The available primitives are the media elements (universally supported, codec support decided by
the browser), `MediaRecorder` (widely supported, real-time only) and WebCodecs (powerful, not
available in every browser this project must run in — notably not in the CI browser).

**Decision.**

- **Bytes in IndexedDB, metadata in the document.** `MediaStore` is a small promise-based interface
  with an IndexedDB implementation and an in-memory fallback; the document references a media id and
  carries only name, duration, dimensions and size. A photo project embeds its image because it is
  capped at 2048 px; a video cannot.
- **Decode with media elements.** One element per file, created lazily and kept in a pool. This
  edits exactly the codecs the user's browser can play, which is the only claim that can be tested
  on their machine. WebCodecs would be faster and frame-exact, and is left as a future upgrade
  behind the same pool interface.
- **Two exports, each labelled for what it is.** A PNG frame sequence is deterministic: the plan
  fixes the times, every clip is seeked to its source time and the frame is painted by the same
  `paintVideoFrame` the preview uses, then zipped with a manifest. A WebM take is a real-time
  `MediaRecorder` capture of the same canvas plus the mixed audio graph; it is a *recording*, the
  panel says so, and the report names the container the browser negotiated. There is no MP4 claim.
- **Playback is a clock, not a fact about the file.** The transport owns time; elements are seeked
  when paused and drift-corrected while playing. Scrubbing is therefore exact, and a slow decode
  shows a `Decoding…` state rather than a silent freeze.

**Consequences.** The parity claim is testable: the browser suite compares a decoded exported frame
with the live preview at the same timestamp. The cost is a real limit — no proxy pipeline, so a very
large file scrubs as fast as the browser can seek it, and a capture takes as long as the edit. Both
limits are stated in the studio, the ledger and the roadmap rather than hidden.

## ADR-0027 — An optional, single-process server behind the repository boundary

**Status:** accepted (Phase 7).

**Context.** Phase 7 asks for a remote document repository, authentication, account settings, a
paginated catalogue and tests for authorization boundaries — while the product rule says local-first
must keep working without an account, and the repository must never imply a deployed service. Three
options were open: a hosted database (Supabase, Postgres, an ORM), a separate API service, or route
handlers in the app with a small store.

**Decision.** Route handlers inside the existing Next.js build, over a dependency-free JSON file
store, with:
- the platform's own document schema validating every write;
- optimistic concurrency on the document's `revision`, with a `409` carrying the server's revision
  and timestamp;
- scrypt password hashes and opaque session tokens stored only as SHA-256 digests, delivered in
  HttpOnly `SameSite=Lax` cookies;
- ownership scoping in the store, so another account's document is `404` rather than `403`;
- a deletion cascade (account → sessions, documents, index entries, share links) tested as one
  operation;
- an in-process write queue and atomic file replacement.

The UI is a settings panel that plans a sync before performing one. The plan is a pure function over
the local documents, the server's summaries and the last agreement this browser recorded, and it
treats "present on both sides with no history" as a conflict rather than picking a winner.

**Why not a database.** A database is the right next step, not the right first step: it would add a
service dependency, credentials in the environment and a schema toolchain to a repository whose
acceptance criteria are `npm ci && npm run verify && npm run test:e2e` on a clean machine. The store
is deliberately small and replaceable — the route handlers use only its methods — and ADR-0027's
successor (a database adapter) does not require touching them.

**Why not a separate API service.** One optional feature does not justify a second build, a second
dependency tree and a second deploy target, and sharing the document schema is what makes "the
server never stores what the app cannot open" true by construction.

**Consequences, stated plainly.**
- **One process per data directory.** Concurrent writers from two Node instances would race; the
  in-process queue protects only one process. This is in `docs/SERVER.md` next to the deployment
  steps, not in a footnote.
- **Rate limiting does not survive a restart** and does not coordinate across instances.
- **No email verification, password reset, OAuth or MFA**, and no billing — the last is a product
  decision, not a gap.
- **Conflict resolution is a choice, not a merge.** Two independently edited documents offer "keep
  this browser's copy" or "keep the server's copy"; there is no automatic three-way merge, and
  saying otherwise would be the most dangerous kind of dishonesty in this feature.

## ADR-0028 — Paint is geometry, and gradients are resolved from the shape's own bounds

**Status:** accepted (Phase 3 hardening). Schema v5.

**Context.** Phase 3's remaining honest gap was that shapes could only be painted with a flat colour.
Paint is where a vector editor most easily lies to itself: a preview drawn one way and an exported file
another, a gradient anchored to a shape in the editor and to the canvas in the file, or a "gradient"
that is really a bitmap baked at the zoom level it happened to be viewed at. The repository rules also
forbid adding a heavyweight graphics dependency without a compelling reason.

**Decision.** Paint is described once, in `src/core/vector/paint.ts`, in the vocabulary both renderers
speak:

- four kinds: `solid`, `linear-gradient`, `radial-gradient`, `pattern`;
- gradient points and centres are **fractions of the shape's bounding box** (`objectBoundingBox`
  semantics), and a radial radius is a fraction of the shorter side;
- a pattern is one of four deterministic motifs (`stripes`, `dots`, `grid`, `checks`) with a tile size
  as a fraction of the shorter side, a rotation about the bounds centre and a foreground/background
  colour — not a reference to arbitrary artwork;
- stops are sorted, clamped and de-duplicated by `normaliseStops`, so the stored document, the canvas
  gradient and the file always agree;
- the canvas painter builds a real `CanvasGradient` from `resolveGradient`, and draws a pattern by
  clipping to the path and tiling the motif's primitives — the same primitives `resolvePattern` hands
  the SVG writer;
- the SVG writer emits `userSpaceOnUse` definitions in absolute coordinates derived from the same
  bounds, positional ids (`paint-1`, …) so re-exporting is byte-identical, and a
  `data-forge-pattern` annotation on patterns so a re-import is exact;
- the importer accepts only same-document `url(#id)` references to definitions it actually read,
  converts absolute gradient coordinates back to shape-relative fractions, and reports anything it
  cannot represent as `approximated` while keeping the shape's solid colour.

**Why this over a library.** The four motifs and two gradient types cover the studio's stated scope,
are ~250 lines with no dependency, are resolution-independent, and are serialisable without an
intermediate bitmap. A full SVG-paint library would add a dependency and still not solve the harder
problem — that the preview and the file must agree — which is solved here by construction: one
resolver, two consumers.

**Why the schema version bumps to 5.** ADR-0005 requires a bump, a migration step and a fixture test
for every schema change. A v4 build reading a v5 document would silently drop `fillPaint`/
`strokePaint` (they are optional and unknown keys are stripped), which is exactly the silent field
loss ADR-0005 exists to prevent. The v4 → v5 migration rewrites nothing: a flat fill keeps its
meaning, and the new keys are simply absent. `src/core/documents/migrations.test.ts` proves that a v4
path document loads unchanged apart from its version stamp.

**Consequences, stated plainly.**
- Gradients cannot be anchored to strokes independently of the geometry, there is no gradient
  `spreadMethod`/focal radial support, and arbitrary imported `<pattern>` content is approximated to a
  solid colour rather than imitated.
- Pattern tiles are square and anchored to the bounds' top-left corner; there is no per-side tiling.
- A pattern is drawn as clipped primitives by the canvas painter, so a very small tile scale on a very
  large shape costs more draw calls than a real `CanvasPattern` would. The UI caps scale at 0.02 of the
  shorter side, and the painter's tile count is bounded by the shape's diagonal.
- Flat fills and strokes remain the default and the fallback everywhere. `representativeColour` can
  name a single colour for any consumer that genuinely needs one, and it is documented and tested as
  a stand-in — the renderers never use it, because drawing a gradient as its midpoint would be a lie
  about the file.
