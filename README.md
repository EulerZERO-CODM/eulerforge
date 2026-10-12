# Euler's Forge

**Create anything. Learn everything.**

Euler's Forge is a browser-first creative platform: one place to make design, photo, video, motion
and illustration work, with the learning material built into the same environment instead of
scattered across tutorials.

This repository contains **Phase 1: the engineering foundation and the platform shell**, plus a
working **Phase 2: Design Studio editing** surface. In plain terms:

- A working, tested, type-checked application shell: navigation, home, project library, creation
  flow, studio discovery, learning hub, asset catalogue, settings, roadmap and a capability ledger.
- **Design Studio** is an editor, not a mockup: canvas setup (units, presets, guides, palette,
  metadata), an ordered layer scene of **text, rectangle, ellipse and placed graphic** layers,
  selection from the artboard or the layer tree, move and resize with visible handles, snapping to
  guides, grid lines and sibling edges, inspectable typography and shape settings, undo/redo with
  labels, local-first saving, and a real **PNG or JPEG export** rendered from the same scene as the
  artboard. `.forge.json` project files round-trip the whole document, layers included.
- Studio **definitions** exist for Photo, Video, Motion, Illustration and 3D, each with honest
  availability flags, planned capabilities and the engine boundary it will plug into. None of them
  pretends to be usable.

Nothing in this repository claims cloud sync, accounts, collaboration, vector export, video or AI
features. The places those will live are marked as interfaces, planned items, or unavailable — never
as working buttons. Where a capability is browser-only (a download, a real canvas raster) it is
described as covered by a manual checklist rather than by a passing test.

## Quick start

Requires Node.js 22.12 or newer (`.nvmrc` pins 22.22.3) and npm 10.

```bash
npm ci            # install exactly what package-lock.json pins
cp .env.example .env.local
npm run dev       # http://localhost:3000
```

Production build and run:

```bash
npm run build
npm start
```

## Commands

