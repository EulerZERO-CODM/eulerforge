# Architecture

This document describes how the repository is put together, why the boundaries sit where they do,
and how to extend the platform without touching the shell. Decisions are recorded in
[DECISIONS.md](DECISIONS.md); this file is the map.

## The one-paragraph version

The application is a Next.js App Router project. Everything under `src/core/**` is framework-free
domain code with no React, no DOM and no storage access; the few calls only a browser can make live
behind `src/lib/browser/**`, and the interface composes them with core values — ESLint enforces both
directions. `src/state/**` composes those modules into stores and exposes them to React through
`useSyncExternalStore`. `src/components/**` renders, and is forbidden from reaching into persistence —
ESLint enforces that too. `src/app/**` is thin routing: each route resolves data and renders a feature
component.

```
src/app/**                routes (server by default, client only where interaction requires it)
      │
src/components/**          feature + design-system components   ─ never import persistence
      │
src/state/**               stores, provider, hooks             ─ the only place React meets core
      │
src/core/**                documents, studios, assets, learning, persistence, export, history,
                           commands, events, preferences, platform  ─ framework-free and testable
      │
src/lib/**                 class names, store primitives, formatting, and the browser adapters
                           (src/lib/browser/**) that core deliberately does not contain
      │
e2e/**                     Playwright specs against the production build ─ nothing in src/ imports it
```

## Layers

### 1. Forge Core (`src/core/**`)

The parts every studio must share. Each module is small, pure where possible, and tested directly:

- **`documents/`** — the document model (`ForgeDocument`), Zod schemas, factories, migrations, unit
  conversion, canvas geometry, presets and field validation. A document is an immutable value:
  `createDocument` returns a frozen `Result`, and changes go through `applyDocumentPatch`.
- **`studios/`** — the studio registry. Definitions are data; `StudioRegistry` validates structure
  (unique slug, owned document types, honest availability) and records issues instead of throwing.
  `getRegistryIssues()` is asserted empty in tests, so authoring mistakes fail CI.
- **`assets/`** — the catalogue boundary (`AssetCatalog`), licence records, provenance model, and a
  pure query engine (filter → score → sort → paginate) with facet counting that ignores its own
  dimension. `data.ts` is the bundled sample catalogue: ten records point at repository-authored SVG
  files under `public/forge-assets/`, the rest are explicitly reference-only, and `isPlaceable()`
  is the single predicate the UI and the placement command both use (ADR-0008).
- **`learning/`** — concepts, tool explanations and lessons as typed content, plus query and
  integrity validation. Lessons reference studios by id and exercise steps link to real routes,
  which the test suite verifies.
- **`persistence/`** — `KeyValueStorage` and `DocumentRepository`. Both are promise-based so a remote
  adapter can replace the local one without touching callers (ADR-0006). `createBrowserStorage()`
  also reports the backend's *durability*, because an in-memory fallback must never be presented as a
  save (ADR-0006 → durability reporting).
- **`documents/layer-*.ts`, `documents/scene-geometry.ts`** — the scene model behind the editor:
  layer types and their settings (`layer-types`), the operations that add, update, duplicate, delete
  and reorder layers (`layer-operations`), the defaults a new layer starts from (`layer-defaults`),
  and the pure geometry the pointer interactions need — hit-testing, resize anchors and snapping
  targets (`scene-geometry`). Layer records are validated by the same Zod schema as the rest of the
  document, and `documents/validation.ts` adds the field-level messages a form can render.
- **`render/`** — the renderer, in two halves: `plan.ts` turns a document into an ordered, immutable
  list of paint operations plus any issues it found, and `paint.ts` draws that plan into anything
  that satisfies `PainterContext`. `text-layout.ts` and `measure.ts` do wrapping and alignment
  through an injected measure function. Nothing here imports React or touches a DOM: the browser
  canvas adapter lives in `src/lib/browser/canvas.ts` and is passed in as a factory (ADR-0016,
  ADR-0019).
