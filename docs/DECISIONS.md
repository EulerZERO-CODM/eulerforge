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
