/**
 * Platform capability ledger.
 *
 * One place that answers "is this real?" for every capability the interface mentions. The
 * `/platform-status` page renders this data, and the test suite asserts that every `implemented`
 * entry names its verification evidence — so a claim cannot be added without something checkable
 * behind it.
 */

export type PlatformStatus = 'implemented' | 'partial' | 'planned' | 'exploratory';

export const PLATFORM_STATUS_LABELS: Readonly<Record<PlatformStatus, string>> = {
  implemented: 'Implemented',
  partial: 'Partially implemented',
  planned: 'Planned',
  exploratory: 'Exploratory',
};

export type PlatformArea = 'core' | 'shell' | 'learning' | 'assets' | 'studios' | 'platform';

export const PLATFORM_AREA_LABELS: Readonly<Record<PlatformArea, string>> = {
  core: 'Forge Core',
  shell: 'Application shell',
  learning: 'Learning layer',
  assets: 'Asset ecosystem',
  studios: 'Studios',
  platform: 'Engineering platform',
};

export type PlatformCapability = {
  readonly id: string;
  readonly area: PlatformArea;
  readonly label: string;
  readonly description: string;
  readonly status: PlatformStatus;
  /**
   * How the claim is verified: test file names, commands, or a manual instruction.
   * Required for `implemented`; the test suite enforces it.
   */
  readonly verification: readonly string[];
  /** What is missing, for partial/planned entries. */
  readonly gap?: string;
  readonly docsHref?: string;
};

