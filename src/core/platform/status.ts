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
      'The document definition can be downloaded and read back. PNG/JPEG raster and SVG are the other implemented exports; the format registry labels PDF, WebP and video as planned.',
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
      'A deterministic serializer writes paths, shapes, fills, strokes, opacity and transforms with a computed `viewBox`, drops redundant markup and omits defaults. The importer rejects scripts, event handlers, `foreignObject`, external references and doctypes, reports malformed input with a message, and re-imports its own output within a documented tolerance (1e-3 in user units).',
    status: 'implemented',
    verification: [
      'src/core/svg/svg.test.ts',
      'src/core/svg/from-scene.test.ts',
      'src/core/svg/icon-set.test.ts',
      'src/core/export/checklist.test.ts',
    ],
    gap: 'Import supports the artwork subset the serializer writes plus common shorthand: text, filters, masks, clip paths, gradients and CSS style sheets are reported as unsupported rather than approximated.',
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
    gap: 'SVG, PDF, WebP and video output are still planned; the format registry keeps them labelled as such.',
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
    label: 'Cloud persistence and sync',
    description: 'Projects available across devices, with accounts and conflict handling.',
    status: 'planned',
    verification: [],
    gap: 'Requires authentication, a database and a sync protocol — none of which exist. The repository interface is designed so this is additive.',
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
    label: 'Remote asset catalogue',
    description: 'A hosted, searchable catalogue with real licensed assets.',
    status: 'planned',
    verification: [],
    gap: 'No backend, no licensing agreements and no CDN integration. The `AssetCatalog` interface is the integration point.',
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
      'A real vector workspace on the shared kernel: draw with the pen, place rectangles/ellipses/polygons, drag out shapes, edit nodes and Bezier handles, marquee-select, nudge and transform, set real fill/stroke/opacity/cap/join/dash, run boolean operations, convert shapes to editable paths, import and export SVG, export an icon set from the selection (unselected, hidden and non-path layers are never packaged; anything it cannot carry is named), and hand artwork to the Design Studio and back. Every edit is one labelled undoable action, and the studio links its limitations (no gradients, no tracing, no rotation-preserving interchange) instead of hiding them.',
    status: 'partial',
    verification: [
      'src/components/illustration/illustration-workspace.test.tsx',
      'src/core/editor/vector-commands.test.ts',
      'src/core/documents/interchange.test.ts',
      'src/components/create/creation-flow.test.tsx',
    ],
    gap: 'Gradient and pattern fills, tracing a raster image, text on a path, and ungrouped multi-artboard documents are not implemented and are labelled planned in the registry. Node editing works on one path at a time. The browser suite runs on Chromium only, so Firefox and WebKit are unverified.',
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
    id: 'photo.masks',
    area: 'studios',
    label: 'Masking and retouching',
    description:
      'Brush, lasso and erase mask strokes with per-stroke radius and hardness, inversion and clearing, plus a clone stamp with a sampled source offset and a heal brush that blends towards a blurred local copy. Strokes are normalised and serialisable, so the mask survives save and reload.',
    status: 'partial',
    verification: [
      'src/core/photo/commands.test.ts',
      'src/components/photo/photo-workspace.test.tsx',
      'e2e/photo.spec.ts (a masked stack only changes the painted area, inversion covers the rest, heal leaves the edges untouched)',
    ],
    gap: 'Range selections (select by luminance, colour or subject) are not implemented; the mask is painted. Mask strokes are single-channel strength only, so there is no feather-by-region or subject refinement. The clone source offset is a fixed -10% of the frame unless re-sampled with Alt-click.',
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
    id: 'studios.motion-video',
    area: 'studios',
    label: 'Motion and Video studios',
    description: 'The remaining specialist editors.',
    status: 'planned',
    verification: [],
    gap: 'Entry points exist and explain what each studio will do; neither edits timeline media yet, and no interface in them claims to.',
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
    label: 'Accounts, billing and collaboration',
    description: 'Sign-in, plans, sharing and team features.',
    status: 'planned',
    verification: [],
    gap: 'Deliberately absent. Settings shows these as unavailable rather than showing fake controls.',
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
