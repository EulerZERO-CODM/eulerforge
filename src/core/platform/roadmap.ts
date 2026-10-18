/**
 * Phased roadmap as typed data.
 *
 * docs/ROADMAP.md is the prose version of this file; the in-app `/roadmap` page renders it. Keeping
 * it typed means statuses cannot silently drift and completion criteria are always shown next to the
 * thing they measure (ADR-0012).
 */

export type RoadmapPhaseStatus = 'complete' | 'in-progress' | 'planned' | 'exploratory';
/**
 * `partial` exists so a genuinely half-finished item does not have to choose between overclaiming
 * (`done`) and underclaiming (`planned`). Its `gap` says what is missing.
 */
export type RoadmapItemStatus = 'done' | 'partial' | 'in-progress' | 'planned' | 'exploratory';

export const ROADMAP_STATUS_LABELS: Readonly<Record<RoadmapItemStatus, string>> = {
  done: 'Done',
  partial: 'Partially done',
  'in-progress': 'In progress',
  planned: 'Planned',
  exploratory: 'Exploratory',
};

export type RoadmapItem = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: RoadmapItemStatus;
  /** Ids of items that must land first. */
  readonly dependsOn: readonly string[];
  /** How we will know it is finished — measurable, not aspirational. */
  readonly completionCriteria: readonly string[];
  /**
   * What actually demonstrates the claim: test files, or an explicit manual step.
   * Required for `done`; the test suite checks that every named file exists.
   */
  readonly evidence?: readonly string[];
  /** What is still missing, for `partial` and `in-progress` items. */
  readonly gap?: string;
  /** Links into the capability ledger in ./status.ts. */
  readonly capabilityIds: readonly string[];
};

export type RoadmapPhase = {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly status: RoadmapPhaseStatus;
  readonly items: readonly RoadmapItem[];
  readonly exitCriteria: readonly string[];
};

