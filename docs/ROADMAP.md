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
| Raster export pipeline              | `done`     | PNG and JPEG at the document's pixel size times a scale, transparency preserved, JPEG flattened onto a stated colour; a real browser writes the files and the downloaded bytes are checked |
| Asset placement                     | `done`     | Ten repository-authored graphics placeable as image layers with licence, author and provenance recorded in the document; metadata-only records stay labelled reference-only |
| Undo/redo coverage for every editing action | `done` | Every document-changing control is one labelled, reversible step, checked at command, component and browser level; the enumeration, its provenance and the remaining gaps are in `docs/undo-redo-matrix.md` |
| Thirty-layer responsiveness         | `partial`  | A thirty-layer document can be built deterministically from the editor's own commands and is measured in a real browser against a budget fixed in advance (`e2e/performance.spec.ts`, `docs/PERFORMANCE.md`); it is measured under a four-fold CPU slowdown on CI hardware, not on a mid-range laptop |

Not part of this phase, and not claimed anywhere: multiple artboards per document, per-run text
styling, custom font uploads, reusable styles, templates and brand kits, vector (SVG/PDF) export.

### What the browser suite covers, and what it does not

`e2e/*.spec.ts` drives the production build in a real Chromium on every push, as a separate CI job
(`Browser (Chromium)`), so pointer capture, the browser's own rasteriser, file downloads and the
screens' honesty about storage are verified by a passing test rather than described as a manual
step. The suite opens a project, adds text and shape layers, selects and modifier-selects, moves a
selection, drags an unselected layer
without dragging the previous selection along, resizes a single object and a group (with undo),
cancels gestures with Escape, confirms locked layers are never transformed,
checks bulk duplicate and reorder, exercises the keyboard-only path (focusing the layer list,
editing the inspector fields, nudging with the arrow keys, and resizing from a focused handle), and
exports a PNG and a JPEG whose downloaded bytes are inspected (signature plus declared pixel size,
at 1x and 2x). One export spec decodes the PNG it downloaded and reads pixels out of it: a drawn
layer's fill is present, after the layer is hidden every pixel inside its frame is the canvas
background again, and turning the editing guides off changes neither the bytes nor the pixels where a
guide had been drawn. The suite also checks that the artboard's rendered box and the canvas backing
store match the zoom percentage at 100%, 200% and 25%, and that an export whose graphic cannot load is
blocked with the reason shown instead of writing a file.

Four scenarios are asserted in the browser rather than by hand:

