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
6. The promises a first-time user relies on, in `e2e/readiness.spec.ts`. A **phone-sized window**
   (390 × 844) navigates through the drawer, never scrolls sideways, and creates, edits, saves,
   reloads and exports a real 320 × 240 PNG; with **every API request failed at the network layer**
   the studios, saving, reopening and export still work and the account panel says "Working locally,
   as designed"; and a **truncated saved index** is reported with the recovery step and a link to
   Settings › Local data, is not deleted behind the user's back, and leaves the product fully usable
   after the deliberate reset.

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

Fill and stroke can be a solid colour, a linear gradient, a radial gradient or a repeating motif
pattern (`stripes`, `dots`, `grid`, `checks`). Paint is stored as fractions of the shape's bounding box
and resolved against the same bounds by the canvas painter and the SVG writer, so the preview and the
file cannot drift; gradients are written in `userSpaceOnUse` coordinates and a pattern carries its
model parameters in a `data-forge-pattern` annotation that makes a re-import exact. Stops, direction,
tile scale and rotation are editable and undoable, and `src/core/svg/paint.test.ts`,
`src/core/vector/paint.test.ts`, `src/core/render/paint.test.ts` and
`src/core/documents/paint-schema.test.ts` cover the model, both renderers, the file format and the
schema boundary.

Known limits: import carries gradients expressible as shape-relative fractions and this project's four
motifs; arbitrary pattern content, gradient `href` inheritance, `spreadMethod` and focal radial
gradients are reported as approximated. Text, filters, masks, clip paths and CSS style sheets are not
importable; they are reported, not dropped silently.

### Illustration Studio workspace — partial (tracing done)

`/studios/illustration` is a real, `available` studio with a working editor
(`src/components/illustration/**`): pen drawing, shapes, node/handle editing, marquee and keyboard
nudge, fill/stroke/opacity/cap/join/dash, gradient and pattern paint for either slot (editable stops,
direction, motif, tile scale, background and rotation), boolean combination, shape-to-path conversion,
SVG import and export, selection-scoped icon-set zip export (only the selected visible paths, with
anything it cannot carry named), Design ⇄ Illustration interchange with a per-layer report, text
laid along a path — one editable run per path, with content, size, letter spacing, start offset,
baseline side, colour and font stack stored as parameters and drawn along the contour
(`src/core/vector/path-text.ts`, ADR-0030) — and image tracing.

Tracing (`src/core/vector/trace.ts`, `src/components/illustration/trace-panel.tsx`, ADR-0032) reads a
PNG, JPEG or WebP, builds a median-cut palette, assigns every pixel to a palette colour, chains the
pixel-lattice boundaries into closed loops, simplifies them and emits one filled path layer per
colour. Holes stay inner contours and are filled with the even-odd rule; regions below a chosen area
are dropped and counted in the panel; the trace is fitted and centred on the canvas and applied as a
single undoable step. Palette (1–16), detail (0–100) and the speck threshold are the user's controls.
The honest limits: boundaries are staircase polygons rather than fitted Bézier curves, the tracer
walks a 512 px working copy of a capped 1024 px scratch decode, and transparent pixels are not traced
at all, so a cut-out subject arrives without its background.

Every edit is one labelled history entry; paint changes and
text settings are clamped to the schema's documented ranges before they reach the document, and the
SVG boundary writes the run as a real `<text>`/`<textPath>` pair and reads that same form back.

Still missing, and therefore still labelled planned in the registry: multi-artboard documents and
curve-exact booleans. Text on a path is one run per path, drawn with a
system font stack — no per-glyph editing, second run or font embedding, so a document opened where a
stack is unavailable falls back to the system's own font. Interchange carries rotated geometry unchanged, because rotation lives in a path's nodes rather than
in a frame property; a rectangle or ellipse cannot be rotated in either studio. Icon sets contain path layers only: a selected rectangle,
ellipse, text or graphic layer is named as skipped, and shape layers must be converted to paths first.
The browser suite is Chromium only.

### AI Creative Assistant — partial

