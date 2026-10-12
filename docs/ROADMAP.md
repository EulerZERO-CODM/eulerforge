# Roadmap

The authoritative, machine-readable roadmap lives in **`src/core/platform/roadmap.ts`** and is
rendered in the app at **`/roadmap`**. Each entry carries a status, the items it depends on, the
capabilities it links to in the ledger, and measurable completion criteria. This document summarises
it; when the two disagree, the code and the ledger win, and that is a bug in this file.

Status vocabulary, used consistently everywhere:

| Status         | Meaning                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| `done`         | Finished, and every item carries evidence that exists in the repository.             |
| `partial`      | Working, with a specific gap named — never used to mean "probably fine".             |
| `in-progress`  | Actively being built; the UI may show a partial surface.                             |
| `planned`      | Designed and scheduled, not started.                                                 |
| `exploratory`  | A real possibility under evaluation; no commitment to a technology or a date.        |

Every item marked `done` lists its evidence in `roadmap.ts`, and the test suite fails if a named
test file does not exist. A phase is only `complete` when all of its items are.

## Implemented — Phase 1 (complete)

Foundation and platform shell. Exit criteria: `npm run verify` green, the shell navigable, project
creation producing validated documents, all studios declared with honest availability, and the
capability ledger rendering the truth about the build.

| Item                                | What it delivered                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Forge Core document model           | Schema, validation, migrations, units, geometry, presets                             |
| History and undo/redo integration   | Labelled linear history wired into the workspace                                     |
| Studio registry and discovery       | Six disciplines as data, validated at startup                                        |
| Application shell and starter flows | Navigation, home, creation flow, project library, workspace, settings, ledger         |
| Learning layer                      | 12 concepts, 6 tool explanations, 10 lessons with guided exercises                    |
| Asset catalogue boundary            | Provenance/licence model, query engine, labelled sample content                       |
| Quality gates                       | Strict TypeScript, type-aware ESLint, Prettier, Vitest, production build, CI workflow |

## Phase 2 — Design Studio editing (`in-progress`)

Depends on the Phase 1 document model and history. Exit criteria: a user can produce a real social
post or thumbnail inside the app and export it; a 30-layer document stays responsive on a mid-range
laptop; undo/redo covers every editing action with meaningful labels.

| Item                                | Status     | What it delivered                                                                                              |
| ----------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| Layer model and scene tree          | `done`     | Ordered text/rectangle/ellipse/graphic layers, stable ids, schema validation, v1 → v2 migration, commands with undo |
| Text tool with typography controls  | `done`     | Font stack, size, weight, line height, tracking, alignment, colour; wrapping inside the layer's box              |
| Selection, move, resize and snapping| `done`     | Selection from the artboard and the tree, visible handles, snapping to guides/grid/siblings, one commit per gesture |
| Raster export pipeline              | `partial`  | PNG and JPEG at the document's pixel size times a scale, transparency preserved, JPEG flattened onto a stated colour. Gap: pixel-for-pixel comparison with a real browser canvas has no automated runner here |
| Asset placement                     | `done`     | Ten repository-authored graphics placeable as image layers with licence, author and provenance recorded in the document; metadata-only records stay labelled reference-only |

Not part of this phase, and not claimed anywhere: multiple artboards per document, per-run text
styling, custom font uploads, reusable styles, templates and brand kits, vector (SVG/PDF) export.

### Manual browser checklist for Phase 2

The repository has no automated browser runner. These steps were written to be run by hand, and they
are listed rather than assumed; anything they cover stays out of the "tested" column until someone
does:

1. Open a project, add a rectangle, an ellipse and a text layer; drag each one and confirm the
   artboard updates while dragging and that the history panel gains exactly one entry per drag.
2. Resize a layer from each of the eight handles and confirm the opposite edge stays put (or moves
   symmetrically with Alt held), and that snapping can be toggled off from the toolbar.
3. Press Escape mid-drag and confirm the document is unchanged and no history entry appears.
4. Edit the text content and typography in the inspector; confirm the text rewraps inside its box
   and stays inside the frame at 25%, 100% and 200% zoom.
5. Place a graphic from the catalogue, confirm the attribution row appears in the document
   inspector, save, reload the page and confirm the graphic and its attribution come back.
6. Export PNG with transparency at 2x and JPEG at 1x; open both files and confirm the pixel
   dimensions are canvas size × scale, the stacking matches the artboard and the JPEG is flattened.
7. Reload with the image file removed from `public/forge-assets/` and confirm the export refuses
   with a named cause instead of producing a blank file.

## Planned after Phase 2

### Phase 3 — Vector engine and Illustration Studio

Path/geometry kernel, SVG view layer and export, then the Illustration Studio workspace on top of it.

### Phase 4 — Raster engine and Photo Studio

GPU raster engine, non-destructive adjustment stack, selections/masks/retouching, then the Photo
Studio workspace.

### Phase 5 — Motion Studio

Deterministic scene evaluator, keyframes/interpolation/graph editor, then the Motion Studio
workspace.

### Phase 6 — Video Studio

Media decoding and proxy pipeline, timeline model and editing operations, then the workspace and
export.

### Phase 7 — Persistence, accounts and collaboration

Remote document repository, authentication and account settings, remote asset catalogue. Each is
gated on the same rule: the local-first behaviour must remain fully functional without an account.

## Exploratory — not committed

Listed so they are visible rather than implied:

- **3D Studio** — depends on a renderer decision that has not been made; the registry entry records
  the open question instead of a choice.
- **Desktop application shell** — a Tauri/Electron wrapper is a plausible follow-up to the
  browser-first build; it is only worth doing once the browser experience is genuinely complete.
- **Studio plugin API** — a third-party extension surface. It needs a stability guarantee the
  registry cannot offer yet.
- **Adaptive learning** — sequenced lessons driven by progress data. Requires the learning progress
  model to mature and a privacy decision about what may be inferred.

## How work graduates

1. A capability is proposed as a roadmap item with measurable completion criteria.
2. It is implemented behind the existing boundaries; no shell rewrite, no faked surface.
3. It is added to the capability ledger with the evidence that verifies it.
4. It only moves to `done` when `npm run verify` passes and the evidence exists in the repository.

Anything that cannot meet step 3 stays `partial` or `planned`, and the UI says so.
