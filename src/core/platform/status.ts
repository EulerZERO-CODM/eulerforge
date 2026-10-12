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
      'The document definition can be downloaded and read back. This is the only implemented export format.',
    status: 'implemented',
    verification: ['src/core/export/project-file.test.ts'],
  },
  {
    id: 'core.rendering',
    area: 'core',
    label: 'Rasterisation / rendering pipeline',
    description: 'Turning a document into pixels.',
    status: 'planned',
    verification: [],
    gap: 'No renderer exists. PNG, JPEG, PDF and SVG export are therefore blocked in the interface, not silently broken.',
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
      'Projects are created, listed, edited and deleted in this browser via a storage repository interface. Device-local only.',
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
    description: 'Applying an asset to a canvas, and asset files with real content.',
    status: 'planned',
    verification: [],
    gap: 'Records currently carry descriptions and metadata only. Placement depends on the design tools in Phase 2.',
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
      'Document setup, guides, units, palette, metadata, history/undo, export readiness and project file download. No drawing tools.',
    status: 'partial',
    verification: [
      'src/components/workspace/document-aside.test.tsx',
      'Manual check: change canvas size, undo, redo, export',
    ],
    gap: 'Selection, text, shape and image tools are not implemented; the workspace says so and links to the roadmap.',
  },
  {
    id: 'studios.photo-video-motion-illustration',
    area: 'studios',
    label: 'Photo, Video, Motion and Illustration studios',
    description: 'The remaining specialist editors.',
    status: 'planned',
    verification: [],
    gap: 'Entry points exist and explain what each studio will do; none of them edits media, and no interface in them claims to.',
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
