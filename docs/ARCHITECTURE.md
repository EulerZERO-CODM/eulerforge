# Architecture

This document describes how the repository is put together, why the boundaries sit where they do,
and how to extend the platform without touching the shell. Decisions are recorded in
[DECISIONS.md](DECISIONS.md); this file is the map.

## The one-paragraph version

The application is a Next.js App Router project. Everything under `src/core/**` is framework-free
domain code with no React, no DOM and no storage access. `src/state/**` composes those modules into
stores and exposes them to React through `useSyncExternalStore`. `src/components/**` renders, and is
forbidden from reaching into persistence — ESLint enforces that. `src/app/**` is thin routing: each
route resolves data and renders a feature component.

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
src/lib/**                 class names, store primitives, formatting
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
  dimension.
- **`learning/`** — concepts, tool explanations and lessons as typed content, plus query and
  integrity validation. Lessons reference studios by id and exercise steps link to real routes,
  which the test suite verifies.
- **`persistence/`** — `KeyValueStorage` and `DocumentRepository`. Both are promise-based so a remote
  adapter can replace the local one without touching callers (ADR-0006). `createBrowserStorage()`
  also reports the backend's *durability*, because an in-memory fallback must never be presented as a
  save (ADR-0006 → durability reporting).
- **`export/`** — the format registry (which formats exist versus which are planned), the readiness
  checklist that evaluates a document against a format, and the `.forge.json` project file format.
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
keeps the "stored in this browser" claim honest when the browser has refused storage.

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
| A new export format           | Add it to `src/core/export/formats.ts` and give it checks in `src/core/export/checklist.ts`.                       |
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
- `src/testing/**` holds test-only infrastructure: an in-memory service graph and the App Router
  route resolver used to prove that no navigation target is dead.

End-to-end browser tests are a planned roadmap item, deliberately not faked here.