export const PLATFORM_CAPABILITIES: readonly PlatformCapability[] = [
  {
    id: 'core.document-model',
    area: 'core',
    label: 'Document model with schema validation',
    description:
      'Documents are immutable values validated by Zod at every trust boundary: user input, storage reads and export files.',
    status: 'implemented',
    verification: ['src/core/documents/factories.test.ts', 'src/core/documents/schema.test.ts'],
  },
  {
    id: 'core.migrations',
    area: 'core',
    label: 'Schema versioning and migration chain',
    description:
      'Stored documents carry a schema version. Older records are migrated forward on load; records from a newer app version are refused with a clear message.',
    status: 'implemented',
    verification: ['src/core/documents/migrations.test.ts'],
  },
  {
    id: 'core.history',
    area: 'core',
    label: 'Undo/redo history stack',
    description:
      'A framework-free immutable history used by the workspace: labelled steps, bounded depth, deterministic undo/redo.',
    status: 'implemented',
    verification: ['src/core/history/history.test.ts'],
  },
  {
    id: 'core.unit-conversion',
    area: 'core',
    label: 'Unit conversion and canvas geometry',
    description:
      'Pixels, millimetres and inches convert at a stated DPI; aspect ratios, safe areas, bleed bands and grid positions are computed in pure functions.',
    status: 'implemented',
    verification: ['src/core/documents/units.test.ts', 'src/core/documents/geometry.test.ts'],
  },
  {
    id: 'core.export-checks',
    area: 'core',
    label: 'Export readiness checks',
    description:
      'Format-specific evaluation of a document with pass/warning/blocked results and remedies.',
    status: 'implemented',
    verification: ['src/core/export/checklist.test.ts'],
  },
  {
    id: 'core.project-file',
    area: 'core',
    label: 'Project file export (.forge.json)',
    description:
      'The document definition can be downloaded and read back. Raster PNG/JPEG/WebP, vector SVG, a PNG frame sequence and — from Video Studio — a real-time WebM capture are the other implemented exports; the format registry labels PDF and MP4 as planned.',
    status: 'implemented',
    verification: ['src/core/export/project-file.test.ts'],
  },
  {
    id: 'core.vector-model',
    area: 'core',
    label: 'Vector path kernel (framework-free)',
    description:
      'An immutable path model — move/line/curve segments, open and closed contours — with validation, bounds, transforms, arc-length sampling, stroke/fill hit-testing, node and handle editing, shape generation and serialisable path data. It lives under `src/core/vector` and imports no DOM, React, storage or SVG type, so the editor and the exporter both read the same geometry.',
    status: 'implemented',
    verification: [
      'src/core/vector/path.test.ts',
      'src/core/vector/geometry.test.ts',
      'src/core/vector/path-data.test.ts',
      'src/core/vector/validity.test.ts',
      'src/core/vector/ops.test.ts',
      'src/core/vector/shapes.test.ts',
      'src/core/vector/pen.test.ts',
      'src/core/vector/pick.test.ts',
    ],
    gap: 'Every contour is a single closed or open boundary with no self-intersection repair, and the kernel exposes no offset/inflate operation.',
  },
  {
    id: 'core.vector-booleans',
    area: 'core',
    label: 'Boolean path operations',
    description:
      'Union, difference, intersection and exclusive-or combine flattened contours through `polygon-clipping` (MIT, chosen over hand-rolling a Bentley–Ottmann/Martinez kernel — see ADR-0021). Results are re-validated as contours and reported with the flattening tolerance, flattened segment counts and any topology problems.',
    status: 'implemented',
    verification: [
      'src/core/vector/boolean.test.ts',
      'src/core/vector/validity.test.ts',
      'src/core/editor/vector-commands.test.ts',
      'src/components/illustration/illustration-workspace.test.tsx',
    ],
    gap: 'Inputs are flattened to line segments at `TOLERANCE.flatten` (0.05 px) first, so a boolean result is polygonal: curve handles do not survive the operation, and anything built on it carries that approximation.',
  },
  {
    id: 'core.svg-io',
    area: 'core',
    label: 'SVG serialisation and safe import',
    description:
      'A deterministic serializer writes paths, shapes, fills, strokes, opacity, transforms, linear/radial gradients and repeating motif patterns with a computed `viewBox`, drops redundant markup and omits defaults. Gradients are written in `userSpaceOnUse` coordinates resolved from the shape bounds, so the canvas preview and the file describe the same geometry. The importer rejects scripts, event handlers, `foreignObject`, external references and doctypes, reports malformed input with a message, and re-imports its own output within a documented tolerance (1e-3 in user units).',
    status: 'implemented',
    verification: [
      'src/core/svg/svg.test.ts',
      'src/core/svg/paint.test.ts',
      'src/core/vector/paint.test.ts',
      'src/core/render/paint.test.ts',
      'src/core/svg/from-scene.test.ts',
      'src/core/svg/icon-set.test.ts',
      'src/core/export/checklist.test.ts',
    ],
    gap: "Import carries linear and radial gradients whose geometry can be expressed as shape-relative fractions, and this project's four pattern motifs through their written annotation. Arbitrary `<pattern>` content, gradient `href` inheritance, `spreadMethod`, focal radial gradients, text, filters, masks, clip paths and CSS style sheets are reported as unsupported or approximated rather than silently dropped.",
  },
  {
    id: 'core.rendering',
    area: 'core',
    label: 'Rasterisation / rendering pipeline',
    description:
      'One render plan and one painter turn a document into pixels, used by the live artboard and by offscreen PNG/JPEG export alike (ADR-0016).',
    status: 'implemented',
    verification: [
      'src/core/render/text-layout.test.ts',
      'src/core/render/plan.test.ts',
      'src/core/render/paint.test.ts',
      'src/core/export/raster.test.ts (real pixels through @napi-rs/canvas)',
      "e2e/export.spec.ts (the browser's own rasteriser writes the file)",
      'e2e/text-wrapping.spec.ts (the same wrapped lines at every zoom, read back from the artboard canvas)',
    ],
    gap: 'The painter writes raster only. PDF is still planned, and video is produced by Video Studio from decoded media and a canvas capture rather than from this render plan.',
  },
  {
    id: 'shell.navigation',
    area: 'shell',
    label: 'Global navigation and responsive layout',
    description:
      'Persistent navigation, mobile sheet navigation, skip link, focus-visible states and accessible landmarks.',
    status: 'implemented',
    verification: [
      'src/components/shell/app-shell.test.tsx',
      'Manual check: keyboard tab order from the skip link through the sidebar',
    ],
  },
  {
    id: 'shell.design-system',
    area: 'shell',
    label: 'Design tokens and reusable UI primitives',
    description:
      'Colour, typography, spacing, radius and elevation tokens plus the shared primitives — buttons, fields, dialogs, menus, tooltips, notifications, cards and explicit empty/loading/error states — that every screen composes.',
    status: 'implemented',
    verification: ['src/components/ui/contrast.test.ts', 'src/components/ui/button.test.tsx'],
  },
  {
    id: 'shell.command-palette',
    area: 'shell',
    label: 'Command palette and keyboard conventions',
    description:
      'Cmd/Ctrl + K opens a searchable command list. Commands are data, so new actions are registered rather than hard-coded into the shell.',
    status: 'implemented',
    verification: [
      'src/core/commands/registry.test.ts',
      'src/components/shell/command-palette.test.tsx',
    ],
  },
  {
    id: 'shell.project-library',
    area: 'shell',
    label: 'Local project library',
    description:
      'Projects are created, listed, edited and deleted in this browser via a storage repository interface. Device-local only, and when the browser refuses storage the library says so instead of pretending to save.',
    status: 'implemented',
    verification: [
      'src/core/persistence/document-repository.test.ts',
      'src/state/documents-store.test.ts',
    ],
  },
  {
    id: 'shell.cloud-persistence',
    area: 'shell',
    label: 'Optional server sync',
    description:
      'Everything stays device-local by default. For users who run the optional server, the settings panel plans a sync first — upload, download or conflict, each with a reason — and a document changed on both sides is a decision, never an automatic overwrite. The plan is a pure function over local documents, server summaries and the last agreement this browser recorded.',
    status: 'partial',
    verification: [
      'src/core/account/sync.ts',
      'src/core/account/sync.test.ts',
      'src/components/account/account-panel.test.tsx',
      'src/server/routes.test.ts (revision conflicts, cross-account isolation)',
    ],
    gap: 'One process with a JSON file store, no collaboration or presence, and no automatic background sync: a user asks for the plan and runs it. A multi-node deployment would need a real database and a shared lock — neither exists here.',
  },
  {
    id: 'learn.hub',
    area: 'learning',
    label: 'Learning hub with curated content',
    description:
      'Typed lessons, glossary concepts, guided exercises and contextual tool explanations, rendered from validated data.',
    status: 'implemented',
    verification: [
      'src/core/learning/query.test.ts',
      'src/components/learning/lesson-view.test.tsx',
    ],
  },
  {
    id: 'learn.progress',
    area: 'learning',
    label: 'Lesson progress tracking',
    description: 'Completed lessons and exercise steps are recorded locally for this device.',
    status: 'implemented',
    verification: ['src/state/learning-progress-store.test.ts'],
  },
  {
    id: 'learn.adaptive-tutor',
    area: 'learning',
    label: 'AI tutor and adaptive lessons',
    description: 'Interactive tutoring that responds to what a learner does.',
    status: 'exploratory',
    verification: [],
    gap: 'No model integration, no evaluation of answer quality, and no privacy review. Explicitly out of scope for this phase.',
  },
  {
    id: 'assets.catalogue',
    area: 'assets',
    label: 'Paginated asset catalogue with licence metadata',
    description:
      'Filtering, sorting, pagination, facet counts, licence and provenance records, and an explicit notice that the bundled records are samples.',
    status: 'implemented',
    verification: ['src/core/assets/query.test.ts', 'src/core/assets/catalog.test.ts'],
  },
  {
    id: 'assets.remote-catalogue',
    area: 'assets',
    label: 'Paginated catalogue API',
    description:
      'A paginated, filterable catalogue endpoint with licence and provenance on every record, served from the repository-authored sample records. It is a real API over sample content, not a library of third-party assets.',
    status: 'partial',
    verification: [
      'src/app/api/catalogue/route.ts',
      'src/server/routes.test.ts (paging, filters, licence and provenance)',
    ],
    gap: 'The records are the bundled sample catalogue. There are no licensing agreements, no hosted originals and no CDN: the endpoint makes the existing catalogue reachable, it does not become a stock library.',
  },
  {
    id: 'assets.usable-files',
    area: 'assets',
    label: 'Assets that can be placed in a document',
    description:
      'Ten repository-authored SVG graphics and textures ship with the build and can be placed as image layers; placement records licence, author and provenance in the document, and metadata-only records are labelled as reference-only.',
    status: 'implemented',
    verification: [
      'src/core/assets/catalog.test.ts',
      'src/core/editor/commands.test.ts',
      'src/components/workspace/graphic-picker.test.tsx',
      'src/components/workspace/workspace-editor.test.tsx',
      'e2e/attribution.spec.ts (a placed graphic keeps its licence and provenance after the project is left and reopened)',
    ],
    gap: 'The catalogue is a bundled sample, not a library: templates, fonts, components and palettes remain reference records.',
  },
  {
    id: 'studios.registry',
    area: 'studios',
    label: 'Typed studio registry and discovery',
    description:
      'Studios are declared as data with honest availability flags; the shell, navigation and discovery pages are all driven by the registry.',
    status: 'implemented',
    verification: ['src/core/studios/registry.test.ts', 'src/core/studios/definitions.test.ts'],
  },
  {
    id: 'studios.design',
    area: 'studios',
    label: 'Design Studio workspace',
    description:
      'Document setup, guides, units, palette, metadata, history/undo and export readiness, plus a real editor: add text, rectangles, ellipses and catalogue graphics, select and transform them on the artboard, edit typography and shape settings, and export PNG or JPEG.',
    status: 'partial',
    verification: [
      'src/components/workspace/workspace-editor.test.tsx',
      'src/components/workspace/document-aside.test.tsx',
      'src/components/workspace/document-stage.test.tsx',
      'src/core/editor/commands.test.ts',
      'src/core/editor/gesture.test.ts',
      'e2e/workspace.spec.ts',
      'e2e/snapping.spec.ts',
      'e2e/text-wrapping.spec.ts',
      'e2e/export.spec.ts',
      'e2e/storage-restricted.spec.ts',
      'e2e/attribution.spec.ts',
      'e2e/performance.spec.ts',
      'e2e/undo-redo.spec.ts',
      'src/components/workspace/undo-redo.test.tsx',
    ],
    gap: 'The browser suite runs on Chromium only, so Firefox and WebKit rendering is unverified. Thirty-layer responsiveness is measured in a real browser against a budget fixed in advance (docs/PERFORMANCE.md), but under a four-fold CPU slowdown on CI hardware rather than on a mid-range laptop, so it is a regression gate and not a claim about a particular machine. Grouping, alignment tools, vector paths and PDF output are later phases and are labelled as such.',
  },
  {
    id: 'studios.illustration',
    area: 'studios',
    label: 'Illustration Studio vector editor',
    description:
      'A real vector workspace on the shared kernel: draw with the pen, place rectangles/ellipses/polygons, drag out shapes, edit nodes and Bezier handles, marquee-select, nudge and transform, set real fill/stroke/opacity/cap/join/dash, paint either slot with a linear gradient, a radial gradient or a repeating motif pattern (editable stops, direction, tile scale and rotation), lay an editable run of text along a path’s own contour (content, size, spacing, start offset, baseline side, colour and font stack, following the geometry and exported as a real <textPath>), run boolean operations, convert shapes to editable paths, import and export SVG, export an icon set from the selection (unselected, hidden and non-path layers are never packaged; anything it cannot carry is named), and hand artwork to the Design Studio and back. Every edit is one labelled undoable action, and the studio links its limitations instead of hiding them.',
    status: 'partial',
    verification: [
      'src/components/illustration/illustration-workspace.test.tsx',
      'src/components/illustration/paint-controls.tsx',
      'src/core/editor/vector-commands.test.ts',
      'src/core/documents/interchange.test.ts',
      'src/core/documents/paint-schema.test.ts',
      'src/core/vector/path-text.test.ts',
      'src/core/render/paint.test.ts',
      'src/core/svg/svg.test.ts',
      'src/components/create/creation-flow.test.tsx',
    ],
    gap: 'Tracing a raster image and ungrouped multi-artboard documents are not implemented and are labelled planned in the registry. Text on a path is one run per path: there is no second run, no per-glyph editing and no font embedding, so a file opened where the chosen system stack is missing falls back to that system’s own font. Interchange uses axis-aligned frames in both studios: a rotated path is carried as rotated geometry and crosses unchanged, while a rectangle or ellipse cannot be rotated in the first place. Node editing works on one path at a time. The browser suite runs on Chromium only, so Firefox and WebKit are unverified.',
  },
  {
    id: 'studios.photo',
    area: 'studios',
    label: 'Photo Studio',
    description:
      'A real raster editor on the shared document/history interfaces: import PNG, JPEG or WebP into a capped working copy embedded in the project, build an ordered non-destructive adjustment stack with bypass and reordering, paint brush/lasso/erase masks and invert them, clone and heal retouch, render through a WebGL2 fragment pipeline with a Canvas 2D reference fallback, then export PNG, JPEG or WebP bytes from the full working copy.',
    status: 'partial',
    verification: [
      'src/components/photo/photo-workspace.test.tsx',
      'src/core/photo/pipeline.test.ts',
      'src/core/photo/pipeline.perf.test.ts',
      'src/core/photo/commands.test.ts',
      'src/core/photo/export.test.ts',
      'src/components/photo/photo-workspace.test.tsx',
      'e2e/photo.spec.ts',
    ],
    gap: 'One photograph per document: multiple image layers, blend modes, curves and EXIF-aware orientation are not implemented and are listed as planned on the studio page. Colour management is sRGB-only and the browser’s own encoder decides what the exported file looks like. The working copy is capped at 2048 px on the long edge, so the roadmap’s 12-megapixel target is bounded by that cap rather than met; previews render at most 1280 px and export re-renders once at the stored size. GPU parity is measured under SwiftShader software rendering in CI, not on reference GPU hardware, and the browser suite runs on Chromium only.',
  },
  {
    id: 'photo.raster-engine',
    area: 'studios',
    label: 'WebGL2 raster engine with a reference fallback',
    description:
      'One code path decides between a WebGL2 renderer that performs one fragment pass per adjustment and a Canvas 2D renderer running the shared CPU pipeline; masks are rasterised to a single strength byte per pixel, and both renderers are checked against each other on the same document.',
    status: 'implemented',
    verification: [
      'src/lib/browser/photo-engine.ts (renderPhoto, detectWebgl2, rasteriseMask)',
      'e2e/photo.spec.ts (all twelve adjustments and a masked mix compared across renderers within 2/255 per channel; a browser that refuses WebGL2 falls back and says so)',
      'src/core/photo/pipeline.test.ts',
      'src/core/photo/pipeline.perf.test.ts',
    ],
    gap: 'The measured 12 MP / 16 ms target in the roadmap is a fragment-shader claim measured nowhere in this repository: the sandbox renders through SwiftShader, the working copy is capped at 2048 px, and no reference GPU hardware was available. What is verified is parity between the two renderers and a bounded CPU cost at preview resolution.',
  },
  {
    id: 'photo.adjustments',
    area: 'studios',
    label: 'Non-destructive adjustment stack',
    description:
      'Twelve tonal and colour adjustments (exposure, contrast, saturation, temperature, tint, highlights, shadows, vibrance, clarity, grayscale, sepia, vignette) applied in stack order, each with a value, bypass, reorder and remove, stored in the document payload and undoable as labelled commands.',
    status: 'implemented',
    verification: [
      'src/core/photo/commands.test.ts',
      'src/core/photo/pipeline.test.ts',
      'src/components/photo/photo-workspace.test.tsx',
      'e2e/photo.spec.ts (ordering changes the result; bypass leaves the source pixels untouched)',
    ],
  },
  {
    id: 'assistant.core',
    area: 'studios',
    label: 'AI Creative Assistant (native planner)',
    description:
      'A typed tool registry, a deterministic planner, an executor that applies real document commands and a panel that shows the plan, streams a status per step, and can pause or cancel between steps. Twelve tools span photo adjustments, range selections and export; illustration fill, stroke, text-on-path and SVG export; and design text and rectangle layers. Every step is validated before it runs and verifies the document afterwards; steps after a failure are reported as skipped, completed steps are ordinary undoable history entries, and a recoverable export failure is retried once. A run is checkpointed after every finished step, so an interrupted request can resume from the first unfinished step. The panel is mounted in Photo, Illustration and Design; Motion and Video show a refusal surface that names the missing tool and the controls that do work. A server-side route can plan with an OpenAI-compatible model when the deployment sets ASSISTANT_PROVIDER_URL, ASSISTANT_PROVIDER_KEY and ASSISTANT_PROVIDER_MODEL; the credential never reaches the browser, and every proposed step is validated against the registry. With no provider configured the native planner is used, and the panel says so.',
    status: 'partial',
    verification: [
      'src/core/assistant/assistant.test.ts',
      'src/core/assistant/provider.test.ts',
      'src/core/assistant/checkpoint.test.ts',
      'src/server/assistant-plan.test.ts',
      'src/lib/browser/assistant-runs.test.ts',
      'src/components/illustration/illustration-workspace.test.tsx (plan, run, refuse, undo, provider plan, resume)',
      'src/components/photo/photo-workspace.test.tsx (a three-step plan exports the live document)',
      'src/components/motion/motion-workspace.test.tsx and src/components/video/video-workspace.test.tsx (refusal surfaces)',
      'e2e/assistant.spec.ts (a photo task’s downloaded PNG is decoded, and a design plan is read back from storage)',
    ],
    gap: 'Only one provider wire format (OpenAI-compatible chat completions) has an adapter, and nothing here has been run against a real model or key. The registry has no image- or video-generation tool, because the product has no such capability to integrate. The before/after view is the studio canvas and its history, not an assistant-specific comparison, and Motion and Video remain uneditable by the assistant. A plan is a single request: there is no follow-up conversation that revises it in place.',
  },
  {
    id: 'photo.masks',
    area: 'studios',
    label: 'Masking and retouching',
    description:
      'Brush, lasso and erase mask strokes with per-stroke radius and hardness, plus up to eight luminance or colour range selections measured from the source pixels. Strokes and ranges union into one strength map before inversion, with clearing and clearing-everything available, plus a clone stamp with a sampled source offset and a heal brush that blends towards a blurred local copy. Everything is normalised and serialisable, so the mask survives save and reload.',
    status: 'partial',
    verification: [
      'src/core/photo/commands.test.ts',
      'src/core/photo/range.test.ts',
      'src/core/photo/range.perf.test.ts',
      'src/components/photo/photo-workspace.test.tsx',
      'e2e/photo.spec.ts (a painted or range-selected stack only changes the selected area, inversion covers the rest, heal leaves the edges untouched)',
    ],
    gap: 'Subject/foreground selection is not implemented: ranges select by luminance or colour only. Ranges are additive (no subtractive range or per-range inversion), they are evaluated on the CPU even when the stack runs on the GPU, and a feathered edge is an 8-bit strength map whose banding has not been inspected on reference display hardware. The clone source offset is a fixed -10% of the frame unless re-sampled with Alt-click.',
  },
  {
    id: 'photo.export',
    area: 'studios',
    label: 'Photo export to real files',
    description:
      'Exports render the saved document at its full stored size through the same renderer as the preview, ask the browser’s own encoder for PNG, JPEG or WebP, and report the engine, dimensions and byte count that were actually produced.',
    status: 'implemented',
    verification: [
      'src/core/photo/export.test.ts',
      'src/components/photo/photo-workspace.test.tsx',
      'e2e/photo.spec.ts (a downloaded PNG is re-imported and its pixels are asserted)',
    ],
    gap: 'The browser decides the encoder, so a PNG colour profile is whatever the browser writes; gamma and ICC embedding are not implemented.',
  },
  {
    id: 'studios.motion',
    area: 'studios',
    label: 'Motion Studio',
    description:
      'A real motion-graphics editor on the shared document model: text, rectangle and ellipse layers, per-property keyframes for position, scale and opacity, linear/eased/held/custom-cubic interpolation, a timeline with a draggable playhead and draggable keyframes, playback with frame stepping, a value-graph editor, undo/redo, autosave, and a genuine PNG frame sequence with a JSON manifest in a zip.',
    status: 'partial',
    verification: [
      'src/core/motion/evaluate.test.ts',
      'src/core/motion/easing.test.ts',
      'src/core/motion/commands.test.ts',
      'src/core/motion/export.test.ts',
      'src/components/motion/motion-workspace.test.tsx',
      'e2e/motion.spec.ts',
    ],
    gap: 'Export is a PNG sequence, not a video file: no codec is claimed. Imported illustration artboards, path layers, masks, transitions, text-on-path animation and expressions are not implemented and stay listed as planned on the studio page. Motion is verified in Chromium only.',
  },
  {
    id: 'motion.evaluator',
    area: 'studios',
    label: 'Deterministic motion evaluator',
    description:
      'A pure, framework-free evaluator that answers what the document looks like at time t and is shared by the preview and the frame export, so the same timestamp produces the same geometry and the same pixels.',
    status: 'implemented',
    verification: [
      'src/core/motion/evaluate.test.ts (known geometry, boundaries, hold, centre-scaling, repeated evaluation)',
      'e2e/motion.spec.ts (an exported PNG frame at t = 1 s matches the preview canvas at t = 1 s pixel for pixel)',
    ],
  },
  {
    id: 'motion.keyframes',
    area: 'studios',
    label: 'Keyframes, interpolation and graph editing',
    description:
      'Per-property keyframes with linear, ease-in, ease-out, ease-in-out, hold and custom cubic easing; a timeline that shows and drags them; a graph editor that drags the two Bézier control points; every edit is one labelled undoable command.',
    status: 'implemented',
    verification: [
      'src/core/motion/easing.test.ts',
      'src/core/motion/commands.test.ts',
      'src/components/motion/motion-workspace.test.tsx',
      'e2e/motion.spec.ts',
    ],
  },
  {
    id: 'motion.export',
    area: 'studios',
    label: 'Frame-sequence export',
    description:
      'Renders the planned frames through the same render plan and painter as the preview, encodes PNG with the browser, and zips the frames with a manifest that records the times, size and frame rate. Cancellation and every refusal are states the panel shows.',
    status: 'implemented',
    verification: [
      'src/core/motion/export.test.ts',
      'src/lib/browser/motion-engine.ts',
      'e2e/motion.spec.ts (a downloaded zip is parsed: exact entry list, manifest times, decoded frame compared with the preview)',
    ],
    gap: 'The archive is a frame sequence, not a video file. There is no audio track and no codec.',
  },
  {
    id: 'studios.video',
    area: 'studios',
    label: 'Video Studio',
    description:
      'A real timeline editor on the shared document model: import local video and audio, place, move, trim and split clips, overwrite overlapping ranges, add titles with position and colour, set per-clip gain and mute, scrub and play with the browser’s own decoders, undo anything, and export a deterministic PNG frame sequence or record a real-time WebM take.',
    status: 'partial',
    verification: [
      'src/core/video/commands.test.ts',
      'src/core/video/evaluate.test.ts',
      'src/core/video/export.test.ts',
      'src/core/video/timeline.test.ts',
      'src/components/video/video-workspace.test.tsx',
      'e2e/video.spec.ts',
    ],
    gap: 'No proxy generation and no ripple/roll editing; transitions, fades and ducking are not implemented. It decodes only what the browser decodes, and it records WebM in real time rather than encoding MP4. Media bytes live in this browser’s IndexedDB, so a project moved to another machine asks for the files again.',
  },
  {
    id: 'video.timeline',
    area: 'studios',
    label: 'Timeline editing',
    description:
      'Tracks of clips with millisecond-rounded times; placing a clip overwrites the range it covers by trimming, splitting or removing neighbours, so each track holds at most one clip at any moment. Trims cannot invent footage beyond the source file, and every edit is one labelled undoable command.',
    status: 'implemented',
    verification: [
      'src/core/video/commands.test.ts (overwrite, trim clamping, split, limits, refusals)',
      'src/core/video/timeline.test.ts',
      'src/components/video/video-workspace.test.tsx',
    ],
  },
  {
    id: 'video.playback',
    area: 'studios',
    label: 'Decoded playback and scrubbing',
    description:
      'One media element per imported file, played by the browser’s decoder and composited onto a canvas; seeking is exact when paused and drift-corrected while playing. Two exports share that evaluation: a frame sequence rendered by seeking every clip, and a real-time capture.',
    status: 'implemented',
    verification: [
      'src/core/video/evaluate.test.ts',
      'src/lib/browser/video-engine.ts',
      'e2e/video.spec.ts (a real WebM fixture is imported, scrubbed, exported and captured in Chromium)',
    ],
    gap: 'There is no proxy pipeline and no GPU compositor: a large file seeks as fast as this browser can decode it.',
  },
  {
    id: 'video.export',
    area: 'studios',
    label: 'Video export',
    description:
      'A PNG frame sequence with a manifest of exact times, and a WebM take recorded through MediaRecorder with the timeline’s audio mixed in. The panel reports the container the browser actually negotiated.',
    status: 'implemented',
    verification: [
      'src/core/video/export.test.ts',
      'e2e/video.spec.ts (downloaded frames match the preview canvas; a recorded take is a real WebM file)',
    ],
    gap: 'No MP4 encoding, no offline render: a capture runs in real time and can drop frames on a slow machine.',
  },
  {
    id: 'studios.three-d',
    area: 'studios',
    label: '3D Studio',
    description: 'Modelling, materials and lighting.',
    status: 'exploratory',
    verification: [],
    gap: 'No technology committed. Listed so the engine boundaries stay honest.',
  },
  {
    id: 'platform.tooling',
    area: 'platform',
    label: 'Strict TypeScript, ESLint, Prettier, Vitest and CI',
    description:
      'Strict type checking, type-aware linting, formatting checks, unit and component tests, production build, and a GitHub Actions workflow running all of them.',
    status: 'implemented',
    verification: [
      'npm run verify',
      'https://github.com/EulerZERO-CODM/eulerforge/actions (CI workflow .github/workflows/ci.yml)',
    ],
  },
  {
    id: 'platform.storage-durability',
    area: 'platform',
    label: 'Honest storage durability reporting',
    description:
      'The browser storage backend reports whether writes are persistent or session-only, the interface states which one is in use, and a save is only ever claimed when the write reaches the device. Server rendering is reported as undetermined rather than assumed.',
    status: 'implemented',
    verification: [
      'src/core/persistence/storage.test.ts',
      'src/core/persistence/storage.server-render.test.ts',
      'src/state/storage-status.test.ts',
      'src/components/workspace/save-state.test.tsx',
      'src/components/shell/storage-notice.test.tsx',
      'e2e/storage-restricted.spec.ts (a browser that refuses storage: the app starts, reports memory-only, keeps editing and loses the project on reload without ever claiming a save)',
    ],
  },
  {
    id: 'platform.env-validation',
    area: 'platform',
    label: 'Environment validation',
    description:
      'Public environment variables are parsed and validated at startup; invalid values fail fast with a readable message instead of falling back silently.',
    status: 'implemented',
    verification: ['src/config/env.test.ts'],
  },
  {
    id: 'platform.auth-billing',
    area: 'platform',
    label: 'Accounts, sessions and share links',
    description:
      'Registration and sign-in with scrypt-hashed passwords and opaque session tokens in HttpOnly cookies, profile rename, password change that revokes other sessions, account deletion that cascades to documents and share links, and revocable read-only share links. There is no billing, by explicit product decision.',
    status: 'partial',
    verification: [
      'src/server/passwords.ts',
      'src/server/sessions.ts',
      'src/server/routes.test.ts',
      'src/components/account/account-panel.test.tsx',
    ],
    gap: 'No email verification, password reset, OAuth, multi-factor authentication or team roles; rate limiting is in-process, so it does not survive a restart or span instances. Billing is not implemented and is not planned.',
  },
] as const;

export function capabilitiesByArea(): Readonly<
  Record<PlatformArea, readonly PlatformCapability[]>
> {
  const grouped = {
    core: [],
    shell: [],
    learning: [],
    assets: [],
    studios: [],
    platform: [],
  } as Record<PlatformArea, PlatformCapability[]>;
  for (const capability of PLATFORM_CAPABILITIES) grouped[capability.area].push(capability);
  return grouped;
}

export function capabilityCounts(): Readonly<Record<PlatformStatus, number>> {
  const counts: Record<PlatformStatus, number> = {
    implemented: 0,
    partial: 0,
    planned: 0,
    exploratory: 0,
  };
  for (const capability of PLATFORM_CAPABILITIES) counts[capability.status] += 1;
  return counts;
}
