# Euler's Forge

**Create anything. Learn everything.**

Euler's Forge is a browser-first creative platform: one place to make design, photo, video, motion
and illustration work, with the learning material built into the same environment instead of
scattered across tutorials.

This repository contains the engineering foundation, the platform shell, and **five working
studios**:

- **Design Studio** — canvas setup (units, presets, guides, palette, metadata), an ordered layer
  scene of text, rectangle, ellipse and placed graphic layers, selection from the artboard or the
  layer tree, move/resize with snapping, typography and shape settings, undo/redo with labels,
  local-first saving, and a real PNG or JPEG export rendered from the same scene as the artboard.
  `.forge.json` project files round-trip the whole document, layers included.
- **Photo Studio** — a WebGL2 raster pipeline with a Canvas 2D reference fallback, an ordered
  twelve-entry adjustment stack with bypass and reordering, brush/lasso/erase masks, clone and heal
  retouching, and a real PNG/JPEG/WebP export re-rendered at the stored size.
- **Video Studio** — import local video and audio, place/trim/split clips on tracks with overwrite
  editing, add titles, set per-clip levels, scrub and play with the browser's own decoders, then
  export a deterministic PNG frame sequence or record a real-time WebM take.
- **Motion Studio** — keyframes for position, scale and opacity with eased or custom cubic curves, a
  timeline and graph editor, playback, and a PNG frame sequence that a browser test compares with the
  preview pixel for pixel.
- **Illustration Studio** — a framework-free vector kernel: pen paths, Bézier node editing, boolean
  operations with validated results, deterministic SVG import/export with an explicit report,
  text on a path, a selection-scoped icon-set ZIP, and image tracing that turns a PNG/JPEG/WebP into
  editable filled paths (palette, detail and speck threshold adjustable; one undoable step).

An **AI Creative Assistant** panel is mounted in Design, Photo and Illustration. It is a typed tool
registry with a deterministic native planner, an executor that applies the studios' own commands and
exporters, per-step verification and a checkpoint that can resume an interrupted run. It works with
no model and no key; a deployment may optionally point it at an OpenAI-compatible endpoint through
server-only environment variables, and every plan — native or model-written — is validated against
the registry before anything touches a document. It is not a chatbot and it does not claim tools it
does not have: Motion and Video show a refusal that names the missing tool.

**3D Studio** is the one remaining planned studio; its definition records the renderer decision
instead of a choice. Nothing here claims cloud sync, accounts, collaboration, 3D or AI features, and
the video encoder this build does not have (MP4) is labelled as missing rather than faked. Capabilities
that only exist in a browser — a real download, a real canvas raster, a real WebM recording — are
verified by a Chromium suite that runs in CI, and whatever even that cannot reach is listed as a
manual check in `docs/ROADMAP.md` rather than assumed.

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
| `npm run test:e2e`      | Playwright against the production build (`npm run build` first)     |
| `npm run test:e2e:install` | Installs the Chromium build Playwright drives                    |
| `npm run clean`         | Removes `.next`, `out` and `coverage`                               |

`.github/workflows/ci.yml` runs the same gates as separate steps (so a failure names the gate) plus a
coverage report, on Node 22.x and 24.x. A second job, `Browser (Chromium)`, installs Chromium and runs
`npm run test:e2e` against the production build: pointer capture, the browser's own rasteriser and real
file downloads cannot be verified in jsdom, so they are verified there instead of being described as
tested.

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

- Multiple artboards per document, per-run text styling, custom font upload, reusable styles,
  templates and brand kits, PDF output, curve-exact booleans, and shape rotation in the design
  model.
- MP4 encoding and offline (faster-than-real-time) video export; video proxies, transitions, fades
  and ducking. The three-minute export criterion is not met.
- Motion masks, imported illustration artboards inside motion documents, transitions and expressions.
- Photo blend modes beyond the documented adjustment stack, and a 12 MP/16 ms guarantee (the
  working copy and the measured budgets are stated in `docs/PERFORMANCE.md`, not assumed).
- Real-time collaboration, presence, teams and roles; email verification, password reset, OAuth and
  multi-factor authentication. The account server is optional, single-process and off by default.
- Billing, payments and telemetry (rejected at the schema level).
- A remote asset catalogue adapter, an AI tutor, and any assistant tool that does not exist in the
  registry.

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
  lib/browser/            The browser-only adapters (canvas element, file download)
  state/                  Application stores and React bindings
  testing/                Test-only helpers (in-memory services, App Router route resolver)
docs/                     Product vision, architecture, roadmap, decision records
```

Rules that keep this maintainable:

- `src/core/**` is framework-free. It has no React, no DOM and no `localStorage` access; browser
  calls live behind `src/lib/browser/**`, and ESLint fails the build if core reaches for one
  (ADR-0019). The single exception is the storage boundary, which probes `window.localStorage` behind
  a server-render guard to report volatility honestly.
- Components never import persistence directly; ESLint enforces it. They talk to stores in
  `src/state/**`, which talk to the repository boundary.
- Anything a user can click either does something real, or is visibly disabled/unavailable with the
  reason beside it. `docs/DECISIONS.md` → ADR-0010 records why.

## Documentation

- [`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md) — what the product is, who it is for, what it
  refuses to become.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, data flow, extension conventions.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — implemented / planned / exploratory, with exit criteria.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decision records (ADR-0001 … ADR-0032).
- [`docs/SERVER.md`](docs/SERVER.md) — the optional account/sync server: endpoints, data layout,
  migrations, local setup, tests and deployment limits.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — host requirements, environment variables, the
  serverless storage refusal and what a Vercel preview must be checked for.
- [`AGENTS.md`](AGENTS.md) — conventions for humans and coding agents working in this repository.

## Status and limitations

Five studios can create real work end to end, saved locally and reopened: Design (PNG/JPEG), Photo
(PNG/JPEG/WebP), Video (PNG sequence and a real-time WebM take), Motion (PNG sequence) and
Illustration (SVG and icon-set ZIP). Everything is stored in one browser profile on one device, so
exporting a project file is the only backup; video media bytes also stay in that browser's IndexedDB,
so moving a video project to another machine asks for the files again.

There is also an **optional, self-hosted server** (Phase 7): accounts with scrypt-hashed passwords,
revision-checked document sync with explicit conflict decisions, revocable read-only share links and
a paginated catalogue endpoint. It is off unless you run it, nothing in the app requires it, and its
storage is a single-process JSON file store documented in [`docs/SERVER.md`](docs/SERVER.md) — not a
deployment claim.

What is not implemented, and is labelled as such in the interface: multiple artboards per document,
per-run text styling, custom fonts, reusable styles, templates and brand kits, PDF output, MP4
encoding, video proxies and transitions, photo range selections and blend modes, motion masks and
imported artboards, 3D, real-time collaboration, and any billing or payments. Pointer capture, the browser's own canvas output and
file downloads are covered by `e2e/**`, a Playwright suite that drives the production build in a real
Chromium in CI; `docs/ROADMAP.md` lists what it still does not reach.

## Licence

UNLICENSED — proprietary. Sample catalogue records are authored for this repository under the
`forge-sample` licence and are not a production asset library.