1. Snapping against the rendered guide. `e2e/snapping.spec.ts` drags a layer so its centre stops three
   screen pixels short of the canvas centre line, at 25%, 100% and 200% zoom, and checks that the saved
   frame landed exactly on the target, that the guide element is drawn at the screen position the
   document implies (measured from the artboard's own box, never from a viewport offset), and that the
   strongest vertical line in a screenshot of the artboard - in rows the layer and its selection chrome
   do not occupy - is that guide.
2. Text wrapping under real font metrics. `e2e/text-wrapping.spec.ts` reads the ink rows back out of
   the artboard's own canvas at every zoom and compares the line groups, so a zoom level that rewrapped
   the text fails; narrowing the box re-wraps the content into lines that stay inside it, never fewer
   lines than the wider box and never more than the box can hold, and a text layer taller than its box
   paints nothing below it, which is what the export report has always told the user.
3. Storage refusal in a private window. `e2e/storage-restricted.spec.ts` makes browser storage refuse
   reads and writes before the application initialises: the app starts, says it is holding work in
   memory, never claims a durable save, keeps editing for the session, and loses the project on reload
   while saying so.
4. Attribution after reopening. `e2e/attribution.spec.ts` places a catalogue graphic through the
   picker, leaves the project, reopens it from the library, reselects the layer, and compares every
   value the panel shows with the record saved in the document and with the catalogue it came from.
5. Thirty-layer responsiveness, against a budget fixed before the first measurement.
   `e2e/performance.spec.ts` opens a document of thirty realistic layers - ten placed catalogue
   records with their licences, ten wrapping text layers and ten shapes, all placed by the editor's own
   commands - proves the browser really painted it (ink where the headline sits, and more colours
   inside a placed graphic than inside a flat plate of the same document), and then measures twelve
   real interactions: selecting a layer and a group, hiding and locking, committing inspector values,
   an opacity change from the keyboard, undo, redo, two drags and a resize handle. Latency is measured
   in the page from the input event's own timestamp to the second animation frame after it, and drags
   are measured by the gaps between animation frames; long tasks and slow input events are recorded
   alongside. The gated phase runs with a four-fold CPU slowdown through the DevTools protocol, the
   documented stand-in for slower hardware, and the same scenarios are reported again at full speed.
   Method, thresholds, measured results, environment and limitations are in `docs/PERFORMANCE.md`, and
   every run publishes its table to the pull request.

What is still *not* covered automatically, and therefore stays a manual check:

- Browsers other than Chromium: the job runs headless Chromium only.
- Responsiveness on a specific class of machine. The benchmark gates a budget on CI hardware under a
  controlled CPU slowdown; it is a regression gate for this repository, not a measurement of a
  mid-range laptop, and `docs/PERFORMANCE.md` says exactly what the proxy can and cannot stand for.
- Absolute font metrics: the wrapping spec asserts that one browser puts the same words on the same
  lines at every zoom, not that those line breaks match a reference font on another machine.

Run these by hand before claiming them; the roadmap items that depend on automated evidence cite the
spec files directly, and the gaps are recorded against the items they belong to.

## Phase 3 — Vector engine and Illustration Studio (in progress, one item partial)

### Path and geometry kernel — done

`src/core/vector/**` is an immutable, framework-free path model (contours of nodes with Bezier
handles), with bounds, transforms, arc-length sampling, fill/stroke hit-testing, node and handle
operations, pen construction and path-data serialisation. Boolean union/difference/intersection/xor go
through `polygon-clipping` (MIT) on flattened contours and every result is re-validated for topology.
Covered by `src/core/vector/*.test.ts` and `src/core/editor/vector-commands.test.ts`.

Known limits: booleans flatten curves first, so their output is polygonal; the interface reports the
tolerance and segment counts rather than hiding it. There is no offset/inflate operation.

### SVG view layer and export — done

`src/core/svg/**` serialises the model deterministically (computed `viewBox`, defaults omitted,
stable number formatting) and imports a defended subset back. The importer refuses scripts, event
handlers, `foreignObject`, external references and doctypes; it names anything it cannot carry instead
of approximating it. Round-trip tolerance is `1e-3` in user units (`src/core/svg/svg.test.ts`), and
`e2e/illustration.spec.ts` exports a file in Chromium, reads its bytes and re-imports them.

Known limits: text, gradients, filters, masks, clip paths and CSS style sheets are not importable; they
are reported, not dropped silently.

### Illustration Studio workspace — partial

`/studios/illustration` is a real, `available` studio with a working editor
(`src/components/illustration/**`): pen drawing, shapes, node/handle editing, marquee and keyboard
nudge, fill/stroke/opacity/cap/join/dash, boolean combination, shape-to-path conversion, SVG import and
export, selection-scoped icon-set zip export (only the selected visible paths, with anything it cannot
carry named), and Design ⇄ Illustration interchange with a per-layer report. Every edit is one
labelled history entry.

Still missing, and therefore still labelled planned in the registry: gradient and pattern fills,
tracing a raster image, text on a path, multi-artboard documents, and curve-exact booleans. Interchange
refuses rotated layers rather than baking the rotation into a frame. Icon sets contain path layers only:
a selected rectangle, ellipse, text or graphic layer is named as skipped, and shape layers must be
converted to paths first. The browser suite is Chromium only.

### Phase 4 — Raster engine and Photo Studio

Shipped, and still open. The raster engine is a WebGL2 fragment pipeline (one pass per adjustment)
with a Canvas 2D renderer that runs the shared CPU pipeline as the reference and the fallback. Both
renderers are exercised on the same document in Chromium: all twelve adjustments and a masked mix
agree within 2/255 per channel, and a browser that refuses WebGL2 falls back and says so (ADR-0024).

Photo Studio imports PNG, JPEG and WebP into a working copy capped at 2048 px and embedded in the
project, keeps the source pixels untouched behind an ordered twelve-entry adjustment stack (bypass,
reorder, remove, all undoable), paints brush/lasso/erase masks with a hardness feather and inversion,
retouches with clone and heal, autosaves, reopens, and exports real PNG, JPEG or WebP bytes from the
full stored copy. The browser spec downloads the PNG, re-imports it and asserts its pixels.

Still missing, and therefore still labelled partial or planned: range selections (by luminance,
colour or subject), multiple image layers, blend modes, curves, EXIF orientation, ICC/gamma-aware
output, tiling, and the roadmap's 12 MP / 16 ms measurement — the working copy cap means a 12 MP
document never reaches the renderer, and CI renders through SwiftShader rather than reference GPU
hardware. Preview renders are capped at 1280 px so interaction stays responsive; export re-renders
once at the stored size.

### Phase 5 — Motion Studio

Complete. `src/core/motion` is a pure evaluator: `evaluateDocumentAt(document, t)` returns the
document's scene at that time, and both the preview canvas and the frame exporter call it. Every
property is a keyframe track (position, scale around the frame's centre, opacity) with linear,
ease-in, ease-out, ease-in-out, hold and custom cubic Bézier easing; the graph editor drags the two
control points and the four values are also keyboard-editable.

The workspace has a timeline per animated property, a draggable playhead and draggable keyframes,
transport with frame stepping, layer creation, per-keyframe value editing, undo/redo and autosave.
Export renders a PNG sequence through the same render plan and painter as the preview and zips it
with a JSON manifest of the exact frame times; a Chromium spec decodes an exported frame and
compares it with the preview canvas at the same timestamp **pixel for pixel**.

Still missing, and labelled planned on the studio page: video-file export (a codec is a different
promise), imported illustration artboards, path layers, masks, transitions and expressions. The
browser suite is Chromium only.

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