| Command                 | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run dev`           | Development server on port 3000                                     |
| `npm run build`         | Production build: type-checks and prerenders every static page      |
| `npm start`             | Serves the production build                                         |
| `npm run lint`          | ESLint (flat config, type-aware rules over `src/**`)                |
| `npm run lint:fix`      | ESLint with autofix                                                 |
| `npm run typecheck`     | `tsc --noEmit` against the strict project settings                  |
| `npm run format`        | Prettier write (includes the Tailwind class sorter)                 |
| `npm run format:check`  | Prettier check, used by CI                                          |
| `npm test`              | Vitest, single run (unit + component tests)                         |
| `npm run test:watch`    | Vitest in watch mode                                                |
| `npm run test:coverage` | Vitest with V8 coverage                                             |
| `npm run verify`        | Format check → lint → typecheck → tests → production build          |
| `npm run clean`         | Removes `.next`, `out` and `coverage`                               |

`.github/workflows/ci.yml` runs the same gates as separate steps (so a failure names the gate) plus a coverage report, on Node 22.x and 24.x.

## What is actually implemented

The authoritative list lives in the app itself at **`/platform-status`**, driven by
`src/core/platform/status.ts`, where every capability carries a status plus the evidence that
verifies it. A summary:

**Implemented (and covered by tests)**

- Document model with Zod validation at every trust boundary, immutable documents, schema versioning
  with a v0 → v1 migration path, unit conversion (px/mm/in), canvas geometry and 13 canvas presets.
- Local project storage in `localStorage` behind a promise-based repository boundary, with corrupt
  record handling, quota errors, a skipped-record report and device-local learning progress.
- Honest storage durability: when a browser refuses local storage (private mode, blocked site data),
  the app keeps working through an in-memory fallback and says so — a shell banner, a save indicator
  that reads "in memory only" instead of "saved", a storage row in Settings, and a retry for writes
  that genuinely fail. Server rendering claims nothing until the browser has been checked.
- A canvas stage whose zoom is real geometry: `fit` scales to the measured pane, explicit percentages
  render the document at exactly that multiple of its declared pixel size, portrait and landscape
  behave the same, oversized zooms scroll rather than being capped, and the interface states that a
  percentage maps document pixels to CSS pixels (not device pixels).
- Layout starters: three documented starting arrangements that preselect a canvas and the guides
  describing their regions — the interface is explicit that the user places the artwork, because
  nothing renders a layout yet.
- Undo/redo history, a command registry powering Cmd/Ctrl + K, and a typed platform event bus.
- Studio registry: six disciplines as data, validated at startup, with availability flags that the
  navigation, discovery pages and roadmap all read from.
- Learning layer: 12 concepts, 4 tool explanations and 10 published lessons, with guided exercises
  that link to real screens.
- Asset ecosystem: an extensible record model with licences and provenance, search, facets,
  pagination and clearly-labelled *sample* content only (no bundled third-party files).
- Export readiness checks per format, and a working `.forge.json` project file export (and import
  parser) for the document definition.
- Design system: tokens (colour, type, spacing, radius, elevation) plus buttons, fields, dialogs,
  menus, tooltips, notifications, cards, and explicit empty/loading/error states. Contrast of every
  text pairing is measured from the real token file by a test.
- Quality gates: strict TypeScript, type-aware ESLint, Prettier, Vitest (unit + component), and CI.

**Not implemented — stated as such in the UI**

- Any editing tool (no brushes, shapes, layers, selections, filters, timeline or 3D viewport).
- Rasterisation/rendering, so PNG, JPEG, WebP, SVG, PDF, MP4, WebM and glTF export are **blocked**
  in the export panel with the reason shown, not silently broken.
- Accounts, cloud sync, sharing, teams, billing and telemetry (all rejected at the schema level).
- A remote asset catalogue adapter, and an AI tutor.

## Project layout

```
src/
  app/                    Next.js App Router routes (one folder per screen)
  components/
    ui/                   Design-system primitives (button, field, dialog, states, …)
    shell/                Navigation, top bar, command palette, motion preference
    brand/                Logo and identity
    dashboard/ projects/ create/ workspace/ studios/ learning/ assets/ settings/
                          Feature areas; each owns its own composition, none owns global chrome
  config/env.ts           Environment parsing and validation
  core/                   Framework-free domain layer (no React, no DOM)
    documents/            Document model, schema, factories, migrations, units, geometry, presets
    studios/              Studio registry and definitions
    assets/               Catalogue types, licence records, sample data, query engine
    learning/             Concepts, lessons, tool explanations, content validation
    persistence/          Storage boundary and the local document repository
    export/               Format registry, readiness checklist, project file format
    history/ commands/ events/ preferences/ platform/
  lib/                    Tiny shared utilities (class names, store, formatting, hooks)
  state/                  Application stores and React bindings
  testing/                Test-only helpers (in-memory services, App Router route resolver)
docs/                     Product vision, architecture, roadmap, decision records
```

Rules that keep this maintainable:

- `src/core/**` is framework-free. It has no React, no DOM and no `localStorage` access.
- Components never import persistence directly; ESLint enforces it. They talk to stores in
  `src/state/**`, which talk to the repository boundary.
- Anything a user can click either does something real, or is visibly disabled/unavailable with the
  reason beside it. `docs/DECISIONS.md` → ADR-0010 records why.

## Documentation

- [`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md) — what the product is, who it is for, what it
  refuses to become.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, data flow, extension conventions.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — implemented / planned / exploratory, with exit criteria.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decision records (ADR-0001 … ADR-0017).
- [`AGENTS.md`](AGENTS.md) — conventions for humans and coding agents working in this repository.

## Status and limitations

One discipline — Design Studio — can create real artwork end to end: shapes, text and placed
graphics, edited on the artboard, saved locally, reopened, and exported as PNG or JPEG. Everything
is stored in one browser profile on one device, so exporting a project file is the only backup.

What is not implemented, and is labelled as such in the interface: multiple artboards per document,
per-run text styling, custom fonts, reusable styles, templates and brand kits, vector (SVG/PDF)
output, WebP and video, and every other studio. Pointer capture, the browser's own canvas output and
file downloads have no automated browser runner in this repository — `docs/ROADMAP.md` carries the
manual checklist for those, and roadmap items that depend on them stay `partial` rather than `done`.

## Licence

UNLICENSED — proprietary. Sample catalogue records are authored for this repository under the
`forge-sample` licence and are not a production asset library.