- **`vector/`** — the framework-free path kernel: an immutable path model (contours of nodes with
  Bezier handles), bounds, transforms, flattening, arc-length sampling, fill/stroke hit-testing,
  node/handle operations, pen construction, shape generation, path-data serialisation, validation,
  and the boolean operations that go through `polygon-clipping` (ADR-0020, ADR-0021). One module,
  `tolerance.ts`, owns every numeric epsilon, and every fallible operation returns a `Result`.
- **`svg/`** — the SVG boundary: a deterministic serializer, a defended importer, the artwork model
  that sits between a scene and a file, the naive serializer the compact one is measured against, a
  stored-mode zip writer and the icon-set builder. It consumes the path model and never the editor.
- **`editor/`** — the interaction model: `selection.ts` (what is selected, never persisted),
  `commands.ts` (each edit as a label plus the patch that performs it) and `gesture.ts` (move and
  resize previews in document coordinates, resolved once on release, with snapping).
- **`export/`** — the format registry (which formats exist versus which are planned), the readiness
  checklist that evaluates a document against a format, the `.forge.json` project file format (whose
  payload is built here and saved by the caller), and the raster pipeline that rasterises a render
  plan offscreen (`raster.ts`) into an injected canvas. `URL.createObjectURL` and the `<a>` element
  live in `src/lib/browser/download.ts`, outside the core, so every file here stays testable with no
  browser at all.
- **`documents/zoom.ts`** — the canvas zoom arithmetic (setting + measured viewport → exact pixel
  box), kept out of the components so portrait, landscape, oversized zooms and `fit` are testable
  without a browser (ADR-0015).
- **`history/`, `commands/`, `events/`** — the linear undo/redo stack, the command registry behind
  Cmd/Ctrl + K, and the typed platform event bus.
- **`preferences/`** — user defaults with a tolerant loader (a corrupt record resets field by field
  rather than blocking the app).
- **`platform/`** — the capability ledger (`status.ts`), the roadmap (`roadmap.ts`) and lookup
  helpers. These drive `/platform-status` and `/roadmap`, so honesty is a data structure rather than
  a promise.

Interfaces are labelled as interfaces. Where a capability does not exist, the type carries a status
(`available`, `planned`, `exploratory`), the UI shows the status, and the ledger records the gap.

### 2. State (`src/state/**`)

Stores are plain classes with a `getState`/`subscribe` surface (`DocumentsStore`, `DocumentSession`,
`PreferencesStore`, `LearningProgressStore`, `ToastStore`). React binds to them with
`useSyncExternalStore` through `src/lib/use-store.ts`; there is no state-management dependency
(ADR-0007).

`DocumentSession` is the front door for editing: every change goes through
`commit(label, patch)`, which validates, records a labelled history step, persists through the
repository and updates the dirty/saving/error view state together — so undo, the save indicator and
storage can never disagree. A failed write keeps the document dirty and exposes `retrySave()`, which
the workspace wires to a "Try saving again" action.

`ForgeServices` also carries `storageStatus` (`src/state/storage-status.ts`), the durability
vocabulary the interface uses: components read it rather than importing persistence, which is what
keeps the "stored in this browser" claim honest when the browser has refused storage. That module
exposes `storagePhase()` (`persistent | volatile | undetermined`), the `STORAGE_PHASE_CLAIMS` record
of approved wording, and `storageBadge()`. Any surface that states something about storage switches
on the phase exhaustively — a boolean "is it volatile?" is not enough, because "not volatile" is not
"durable".

`ForgeProvider` is the composition root. It constructs the service graph once per tab; components
read it with hooks and never build repositories or catalogues themselves.

### 3. Presentation (`src/components/**`)

- `components/ui/**` — the design system: tokens come from `src/app/globals.css` (Tailwind v4
  `@theme`), and primitives cover buttons, fields, dialogs, menus, tooltips, notifications, cards,
  badges, progress, empty/loading/error states. Keep this set small; extend by variant, not by
  duplicating a primitive.
- `components/shell/**` — navigation, top bar, command palette, motion preference. The shell owns
  the chrome and loads the project library exactly once.
