# Roadmap

The authoritative, machine-readable roadmap lives in **`src/core/platform/roadmap.ts`** and is
rendered in the app at **`/roadmap`**. Each entry carries a status, the items it depends on, the
capabilities it links to in the ledger, and measurable completion criteria. This document summarises
it; when the two disagree, the code and the ledger win, and that is a bug in this file.

Status vocabulary, used consistently everywhere:

| Status         | Meaning                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `done`         | Finished, with evidence recorded in the capability ledger.                      |
| `in-progress`  | Actively being built; the UI may show a partial surface.                        |
| `planned`      | Designed and scheduled, not started.                                            |
| `exploratory`  | A real possibility under evaluation; no commitment to a technology or a date.   |

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
| Learning layer                      | 12 concepts, 4 tool explanations, 10 lessons with guided exercises                    |
| Asset catalogue boundary            | Provenance/licence model, query engine, labelled sample content                       |
| Quality gates                       | Strict TypeScript, type-aware ESLint, Prettier, Vitest, production build, CI workflow |

## Planned

### Phase 2 — Design Studio editing

- Layer model and scene tree.
- Text tool with typography controls.
- Selection, move, resize and snapping.
- Raster export pipeline (which unblocks PNG/JPEG/WebP/PDF in the export panel).
- Asset placement from the catalogue into a document.

*Depends on:* Phase 1 document model and history. *Completion criteria* are listed per item in
`roadmap.ts` — for example, the raster pipeline is complete when a document exports to PNG at its
declared pixel size and the exported file matches the canvas geometry within one pixel.

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