`src/core/assistant/**` is a typed tool registry (twelve native tools across photo, illustration and
design, plus motion and video entries that are explicitly `unavailable`), a deterministic native
planner, and an executor that applies the same document commands, history and exporters the interface
uses. A step is only successful when its tool reads the result back from the document; a failure stops
the line and marks the rest skipped; pause and cancel are checked between steps. The panel shows the
plan before it runs, the status and inspection of every step, the refusals with reasons and
alternatives, and an undo that goes through the studio's own history.

A run is a first-class object. Every finished step is checkpointed in this browser under its own key,
an interrupted request offers “Resume run” and continues from the first unfinished step instead of
applying the beginning twice, and a recoverable export failure is retried once and says that it was.
The panel is mounted in Photo, Illustration and Design. Motion and Video show a refusal surface that
names the missing tool (`motion.add_keyframe`, `video.trim`) and the controls that do work, rather than
a request field whose plans could only fail.

A deployment may configure an OpenAI-compatible chat endpoint with `ASSISTANT_PROVIDER_URL`,
`ASSISTANT_PROVIDER_KEY` and `ASSISTANT_PROVIDER_MODEL`. The browser posts a goal and a six-field
document summary to `/api/assistant/plan`; the server holds the credential, asks the model for a JSON
plan and validates every step against the registry before returning it. Without those variables the
native planner is the only planner, and the panel says so. The repository's own tests stub the
provider: **nothing in this build invokes a real model**, no generation tool exists in the registry,
and no plan can publish or share anything.

Still missing: only one wire format (OpenAI-compatible chat completions) has an adapter; there is no
image or video generation capability to integrate; the before/after comparison is the studio's own
canvas and history rather than an assistant-specific view; and motion and video remain uneditable by
the assistant.

### Phase 4 — Raster engine and Photo Studio

Shipped, and still open. The raster engine is a WebGL2 fragment pipeline (one pass per adjustment)
with a Canvas 2D renderer that runs the shared CPU pipeline as the reference and the fallback. Both
renderers are exercised on the same document in Chromium: all twelve adjustments and a masked mix
agree within 2/255 per channel, and a browser that refuses WebGL2 falls back and says so (ADR-0024).

Photo Studio imports PNG, JPEG and WebP into a working copy capped at 2048 px and embedded in the
project, keeps the source pixels untouched behind an ordered twelve-entry adjustment stack (bypass,
reorder, remove, all undoable), paints brush/lasso/erase masks with a hardness feather and inversion,
retouches with clone and heal, and selects pixels by luminance or colour — up to eight ranges per
mask, measured from the unadjusted source and unioned with painted strokes before inversion
(`src/core/photo/range.ts`, ADR-0029). Autosave, reopen and export are covered by the browser spec,
which downloads the PNG, re-imports it and asserts its pixels.

Still missing, and therefore still labelled partial or planned: subject selection and subtractive
ranges, multiple image layers, blend modes, curves, EXIF orientation, ICC/gamma-aware output and
tiling.

The 12 MP / 16 ms target has now been measured and **is not met on the CPU reference path**: at
4000 × 3000, one adjustment takes 1.09 s, four take 1.83 s and twelve take 5.30 s (median of three
passes; Node v22.22.3, 2 vCPU Xeon, 2026-10-19 — `FORGE_BENCH=1 npx vitest run
src/core/photo/pipeline.bench.test.ts`, table in `docs/PERFORMANCE.md` §8). The design answers that
honestly instead of hiding it: thumbnails/previews render at 1280 px, the stored working copy is
capped at 2048 px, and export renders once at that size. The GPU path that a real user gets with
WebGL2 has no 12 MP timing here because this environment cannot start a browser; CI renders through
SwiftShader rather than reference GPU hardware. Tiling would bound memory but not the per-pixel cost,
so it stays planned rather than being added to flatter the number.

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