- Feature folders (`dashboard/`, `projects/`, `create/`, `workspace/`, `studios/`, `learning/`,
  `assets/`, `settings/`) own their composition and read state through hooks.

Presentational components never import from `src/core/persistence/**`; the ESLint rule
`no-restricted-imports` fails the build if they do.

### 4. Routes (`src/app/**`)

Routes render, they do not compute. Studio pages and lesson pages use `generateStaticParams` so the
same content is prerendered; `/workspace/[documentId]` is dynamic because it depends on the local
document library. Route integrity is covered by tests that resolve every declared navigation target
against the files under `src/app` (see `src/testing/routes.ts`).

## Editing pipeline

An edit on the artboard travels the same path as an inspector change, with one extra stage that
keeps history readable:

```
pointer down/up on the artboard
        ↓
editor/gesture.ts — preview only, in document coordinates, no React state in the document
        ↓ resolveGesture(...) → { scene, frame, unchanged }
        ↓
editor/commands.ts — one command: label + patch (move, resize, reorder, delete, settings, ...)
        ↓
WorkspaceApi.run(command) → DocumentSession.commit(label, patch)
```

Three rules hold this together:

1. **Transient state is not document state.** Selection, snappable guides, an in-flight drag and the
   current zoom live in component state or `src/core/editor`, never in `ForgeDocument`, so they are
   not persisted, not exported and not history entries. Only the resolved patch is committed.
2. **One gesture, one history step.** A drag previews on every pointer move and commits once on
   release; `unchanged` is true when the resolved frame equals the starting frame, and that produces
   no commit at all. Cancelling leaves the document exactly as it was.
3. **The renderer is shared.** The artboard and the export pipeline both consume
   `buildRenderPlan(document)` and both paint through `paintPlan`, so "what you see is what you
   export" is a property of the code rather than a promise (ADR-0016).

### The vector editing pipeline

The Illustration Studio reuses that pipeline end to end, with the path kernel in place of the frame
model:

```
pointer / keyboard on the vector stage (components/illustration/vector-stage.tsx)
        ↓ a gesture or a discrete action is resolved into one editor/vector-commands command
        ↓ each command re-derives the path layer's frame from its geometry
WorkspaceApi.run(command) → DocumentSession.commit(label, patch)   (same validation, same history)
        ↓
core/render/plan.ts paints path layers through the same painter the Design Studio uses
core/svg/from-scene.ts turns the same geometry into an SVG file
core/documents/interchange.ts converts the same layers for the other studio
```

Two boundaries are deliberate. The kernel never learns about SVG syntax or React (ADR-0020), so the
editor, the painter and the exporter are three consumers of one geometry. And a path layer's frame is
derived from its nodes rather than stored independently, so a moved node and a transformed box cannot
disagree; `setLayerFramesCommand` converts a box transform into a path transform.

## Data flow of a real edit

```
InspectorPanel (commit("Rename project", { title }))
        ↓
DocumentSession.commit
        ↓ validate (documents/validation)
        ↓ history.commit(label, next)      → HistoryStack (undo/redo, limit 100)
        ↓ persist(next)                    → DocumentsStore.update
        ↓                                    → isDocumentStructurallySound
        ↓                                    → DocumentRepository.save → localStorage
        ↓ emits document:saved on the bus
store state updates → useStore re-renders the workspace → save indicator shows "saved"
```

Undo walks the same path in reverse: `session.undo()` restores the previous value and re-persists
it, which is why the history panel and the document can never diverge.

## Adding to the platform