export const ROADMAP: readonly RoadmapPhase[] = [
  {
    id: 'phase-1',
    name: 'Phase 1 — Foundation and platform shell',
    summary:
      'Engineering foundation, Forge Core domain model, studio registry, learning layer, asset ecosystem boundaries and a usable browser shell.',
    status: 'complete',
    items: [
      {
        id: 'p1.core',
        title: 'Forge Core document model',
        description:
          'Immutable documents, Zod validation, unit conversion, geometry, schema versioning and migrations.',
        status: 'done',
        dependsOn: [],
        completionCriteria: [
          'Invalid documents cannot be constructed through the factory',
          'A v0 document migrates to the current schema and validates',
        ],
        evidence: [
          'src/core/documents/schema.test.ts',
          'src/core/documents/factories.test.ts',
          'src/core/documents/migrations.test.ts',
          'src/core/documents/units.test.ts',
          'src/core/documents/geometry.test.ts',
        ],
        capabilityIds: ['core.document-model', 'core.migrations', 'core.unit-conversion'],
      },
      {
        id: 'p1.history',
        title: 'History and undo/redo integration point',
        description:
          'A framework-free history stack that the workspace drives for every document change.',
        status: 'done',
        dependsOn: ['p1.core'],
        completionCriteria: [
          'Undo and redo restore exact prior states',
          'Depth is bounded and label metadata survives',
        ],
        evidence: ['src/core/history/history.test.ts'],
        capabilityIds: ['core.history'],
      },
      {
        id: 'p1.studios',
        title: 'Studio registry and discovery',
        description:
          'Six studios declared as data with honest availability, engine boundaries and capability statuses.',
        status: 'done',
        dependsOn: [],
        completionCriteria: [
          'Registering an invalid studio produces a reported issue',
          'CI fails if a studio claims availability without an entry route',
        ],
        evidence: ['src/core/studios/registry.test.ts', 'src/core/studios/definitions.test.ts'],
        capabilityIds: ['studios.registry'],
      },
      {
        id: 'p1.shell',
        title: 'Application shell and starter flows',
        description:
          'Navigation, home dashboard, creation flow, project library, studio discovery, assets, learning hub, settings, command palette.',
        status: 'done',
        dependsOn: ['p1.core', 'p1.studios'],
        completionCriteria: [
          'Every primary navigation target renders a real screen',
          'Creating a project from a preset produces a persisted, validated document',
          'A save is never claimed when storage is a session-only fallback',
        ],
        evidence: [
          'src/components/shell/app-shell.test.tsx',
          'src/components/shell/command-palette.test.tsx',
          'src/components/shell/storage-notice.test.tsx',
          'e2e/storage-restricted.spec.ts (a browser that refuses storage before the app starts: memory-only notice, no durable claim, editing still works, and a reload loses the project and says so)',
        ],
        capabilityIds: [
          'shell.navigation',
          'shell.command-palette',
          'shell.project-library',
          'platform.storage-durability',
          'studios.design',
        ],
      },
      {
        id: 'p1.learning',
        title: 'Learning layer',
        description:
          'Typed lessons, concepts, tool explanations and guided exercises with local progress.',
        status: 'done',
        dependsOn: [],
        completionCriteria: [
          'Content integrity checks pass',
          'Lesson exercise steps map to real, reachable routes',
        ],
        evidence: ['src/core/learning/query.test.ts'],
        capabilityIds: ['learn.hub', 'learn.progress'],
      },
      {
        id: 'p1.assets',
        title: 'Asset catalogue boundary',
        description:
          'Paginated query model, licence and provenance metadata, sample adapter and explicit notices.',
        status: 'done',
        dependsOn: [],
        completionCriteria: [
          'Query results paginate and facet correctly',
          'Sample content is labelled as sample everywhere it appears',
        ],
        evidence: ['src/core/assets/catalog.test.ts', 'src/core/assets/query.test.ts'],
        capabilityIds: ['assets.catalogue'],
      },
      {
        id: 'p1.platform',
        title: 'Quality gates',
        description:
          'Strict TypeScript, type-aware linting, formatting, unit and component tests, production build, CI workflow.',
        status: 'done',
        dependsOn: [],
        completionCriteria: [
          'npm run verify passes locally and in CI',
          'No test is skipped to make the pipeline green',
        ],
        evidence: [
          'Command evidence rather than a test file: npm run verify (tsc, eslint, prettier, vitest, build) locally, and the Verify job on Node 22 and Node 24 for every push',
        ],
        capabilityIds: ['platform.tooling', 'platform.env-validation'],
      },
    ],
    exitCriteria: [
      'A new user can create, configure, persist and export a project without hitting a dead end',
      'No interface claims a capability that is not implemented',
      'Every studio in the registry resolves to a real screen, implemented or explicitly pending',
    ],
  },
  {
    id: 'phase-2',
    name: 'Phase 2 — Design Studio editing',
    summary:
      'Direct manipulation on the artboard: a layer model, text and shape tools, selection and transform, and raster export.',
    status: 'in-progress',
    items: [
      {
        id: 'p2.layers',
        title: 'Layer model and scene tree',
        description:
          'Documents carry an ordered scene of text, rectangle, ellipse and image layers, each with a stable id, geometry, appearance and settings. Selection and other transient interaction state never reach the document or the history labels.',
        status: 'done',
        dependsOn: ['p1.core', 'p1.history'],
        completionCriteria: [
          'Layer operations are commands with labels and undo',
          'A document with layers still validates against the schema and migrates forward',
        ],
        evidence: [
          'src/core/documents/layer-operations.test.ts (add, update, duplicate, delete, reorder, stable z-order)',
          'src/core/documents/migrations.test.ts (v0 to v1 to v2, v1 to v2 gains an empty scene)',
          'src/core/documents/layer-persistence.test.ts (layers survive JSON, .forge.json and reload)',
          'src/components/workspace/workspace-editor.test.tsx (selection is not persisted, list keyboard model)',
        ],
        capabilityIds: ['studios.design'],
      },
      {
        id: 'p2.text',
        title: 'Text tool with typography controls',
        description:
          'Font family stack, size, weight, line height, tracking, alignment and colour, edited from the selection inspector and laid out by the shared renderer.',
        status: 'done',
        dependsOn: ['p2.layers'],
        completionCriteria: [
          'Text renders at correct position and wraps inside its box',
          'Typography settings round-trip through the project file',
        ],
        evidence: [
          'src/core/render/text-layout.test.ts (wrapping, alignment, truncation reporting)',
          'src/core/render/paint.test.ts (an overflowing text layer is clipped to its box, which is what the export report tells the user)',
          'src/core/export/raster.test.ts (text painted at its frame position in real pixels)',
          'src/core/documents/layer-persistence.test.ts (newlines and alignment survive the project file)',
          'src/core/documents/validation.test.ts (typography ranges rejected with field messages)',
          'e2e/text-wrapping.spec.ts (real browser font metrics, no stubbed measure: the same wrapped lines with the same ink bands at 25%, 100% and 200% zoom, read back from the artboard canvas, and nothing painted below the box)',
        ],
        capabilityIds: [],
      },
      {
        id: 'p2.transform',
        title: 'Selection, move, resize and snapping',
        description:
          'Direct manipulation with snapping to guides, grid lines and sibling edges. A gesture previews live and commits once, in document coordinates, independent of zoom.',
        status: 'done',
        dependsOn: ['p2.layers'],
        completionCriteria: [
          'Snapping is deterministic and can be disabled',
          'Every transform is one undoable step',
        ],
        evidence: [
          'src/core/editor/gesture.test.ts (move, group resize, locked layers, snapping on and off, cancellation)',
          'src/core/documents/scene-geometry.test.ts (hit-testing, resize anchors, snap targets, group transforms)',
          'src/components/workspace/workspace-editor.test.tsx (one history entry per gesture, group resize and undo, locked layers, keyboard paths)',
          'src/components/workspace/document-stage.test.tsx (keyboard equivalents for every pointer action)',
          'e2e/workspace.spec.ts (real pointer capture: select and modifier-select, group move, single and group resize with undo, Escape cancellation, locked layers, bulk duplicate and reorder, keyboard-only editing)',
          'e2e/snapping.spec.ts (a drag whose pointer stops three screen pixels short of the canvas centre, at 25%, 100% and 200% zoom: the persisted frame lands on the target, the drawn guide sits on the screen pixel the document implies - measured from the artboard box, not the viewport - and the guide is found in a screenshot of the artboard in rows the layer does not occupy)',
        ],
        capabilityIds: ['studios.design'],
      },
      {
        id: 'p2.raster-export',
        title: 'Raster export pipeline',
        description:
          'PNG and JPEG export through the same render plan and painter as the live artboard, at the document size times a chosen scale, with JPEG quality and an explicit background for alpha.',
        status: 'done',
        dependsOn: ['p2.layers'],
        completionCriteria: [
          'Exported pixels match the on-screen composition within tolerance',
          'Export is blocked with an explanation when unsupported elements exist',
        ],
        evidence: [
          'src/core/export/raster.test.ts (dimensions per scale, stacking order, transparency, JPEG background, failures)',
          'src/core/render/plan.test.ts (blocking versus advisory render issues)',
          'src/components/workspace/document-aside.test.tsx (the panel refuses formats it cannot write)',
          'e2e/export.spec.ts (a real browser exports a real PNG and JPEG and the downloaded bytes are checked: PNG signature and IHDR size, JPEG signature and frame size, at 1x and 2x; editing guides reach neither the bytes nor the pixels where a guide was drawn)',
        ],
        capabilityIds: ['core.rendering'],
      },
      {
        id: 'p2.asset-placement',
        title: 'Asset placement',
        description:
          'Repository-authored graphics and sample palettes are applied to a document with attribution preserved. Placement works from the catalogue and from the editor, by click as well as drag; metadata-only records stay clearly labelled as reference-only.',
        status: 'done',
        dependsOn: ['p2.layers', 'p1.assets'],
        completionCriteria: [
          'Placed assets record their licence in the document',
          'Unverified-provenance assets warn before use',
        ],
        evidence: [
          'src/core/editor/commands.test.ts (place, palette with attribution, unverified warning)',
          'src/components/workspace/graphic-picker.test.tsx (click-to-place, reference-only records, warnings)',
          'src/components/workspace/workspace-editor.test.tsx (placed graphic renders, saves and reloads)',
          'src/core/export/raster.test.ts (a placed graphic reaches exported pixels)',
          'e2e/attribution.spec.ts (placed through the picker, then compared field by field with the catalogue and with the record in the saved document, again after leaving and reopening the project, and again with a rewritten saved record so the panel has to follow the document rather than the catalogue)',
        ],
        capabilityIds: ['assets.usable-files'],
      },
      {
        id: 'p2.undo-coverage',
        title: 'Undo/redo coverage for every editing action',
        description:
          'Every control and command that changes the document is exactly one labelled, reversible step, with selection and the other transient view state kept out of history entirely.',
        status: 'done',
        dependsOn: ['p2.layers'],
        completionCriteria: [
          'Each document-changing action produces one non-empty history label',
          'Undo restores the previous document and redo the post-edit one, including attribution records and layer ordering',
        ],
        evidence: [
          'src/core/editor/undo-redo.test.ts (45 commands: the patch keys, the label, undo and redo compared as content, plus the refused, unchanged and continuous cases)',
          'src/components/workspace/undo-redo.test.tsx (76 controls through one shared runner: the document, the label, the panel, the store and the saved bytes, plus the blocks for actions that must not create a step)',
          'e2e/undo-redo.spec.ts (the real shortcuts through the browser key pipeline, storage compared after every step, a placed graphic and its licence record, refused/unchanged/cancelled edits, and a reload that keeps the document and starts a fresh session)',
          'docs/undo-redo-matrix.md (the action-to-test matrix, the provenance of the enumeration, and the known gaps)',
        ],
        capabilityIds: ['core.history', 'studios.design'],
      },
      {
        id: 'p2.responsiveness',
        title: 'Thirty-layer responsiveness',
        description:
          'Interaction cost is measured in a real browser on a thirty-layer document, against a budget fixed before the first measurement.',
        status: 'partial',
        dependsOn: ['p2.layers'],
        completionCriteria: [
          'A thirty-layer document with real catalogue graphics can be built deterministically for tests',
          'Selecting, dragging, resizing, inspector edits, visibility, locking and undo/redo are measured in a real browser and gated on a published budget',
        ],
        evidence: [
          "src/testing/thirty-layers.test.ts (the fixture: thirty layers of four types built through the editor's own commands, deterministic ids and timestamps, rendered with real font metrics and the repository's own asset files, zero issues)",
          'e2e/performance.spec.ts (twelve scenarios, twelve interaction samples and five drags each after a warm-up, in a controlled CPU-slowdown phase and again at full speed, with the report published to the pull request)',
          'docs/PERFORMANCE.md (method, thresholds, measured results, environment, and what the controlled slowdown can and cannot stand for)',
        ],
        gap: 'Responsiveness is measured on CI hardware under a four-fold CPU throttle rather than on a mid-range laptop, so the numbers are a regression gate for this repository and not evidence about a particular machine; the benchmark is Chromium only.',
        capabilityIds: ['studios.design'],
      },
    ],
    exitCriteria: [
      'A user can produce a real social post or thumbnail inside the app and export it',
      'Editing a 30-layer document stays responsive on a mid-range laptop',
      'Undo/redo covers every editing action with meaningful labels',
    ],
  },
  {
    id: 'phase-3',
    name: 'Phase 3 — Vector engine and Illustration Studio',
    summary: 'A shared path model, bezier editing, boolean operations and SVG export.',
    status: 'in-progress',
    items: [
      {
        id: 'p3.path-model',
        title: 'Path and geometry kernel',
        description:
          'Framework-free path representation, hit-testing, transforms and boolean operations.',
        status: 'done',
        dependsOn: ['p1.core'],
        completionCriteria: [
          'Boolean results are topologically valid',
          'Kernel has no DOM dependency and is fully unit tested',
        ],
        evidence: [
          'src/core/vector/path.test.ts',
          'src/core/vector/geometry.test.ts',
          'src/core/vector/validity.test.ts',
          'src/core/vector/boolean.test.ts',
          'src/core/vector/ops.test.ts',
          'src/core/editor/vector-commands.test.ts',
        ],
        capabilityIds: ['core.vector-model', 'core.vector-booleans'],
      },
      {
        id: 'p3.svg-view',
        title: 'SVG view layer and export',
        description: 'Render the path model to SVG and export production-quality files.',
        status: 'done',
        dependsOn: ['p3.path-model'],
        completionCriteria: [
          'Round trip: draw → export SVG → re-import matches geometry within tolerance',
        ],
        evidence: [
          'src/core/svg/svg.test.ts',
          'src/core/svg/from-scene.test.ts',
          'src/core/svg/icon-set.test.ts',
          'e2e/illustration.spec.ts (exports a real SVG, reads its bytes and re-imports them)',
        ],
        capabilityIds: ['core.svg-io'],
      },
      {
        id: 'p3.illustration',
        title: 'Illustration Studio workspace',
        description: 'Pen, node editing, shape building and stroke controls on the shared kernel.',
        status: 'partial',
        dependsOn: ['p3.svg-view'],
        completionCriteria: [
          'A user can draw and export an icon set',
          'Studio flips to `available` in the registry with a working entry point',
        ],
        capabilityIds: ['studios.illustration'],
        gap: 'Gradient/pattern fills, tracing a raster image and text on a path are not implemented and stay labelled planned. Interchange refuses rotated layers rather than baking the rotation, so it is lossless within a smaller subset than the editor itself. Icon sets contain path layers only: a selected rectangle, ellipse, text or graphic layer is named as skipped rather than converted.',
      },
    ],
    exitCriteria: [
      'Vector documents and design documents can share artwork both ways',
      'SVG output is smaller and cleaner than a naive export',
    ],
  },
  {
    id: 'phase-4',
    name: 'Phase 4 — Raster engine and Photo Studio',
    summary:
      'GPU raster processing with a reference CPU renderer, a non-destructive adjustment stack, painted masks and retouching, and the Photo Studio workspace. Shipped; range selections, tiling and the unmeasured 12 MP target keep the phase open.',
    status: 'in-progress',
    items: [
      {
        id: 'p4.raster-engine',
        title: 'GPU raster engine',
        description:
          'WebGL2 pipeline for image decoding and shader-based adjustments with a Canvas2D fallback.',
        status: 'partial',
        dependsOn: ['p1.core', 'p1.history'],
        completionCriteria: [
          'Adjustments evaluate in under 16 ms at 12 MP on reference hardware',
          'Fallback path produces equivalent output within tolerance',
        ],
        evidence: [
          'src/lib/browser/photo-engine.ts',
          'e2e/photo.spec.ts',
          'src/core/photo/pipeline.perf.test.ts',
        ],
        gap: 'Both renderers exist and agree within 2/255 per channel, but the 16 ms at 12 MP criterion is unmeasured: there is no reference GPU hardware in this environment (CI renders through SwiftShader), and the working copy is capped at 2048 px so 12 MP documents never reach the renderer. Tiling is not implemented.',
        capabilityIds: ['photo.raster-engine'],
      },
      {
        id: 'p4.adjustments',
        title: 'Non-destructive adjustment stack',
        description: 'Ordered adjustments with reordering, bypass and per-step masks.',
        status: 'done',
        dependsOn: ['p4.raster-engine'],
        completionCriteria: [
          'Reordering changes the result predictably',
          'Stack serialises into the document model',
        ],
        evidence: [
          'src/core/photo/pipeline.test.ts',
          'src/core/photo/commands.test.ts',
          'src/core/documents/payload.test.ts',
          'src/components/photo/photo-workspace.test.tsx',
          'e2e/photo.spec.ts',
        ],
        capabilityIds: ['photo.adjustments'],
      },
      {
        id: 'p4.selection-mask',
        title: 'Selections, masks and retouching',
        description: 'Brush, lasso and range selections; feathered masks; clone and heal tools.',
        status: 'partial',
        dependsOn: ['p4.adjustments'],
        completionCriteria: [
          'Selections survive document reload',
          'Mask edges show no visible banding at 100% zoom',
        ],
        evidence: [
          'src/core/photo/commands.test.ts',
          'src/components/photo/photo-workspace.test.tsx',
          'e2e/photo.spec.ts',
        ],
        gap: 'Brush, lasso and erase masks with a hardness feather survive reload, and clone/heal retouch works, but range selections (by luminance, colour or subject) are not implemented. Banding at 100% zoom was not inspected on real display hardware; the mask is an 8-bit strength map, so a feathered edge has at most 256 levels.',
        capabilityIds: ['photo.masks'],
      },
      {
        id: 'p4.photo-studio',
        title: 'Photo Studio workspace',
        description: 'Import, develop and export photographs with the raster engine.',
        status: 'done',
        dependsOn: ['p4.selection-mask'],
        completionCriteria: [
          'A RAW-free JPEG workflow is possible end to end',
          'Studio flips to `available` with a working entry point',
        ],
        evidence: [
          'src/components/photo/photo-workspace.test.tsx',
          'e2e/photo.spec.ts',
          'src/core/studios/definitions.test.ts (the entry point is `available` and routes to /studios/photo)',
        ],
        capabilityIds: ['studios.photo'],
      },
    ],
    exitCriteria: [
      'Large images open and remain interactive without exhausting browser memory',
      'Every adjustment is non-destructive and reloadable',
    ],
  },
  {
    id: 'phase-5',
    name: 'Phase 5 — Motion Studio',
    summary:
      'Deterministic scene evaluation, keyframes with easing and a graph editor, a timeline and transport, and a PNG frame-sequence export whose frames match the preview at the same timestamp.',
    status: 'complete',
    items: [
      {
        id: 'p5.evaluator',
        title: 'Deterministic scene evaluator',
        description: 'Pure evaluation of a scene graph at time t, shared by preview and export.',
        status: 'done',
        dependsOn: ['p3.path-model'],
        completionCriteria: [
          'The same time value produces byte-identical geometry in preview and export',
        ],
        evidence: [
          'src/core/motion/evaluate.ts',
          'src/core/motion/evaluate.test.ts',
          'e2e/motion.spec.ts',
        ],
        capabilityIds: ['motion.evaluator'],
      },
      {
        id: 'p5.keyframes',
        title: 'Keyframes, interpolation and graph editor',
        description: 'Per-property keyframes with easing profiles and a curve editor.',
        status: 'done',
        dependsOn: ['p5.evaluator'],
        completionCriteria: [
          'Interpolation types are unit tested against known values',
          'Keyframe edits are undoable commands',
        ],
        evidence: [
          'src/core/motion/easing.test.ts',
          'src/core/motion/commands.test.ts',
          'src/components/motion/keyframe-panel.tsx',
          'src/components/motion/easing-curve-editor.tsx',
          'src/components/motion/motion-workspace.test.tsx',
        ],
        capabilityIds: ['motion.keyframes'],
      },
      {
        id: 'p5.motion-studio',
        title: 'Motion Studio workspace',
        description: 'Timeline, property panel, playback controls and export.',
        status: 'done',
        dependsOn: ['p5.keyframes'],
        completionCriteria: [
          'A title animation can be produced and exported',
          'Studio flips to `available` with a working entry point',
        ],
        evidence: [
          'src/components/motion/motion-workspace.tsx',
          'src/components/motion/motion-workspace.test.tsx',
          'e2e/motion.spec.ts',
          'src/core/studios/definitions.test.ts (the entry point is `available` and routes to /studios/motion)',
          'src/components/create/creation-flow.test.tsx',
        ],
        capabilityIds: ['studios.motion', 'motion.export'],
      },
    ],
    exitCriteria: [
      'Preview and export agree frame for frame',
      'Studio is usable without reading documentation',
    ],
  },
  {
    id: 'phase-6',
    name: 'Phase 6 — Video Studio',
    summary:
      'Media import on the browser’s own decoders, multi-track editing with overwrite/trim/split commands, titles and per-clip levels, decoded playback and scrubbing, a deterministic frame-sequence export and a real-time WebM capture.',
    status: 'in-progress',
    items: [
      {
        id: 'p6.media-pipeline',
        title: 'Media import and decoding',
        description:
          'Import local video and audio files, read their real duration and picture size from the decoder, and keep the bytes in this browser’s IndexedDB with the metadata in the document.',
        status: 'done',
        dependsOn: ['p1.core', 'p4.raster-engine'],
        completionCriteria: [
          'A file the browser cannot decode is refused at import with the reason',
          'Media survives a reload and a missing file is reported, never painted as black',
        ],
        evidence: [
          'src/lib/browser/media-import.ts',
          'src/lib/browser/media-store.ts',
          'src/core/video/media-store.ts',
          'e2e/video.spec.ts',
        ],
        capabilityIds: ['studios.video', 'video.playback'],
      },
      {
        id: 'p6.timeline',
        title: 'Timeline model and editing operations',
        description: 'Tracks, clips, trimming, overwrite edits and undo integration.',
        status: 'done',
        dependsOn: ['p6.media-pipeline'],
        completionCriteria: [
          'Editing operations are commands with labels',
          'Timeline serialises into the document model',
        ],
        evidence: [
          'src/core/video/timeline.ts',
          'src/core/video/commands.ts',
          'src/core/video/commands.test.ts',
          'src/components/video/video-timeline.tsx',
          'src/components/video/video-workspace.test.tsx',
        ],
        capabilityIds: ['video.timeline'],
      },
      {
        id: 'p6.video-studio',
        title: 'Video Studio workspace and export',
        description:
          'Decoded playback and scrubbing, titles, per-clip levels, and two real exports: a PNG frame sequence with a manifest, and a real-time WebM capture.',
        status: 'done',
        dependsOn: ['p6.timeline'],
        completionCriteria: [
          'A short edit exports and plays back correctly',
          'Export failure states are explained, not silent',
        ],
        evidence: [
          'src/components/video/video-workspace.tsx',
          'src/components/video/video-workspace.test.tsx',
          'src/core/video/export.test.ts',
          'e2e/video.spec.ts',
        ],
        capabilityIds: ['video.export'],
      },
      {
        id: 'p6.proxies',
        title: 'Proxy generation for smooth scrubbing',
        description:
          'Generate a low-resolution proxy per imported file so scrubbing a large source stays responsive.',
        status: 'planned',
        dependsOn: ['p6.media-pipeline'],
        completionCriteria: [
          'Scrubbing a 4K source stays above 24 fps on the reference machine',
          'Proxies are stored and invalidated alongside the media they mirror',
        ],
        capabilityIds: [],
      },
      {
        id: 'p6.transitions',
        title: 'Transitions, fades and speed',
        description: 'Cross-dissolves, dips, fades and speed ramps between clips.',
        status: 'planned',
        dependsOn: ['p6.timeline'],
        completionCriteria: [
          'A dissolve renders identically in the preview, the sequence export and the capture',
        ],
        capabilityIds: [],
      },
    ],
    exitCriteria: [
      'A three-minute edit can be assembled and exported in-browser',
      'Audio and video stay in sync throughout',
    ],
  },
  {
    id: 'phase-7',
    name: 'Phase 7 — Persistence, accounts and collaboration',
    summary:
      'Optional cloud storage, sign-in, sharing and team features behind the existing repository boundary.',
    status: 'planned',
    items: [
      {
        id: 'p7.persistence',
        title: 'Remote document repository',
        description:
          'A server-backed implementation of the document repository with optimistic concurrency on `revision`.',
        status: 'planned',
        dependsOn: ['p1.core', 'p1.shell'],
        completionCriteria: [
          'Conflict detection is tested with two clients',
          'Local-only mode still works with no account',
        ],
        capabilityIds: ['shell.cloud-persistence'],
      },
      {
        id: 'p7.accounts',
        title: 'Authentication and account settings',
        description: 'Sign-in, profile and session handling.',
        status: 'planned',
        dependsOn: ['p7.persistence'],
        completionCriteria: [
          'No secret reaches the client bundle',
          'Account deletion removes server data',
        ],
        capabilityIds: ['platform.auth-billing'],
      },
      {
        id: 'p7.remote-catalogue',
        title: 'Remote asset catalogue',
        description:
          'Hosted, paginated catalogue with real licensed assets and provenance records.',
        status: 'planned',
        dependsOn: ['p7.persistence'],
        completionCriteria: [
          'Catalogue paging works against a server',
          'Every record exposes licence and provenance before use',
        ],
        capabilityIds: ['assets.remote-catalogue'],
      },
    ],
    exitCriteria: [
      'Browser-first usage remains fully functional without an account',
      'Data ownership and deletion are explicit in the interface',
    ],
  },
  {
    id: 'exploratory',
    name: 'Exploratory — not committed',
    summary:
      'Ideas worth investigating, recorded so they do not accidentally shape Phase 1 architecture.',
    status: 'exploratory',
    items: [
      {
        id: 'x.three-d',
        title: '3D Studio',
        description:
          'Modelling, PBR materials and lighting — embedded engine or purpose-built renderer, undecided.',
        status: 'exploratory',
        dependsOn: ['p5.evaluator'],
        completionCriteria: [
          'A technology decision is recorded as an ADR with measured evidence',
          'No 2D engine is forced to host 3D',
        ],
        capabilityIds: ['studios.three-d'],
      },
      {
        id: 'x.desktop',
        title: 'Desktop application shell',
        description:
          'Tauri-style packaging that reuses the web codebase for file-system and native performance access.',
        status: 'exploratory',
        dependsOn: ['p3.path-model', 'p4.raster-engine'],
        completionCriteria: [
          'The renderer and core are proven to be DOM-agnostic first',
          'Packaging does not fork the codebase',
        ],
        capabilityIds: [],
      },
      {
        id: 'x.plugins',
        title: 'Studio plugin API',
        description: 'Third-party studios registering through the studio registry boundary.',
        status: 'exploratory',
        dependsOn: ['p2.layers', 'p3.path-model'],
        completionCriteria: ['Sandboxing and capability limits are designed before any public API'],
        capabilityIds: [],
      },
      {
        id: 'x.tutor',
        title: 'Adaptive learning',
        description:
          'Responding to what a learner actually struggles with, using their own document as the example.',
        status: 'exploratory',
        dependsOn: ['p2.layers', 'p1.learning'],
        completionCriteria: [
          'Privacy review completed',
          'Quality evaluation exists; no confidently wrong explanations',
        ],
        capabilityIds: ['learn.adaptive-tutor'],
      },
    ],
    exitCriteria: [
      'Nothing in this phase constrains the committed phases',
      'Each item graduates only with a recorded decision and measured evidence',
    ],
  },
] as const;

export function roadmapCounts(): Readonly<Record<RoadmapItemStatus, number>> {
  // Every key is initialised: an unlisted status would otherwise silently produce NaN.
  const counts: Record<RoadmapItemStatus, number> = {
    done: 0,
    partial: 0,
    'in-progress': 0,
    planned: 0,
    exploratory: 0,
  };
  for (const phase of ROADMAP) for (const item of phase.items) counts[item.status] += 1;
  return counts;
}

export function findRoadmapItem(id: string): readonly [RoadmapPhase, RoadmapItem] | undefined {
  for (const phase of ROADMAP) {
    const item = phase.items.find((candidate) => candidate.id === id);
    if (item) return [phase, item];
  }
  return undefined;
}