Shipped, and still open. The timeline is real: video, audio and title tracks; clips placed, moved,
trimmed and split with millisecond-rounded times; an overwrite edit trims or removes whatever a new
clip covers, so a track never has two clips at the same moment. Trimming cannot invent footage past
either end of the source file. Every edit is one labelled command, so undo shows what happened.

Media bytes live in this browser's IndexedDB and the document keeps only metadata (name, duration,
size, dimensions). Import asks the browser's own decoder for the truth — a file it cannot decode is
refused with the reason rather than placed as a black rectangle — and a file whose header has no
duration (MediaRecorder output) gets the documented seek-past-the-end treatment. Playback composites
the decoded `<video>` elements onto a canvas, seeking exactly when paused and correcting drift while
playing; titles are drawn by the same function in the preview and in both exports.

Two exports exist and neither overclaims: a **PNG frame sequence** with a manifest of exact times
and the title text, rendered by seeking every clip frame by frame and zipped by the project's own
writer; and a **real-time WebM take** through `MediaRecorder` with the timeline's audio mixed in.
The browser spec downloads both: it parses the archive, decodes the frame whose manifest time is
0.4 s and compares it with the live preview canvas at 0.4 s — as an 8 × 8 thumbnail, because two
decoders seeking the same timestamp can land on adjacent frames when the source's own timestamps do
not align with the export grid — checks that a title's glyph coverage in an exported frame matches the
preview, and checks the recording's EBML magic number and byte count. The export seeks the decoder
once per frame and does not wait for a presentation callback, which was measured to add a per-frame
timeout without ever firing for a paused seek in the browser this project tests against.
There is no MP4 encoder and the panel says so.

Still missing, and therefore still labelled planned: proxy generation, ripple and roll editing,
transitions, fades and ducking, and any offline (faster-than-real-time) encode. The roadmap's
three-minute exit criterion is **partly** met and is stated precisely: the cap is 1 800 *frames*, not
seconds, so a three-minute timeline exports in one piece only at a reduced frame step — 1 350 frames
at step 4 (7.5 fps at a 30 fps composition) — while at the composition's own 30 fps the same range is
5 400 frames and is refused with the limit named. A real-time WebM capture is capped at two minutes.
The browser suite is Chromium only.

### Phase 7 — Persistence, accounts and collaboration

In progress. The remote boundary exists and is tested, as an **optional, self-hosted server** behind
the existing repository interface (ADR-0027). `docs/SERVER.md` documents the endpoints, the data
directory, the schema version, the tests and the deployment steps.

- **Documents.** Save, list, read and delete over HTTP, with the platform's own schema validating
  every write and optimistic concurrency on `revision`. A stale write is a `409` carrying the
  server's revision and timestamp; the client's sync plan turns that into a decision rather than an
  overwrite.
- **Accounts.** Registration, sign-in and sign-out; scrypt password hashes (parameters stored with
  the hash); opaque session tokens kept only as SHA-256 digests, delivered in HttpOnly `SameSite=Lax`
  cookies; profile rename; a password change that revokes every other session; account deletion
  that removes the account, its sessions, its documents and every share link pointing at one.
- **Sharing.** Revocable, expiring, read-only share links. The token is returned once; `/shared/:token`
  is a read-only page that offers the project file as a download.
- **Catalogue.** A paginated catalogue endpoint with licence and provenance on every record, over the
  repository-authored sample records — a real API, not a stock library.
- **Isolation.** Another account's document, share or session is `not-found`, and the authorization
  boundaries have their own tests, including cross-account reads, writes and deletions.
- **Deployment honesty.** A serverless host has no durable filesystem, so the account routes answer
  `503` with an explanation instead of writing to a directory that disappears; local-first editing is
  unaffected. `docs/SERVER.md` records the escape hatch (`FORGE_DATA_DIR` on a volume) and why it is
  not a database.

Still planned, and labelled so in the ledger and the studio pages: real-time collaboration and
presence; a database adapter for more than one process; email verification, password reset, OAuth and
multi-factor authentication; team roles. Rate limiting is in-process and does not survive a restart.
There is **no billing or payment system**, by explicit product decision, and none is planned.

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