| Task                          | What to change                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A new studio                  | Add a definition in `src/core/studios/definitions.ts` with honest availability and an owned document type.        |
| A new document type           | Add it to `src/core/documents/document-types.ts`, then reference it from the studio that owns it.                 |
| A new lesson or concept       | Add content in `src/core/learning/content.ts`; `validateLearningContent()` and the tests check links.             |
| A new command                 | Add it in `src/components/shell/commands.ts`; commands that share a destination are merged automatically.         |
| A new screen                  | Add a route under `src/app/`, add it to `NAV_GROUPS` if it belongs in navigation, and link it from where it is needed. |
| A new storage backend         | Implement `KeyValueStorage` + `DocumentRepository`; no caller changes are required.                               |
| A new export format           | Add it to `src/core/export/formats.ts`, give it checks in `src/core/export/checklist.ts`, and only then tell the export panel to write it. |
| A new layer type              | Add the settings type in `documents/layer-types.ts`, the Zod schema, defaults, operations, a render operation in `render/plan.ts` + `render/paint.ts` and field validation — the schema and the renderer both reject what they do not understand. |
| A new sample asset file       | Add the SVG under `public/forge-assets/`, then a record in `src/core/assets/data.ts` pointing at it with licence and provenance. Nothing else: placement, attribution and export already read the record. |
| A new capability claim        | Add an entry to `src/core/platform/status.ts` with `verification` evidence; `/platform-status` renders it.        |
| A new zoom level or mode      | Add it to `src/core/documents/zoom.ts` with tests, and to the select in `document-stage.tsx` — never as CSS that caps the canvas. |
| A new storage backend         | Report its durability through `describeStorageBackend` so the interface can state whether a save survives a reload.   |

## Performance and accessibility expectations

- Static rendering wherever a page does not need client state; client components are leaves.
- Content set is imported as plain modules, so it tree-shakes and needs no data fetching layer.
- Every interactive control is reachable by keyboard; dialogs, menus and tooltips are Radix
  primitives with focus management built in; icon-only buttons take a mandatory `label`.
- Motion respects `prefers-reduced-motion` through `[data-motion='reduce']` and the in-app
  preference.
- Colour tokens are chosen for contrast on the dark graphite base; focus is always visible via the
  arc-coloured focus ring.

## Testing strategy

- `src/**/*.test.ts` covers the domain: schemas, factories, migrations, units, geometry, history,
  command ranking, the event bus, the registry, the catalogue query engine, export checks, the
  project file round trip, the repository, and the stores.
- `src/**/*.test.tsx` covers behaviour: the shell, the command palette, the workspace rail (against a
  real in-memory session) and lesson rendering.
- `src/testing/**` holds test-only infrastructure: an in-memory service graph, the App Router route
  resolver used to prove that no navigation target is dead, and layer/render/raster fixtures
  (`layers.ts`, `render.ts`, `raster.ts`). Raster tests rasterise for real through
  `@napi-rs/canvas` (a dev dependency) and assert on actual pixel values, so the export pipeline is
  tested against a canvas implementation rather than a mock.

What the unit suite cannot reach is covered by a browser suite instead of by assertion: `e2e/**`
drives the production build in a real Chromium (`@playwright/test`, a dev dependency, its own CI
job), because pointer capture, the browser's own canvas output and a real file download cannot be
verified in jsdom. It reads state from the same local storage the application writes, so it asserts
what the product actually persisted rather than what a test double was told. The application does not
import anything from `e2e/**`: the only hooks it exposes are inert `data-*` attributes the component
tests use too. The same suite decodes the artboard's own canvas pixels, so the positions the rendered
snapping guides occupy and the words each line of a text layer lands on are asserted as well, at 25%,
100% and 200% zoom (`e2e/snapping.spec.ts`, `e2e/text-wrapping.spec.ts`), and a session started with
browser storage refused is driven through the whole creation-and-edit flow
(`e2e/storage-restricted.spec.ts`). Phase 3 adds `e2e/illustration.spec.ts`, which creates a vector
document through the studio's real entry point, draws with the pen, edits nodes and Bezier handles,
performs a boolean operation in the browser (the regression that unit tests could not see: the
dependency resolves differently under the browser bundler), imports hostile SVG, downloads an SVG and
re-imports its own bytes, downloads an icon-set zip and checks its signature and manifest, and converts
artwork between the Design and Illustration documents in both directions. What even that cannot reach — other browser engines, the
responsiveness of a 30-layer document, font metrics that would only hold on one machine — is listed as
a manual check in `docs/ROADMAP.md` rather than quietly assumed.
