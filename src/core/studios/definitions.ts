/**
 * The studios Euler's Forge intends to ship, as data.
 *
 * Adding a studio means adding a definition here (or registering a new definition at boot) — no
 * shell, navigation or discovery code needs to change. Availability flags are deliberately
 * conservative: a studio is only `available` when a real, working entry point exists.
 */

import type { StudioDefinition } from './types';
import { createStudioId, createStudioSlug } from './registry';
import { brand } from '../types/brand';
import type { DocumentTypeId } from '../documents/types';

const documentType = (value: string): DocumentTypeId => brand<'DocumentTypeId'>(value);

export const DESIGN_STUDIO: StudioDefinition = {
  id: createStudioId('design'),
  slug: createStudioSlug('design'),
  name: 'Design Studio',
  tagline: 'Posters, thumbnails, banners, social posts and slides.',
  purpose:
    'Design Studio is the layout discipline: fixed-size artboards where type, shapes and imagery are arranged on a grid. It is the first studio with a working workspace in Euler’s Forge: canvas setup, units and guides, an editable layer scene, and PNG/JPEG export that runs through the same renderer as the artboard.',
  icon: 'layout',
  accent: 'cobalt',
  availability: 'available',
  maturityNote:
    'Document setup, units, guides, palette, a text/rectangle/ellipse/graphic layer stack, selection with move and resize, snapping, undo/redo, the local project library, .forge.json export and PNG/JPEG export are implemented. Not implemented: multiple artboards per document, per-run text styling, custom font uploads, templates and brand kits, and vector (SVG/PDF) export.',
  produces: [
    'Social posts and stories',
    'Video thumbnails and channel art',
    'Link preview images',
    'Presentation slides',
    'Print posters, flyers and business cards',
  ],
  documentTypes: [documentType('design.canvas')],
  capabilities: [
    {
      id: 'canvas.setup',
      label: 'Canvas setup with real-world presets',
      status: 'available',
      detail:
        'Start from 13 presets (social, web, video, presentation, print) or type exact pixel, millimetre and inch dimensions.',
    },
    {
      id: 'canvas.guides',
      label: 'Guides, safe areas and bleed preview',
      status: 'available',
      detail: 'Toggle margins, centre lines and grids, and see them drawn at the correct scale.',
    },
    {
      id: 'project.library',
      label: 'Local project library',
      status: 'available',
      detail: 'Projects are saved in this browser on this device only — no account required.',
    },
    {
      id: 'project.file',
      label: 'Project file export',
      status: 'available',
      detail: 'Download the document definition as a .forge.json file for backup and inspection.',
    },
    {
      id: 'document.property-inspector',
      label: 'Property inspector with undo/redo',
      status: 'available',
      detail: 'Changes to canvas, guides and metadata are command-based and can be undone.',
    },
    {
      id: 'tools.selection',
      label: 'Selection, move and transform tools',
      status: 'available',
      detail:
        'Select on the artboard or in the layer tree, then move and resize with visible handles, toggles for snapping and keyboard equivalents for every pointer action.',
    },
    {
      id: 'layers.text',
      label: 'Text, shape and graphic layers',
      status: 'available',
      detail:
        'An ordered layer stack with text (font stack, size, weight, line height, tracking, alignment, colour), rectangles, ellipses and placed catalogue graphics that render, save and reload.',
    },
    {
      id: 'layers.styles',
      label: 'Reusable text and object styles',
      status: 'planned',
      detail:
        'Named styles that several layers share, so a change propagates instead of being repeated.',
    },
    {
      id: 'assets.brand-kits',
      label: 'Templates and brand kits',
      status: 'planned',
      detail: 'Pull fonts, palettes and components from the asset catalogue into a document.',
    },
    {
      id: 'export.raster',
      label: 'Raster export (PNG and JPEG)',
      status: 'available',
      detail:
        'Export at the document’s pixel size times a chosen scale (0.5x to 4x), with PNG transparency preserved and an explicit flatten colour for JPEG.',
    },
    {
      id: 'export.vector',
      label: 'Vector export (SVG and PDF)',
      status: 'planned',
      detail:
        'Real SVG and PDF writers on top of a path model; the format list says so until then.',
    },
  ],
  engine: {
    renderer:
      'Canvas 2D artboard with DOM overlays for selection, handles and guides, plus an offscreen canvas for export (ADR-0016)',
    pipeline: 'Shared document model, unit conversion and geometry from Forge Core',
    integrationPoint: 'src/studios/design (presentation surface: src/components/workspace/design)',
    rationale:
      'Graphic design is mostly text, shape and layout work. DOM gives correct text shaping, font fallbacks, accessibility and selectable content for free, and CSS already implements the layout semantics a design canvas needs. Raster/vector rendering is added per-export, not as the editing surface.',
  },
  entry: { route: '/studios/design', label: 'Open Design Studio' },
  learningSlugs: [
    'canvas-and-units',
    'choose-the-right-size',
    'safe-areas-and-bleed',
    'export-readiness',
  ],
  consumesFrom: [],
  definitionVersion: 1,
};

export const PHOTO_STUDIO: StudioDefinition = {
  id: createStudioId('photo'),
  slug: createStudioSlug('photo'),
  name: 'Photo Studio',
  tagline: 'Adjust, retouch, mask and export photographs.',
  purpose:
    'Photo Studio edits a single photograph with a non-destructive stack: tonal and colour adjustments stay editable and reorderable, brush and lasso masks decide where the stack applies, and clone/heal strokes retouch the rendered pixels. The working copy is embedded in the project so it reopens without the original file. Multiple image layers and EXIF-aware orientation are still to come.',
  icon: 'aperture',
  accent: 'ember',
  availability: 'available',
  maturityNote:
    'Working in this browser: PNG/JPEG/WebP import with a capped working copy, a 12-entry adjustment stack with bypass and reordering, brush/lasso/erase masks with inversion, clone and heal retouch, undo/redo, autosave and real PNG/JPEG/WebP export. Not implemented: multiple image layers, blend modes, curves, EXIF orientation and colour-managed output.',
  produces: [
    'Corrected and colour-graded photographs',
    'Retouched portraits and product shots',
    'Masked local adjustments',
    'PNG, JPEG and WebP exports at the stored working size',
  ],
  documentTypes: [documentType('photo.image')],
  capabilities: [
    {
      id: 'adjust.stack',
      label: 'Non-destructive adjustment stack',
      status: 'available',
      detail:
        'Twelve tonal and colour adjustments applied in order, each bypassable, movable and undoable; the imported pixels are never overwritten.',
    },
    {
      id: 'select.mask',
      label: 'Selections and masks',
      status: 'available',
      detail:
        'Brush, lasso and erase strokes with a hardness edge and mask inversion, drawn with the pointer or from the keyboard.',
    },
    {
      id: 'retouch.heal',
      label: 'Retouching tools',
      status: 'available',
      detail:
        'Clone stamp with a sampled source offset and a heal brush that blends towards a blurred local copy.',
    },
    {
      id: 'composite.layers',
      label: 'Layer compositing',
      status: 'planned',
      detail: 'Blend modes, groups, opacity and layer masks across multiple images.',
    },
    {
      id: 'metadata.exif',
      label: 'EXIF-aware import',
      status: 'planned',
      detail: 'Read capture metadata, apply orientation, and keep provenance with the asset.',
    },
  ],
  engine: {
    renderer: 'WebGL2 fragment-pass renderer with a Canvas 2D reference fallback',
    pipeline:
      'createImageBitmap decode → capped working copy → one pass per adjustment (GPU) or the shared CPU pipeline → mask mix → Canvas 2D retouch → the browser’s own PNG/JPEG/WebP encoder',
    integrationPoint:
      'src/core/photo (stack, commands, export plan) and src/lib/browser/photo-engine.ts',
    rationale:
      'Per-pixel editing is faster on the GPU, but the fallback is the reference implementation: the shader mirrors `applyPhotoPipeline` and both are exercised, so a device without WebGL2 still edits and exports the same document. The renderer stays behind the shared document/history interfaces, so photo work never depends on DOM-specific assumptions in core.',
  },
  entry: { route: '/studios/photo', label: 'Open Photo Studio' },
  learningSlugs: ['what-adjustments-actually-do'],
  consumesFrom: [DESIGN_STUDIO.id],
  definitionVersion: 2,
};

export const VIDEO_STUDIO: StudioDefinition = {
  id: createStudioId('video'),
  slug: createStudioSlug('video'),
  name: 'Video Studio',
  tagline: 'Cut, arrange and export video with audio.',
  purpose:
    'Video Studio will be a timeline editor: importing clips, trimming, arranging tracks, adding titles, transitions and audio, then exporting. It depends on media decoding and encoding that the browser only exposes reliably through newer APIs, so its entry point comes after the raster foundation.',
  icon: 'film',
  accent: 'plum',
  availability: 'planned',
  maturityNote:
    'Not started. Timeline data model and playback technology are still being evaluated.',
  produces: [
    'Short-form social edits',
    'Promo and explainer cuts',
    'Interview and talking-head edits',
    'Simple multi-track mixes',
  ],
  documentTypes: [documentType('video.timeline')],
  capabilities: [
    {
      id: 'timeline.multitrack',
      label: 'Multi-track timeline',
      status: 'planned',
      detail: 'Video, audio, title and overlay tracks with trimming and ripple edits.',
    },
    {
      id: 'media.import',
      label: 'Media import and proxies',
      status: 'planned',
      detail: 'Import local files, generate lightweight proxies for smooth scrubbing.',
    },
    {
      id: 'transitions',
      label: 'Transitions and speed',
      status: 'planned',
      detail: 'Cross-dissolves, dips, speed ramps and hold frames.',
    },
    {
      id: 'audio.mix',
      label: 'Audio levels and fades',
      status: 'planned',
      detail: 'Per-clip gain, fades, ducking and a simple master bus.',
    },
    {
      id: 'export.video',
      label: 'Video export',
      status: 'planned',
      detail: 'MP4/WebM export via browser encoders where available, with a documented fallback.',
    },
  ],
  engine: {
    renderer: 'Timeline view (DOM) plus a decoded-frame preview surface',
    pipeline:
      'WebCodecs decode/encode where supported; demux/mux layer; frame-accurate scrub cache',
    integrationPoint: 'src/studios/video with src/engines/media for decode/encode',
    rationale:
      'Video cannot share the raster engine: it is a time-based model with different caching, memory and determinism requirements. It shares only Forge Core concepts (documents, assets, history, export interface).',
  },
  entry: { route: null, label: 'Video Studio' },
  learningSlugs: ['timeline-basics'],
  consumesFrom: [PHOTO_STUDIO.id, DESIGN_STUDIO.id],
  definitionVersion: 1,
};

export const MOTION_STUDIO: StudioDefinition = {
  id: createStudioId('motion'),
  slug: createStudioSlug('motion'),
  name: 'Motion Studio',
  tagline: 'Keyframes, animation and motion graphics.',
  purpose:
    'Motion Studio animates the same visual vocabulary as Design Studio: shapes and text placed on a timeline with per-property keyframes, easing curves and a graph editor. A pure evaluator drives both the preview and the frame export, so the same timestamp produces the same picture in both.',
  icon: 'keyframe',
  accent: 'teal',
  availability: 'available',
  maturityNote:
    'Working in this browser: text, rectangle and ellipse layers, keyframes for position, scale and opacity, linear/eased/held and custom cubic easing with a draggable graph, a timeline you can scrub and drag keyframes on, playback with frame stepping, undo/redo, autosave and a real PNG frame sequence with a JSON manifest in a zip. Not implemented: video-file export (a codec is a different promise), masks, transitions, imported artboards and expressions.',
  produces: [
    'Animated titles and lower thirds',
    'Logo reveals and stingers',
    'Social motion posts',
    'Explainer sequences assembled from scenes',
  ],
  documentTypes: [documentType('motion.scene')],
  capabilities: [
    {
      id: 'keyframes',
      label: 'Keyframes with easing',
      status: 'available',
      detail:
        'Animate position, scale and opacity with linear, eased, held and custom cubic interpolation; every edit is one undoable command.',
    },
    {
      id: 'graph.editor',
      label: 'Value graph editor',
      status: 'available',
      detail:
        'Drag the two control points of a segment’s cubic curve, or type the four values; presets convert to a custom curve as soon as a handle moves.',
    },
    {
      id: 'scene.vector',
      label: 'Vector scene composition',
      status: 'planned',
      detail:
        'Text, rectangle and ellipse layers already share the Design Studio document model and renderer; imported illustration artboards, path layers and true vector masks are not yet offered in the motion workspace.',
    },
    {
      id: 'expressions',
      label: 'Expressions and modifiers',
      status: 'exploratory',
      detail: 'Reusable motion logic; syntax and sandboxing are unresolved.',
    },
    {
      id: 'export.frames',
      label: 'Frame-accurate export',
      status: 'available',
      detail:
        'A deterministic PNG sequence plus a JSON manifest, zipped by the project’s own writer. Not a video codec: the studio says frame sequence rather than pretending otherwise.',
    },
  ],
  engine: {
    renderer: 'SVG/Canvas2D scene view with a deterministic evaluator',
    pipeline:
      'Pure-function scene evaluation at time t; the same evaluator drives preview and export',
    integrationPoint:
      'src/core/motion (evaluator, commands, export plan) and src/lib/browser/motion-engine.ts',
    rationale:
      'Motion graphics are usually vector and text driven, so a resolution-independent evaluator gives crisper output and easier export than a raster-first engine. Determinism (same input → same frame) is a hard requirement for trustworthy export, and the evaluator is pure so the tests can assert it directly.',
  },
  entry: { route: '/studios/motion', label: 'Open Motion Studio' },
  learningSlugs: ['keyframes-explained'],
  consumesFrom: [DESIGN_STUDIO.id, PHOTO_STUDIO.id],
  definitionVersion: 2,
};

export const ILLUSTRATION_STUDIO: StudioDefinition = {
  id: createStudioId('illustration'),
  slug: createStudioSlug('illustration'),
  name: 'Illustration Studio',
  tagline: 'Vector drawing, paths and illustration.',
  purpose:
    'Illustration Studio is the vector discipline: a pen tool for Bezier drawing, shape tools, node editing, real fills and strokes, boolean combination and asset-friendly SVG output. Its path model is the piece Motion Studio will reuse for animated vector graphics, which is why the two disciplines share one vector engine and one document model.',
  icon: 'pen',
  accent: 'violet',
  availability: 'available',
  maturityNote:
    'A working vector workspace: pen and shape tools, node and handle editing with keyboard access, fill/stroke/dash/cap/join controls, union/subtract/intersect/exclude, SVG import and export, icon-set export, and interchange with the Design Studio. Not implemented: gradients and patterns, per-node pressure or variable-width strokes, text outlining, auto-trace, and rotation of a whole shape (the document model has no rotation).',
  produces: [
    'Icons and pictograms',
    'Logos and marks',
    'Character and spot illustrations',
    'SVG assets for the web',
  ],
  documentTypes: [documentType('illustration.artboard')],
  capabilities: [
    {
      id: 'paths.drawing',
      label: 'Bezier path drawing',
      status: 'available',
      detail:
        'A pen tool that places corner nodes and drags smooth Bezier handles, a node tool for moving nodes and handles, and keyboard access to both.',
    },
    {
      id: 'shapes.basics',
      label: 'Rectangle, ellipse and star shapes',
      status: 'available',
      detail:
        'Drag shapes out on the artboard, or convert a design rectangle or ellipse into the same outline as editable paths.',
    },
    {
      id: 'shapes.boolean',
      label: 'Shape building and booleans',
      status: 'available',
      detail:
        'Union, subtract, intersect and exclude on two or more shapes, validating the result for topological consistency. Curves are flattened at a documented tolerance, so a combined shape is polygonal rather than curved — the panel reports the segment counts after every operation.',
    },
    {
      id: 'strokes.fills',
      label: 'Strokes, fills and dashes',
      status: 'available',
      detail:
        'Flat fill and stroke colours, fill rule, stroke width, opacity, line cap, line join and dash patterns — all stored in the document and written to every export.',
    },
    {
      id: 'gradients.fills',
      label: 'Gradient, pattern and filtered fills',
      status: 'planned',
      detail:
        'Needs a paint-model extension: the document currently stores one flat colour per paint.',
    },
    {
      id: 'svg.io',
      label: 'SVG import and export',
      status: 'available',
      detail:
        'A deterministic serialiser writes the artboard as SVG, and an importer brings paths, rectangles, ellipses, polygons and lines back as editable geometry. Scripts, event handlers, foreignObject and external references are refused rather than ignored.',
    },
    {
      id: 'export.icon-set',
      label: 'Icon-set export',
      status: 'available',
      detail:
        'Every selected visible vector layer becomes one SVG, plus a sprite and a manifest, packaged into a single zip download. Unselected, hidden and non-path layers are never included; the panel states the exact count before the export and names anything it could not carry.',
    },
    {
      id: 'interchange.design',
      label: 'Interchange with the Design Studio',
      status: 'available',
      detail:
        'Rectangles and ellipses become equivalent paths in both directions, and layers that cannot make the trip are listed by name instead of being dropped.',
    },
    {
      id: 'trace.exploratory',
      label: 'Auto-trace',
      status: 'exploratory',
      detail: 'Converting bitmap art to paths; quality and tooling are unresolved.',
    },
  ],
  engine: {
    renderer:
      'Canvas 2D artboard painted through the shared renderer, with DOM overlays for nodes and handles (ADR-0017)',
    pipeline:
      'Framework-free path/geometry kernel in src/core/vector, serialised by src/core/svg; booleans and hit-testing in core, downloads in the browser adapter',
    integrationPoint: 'src/components/illustration with src/core/vector',
    rationale:
      'A vector document is a geometry problem, not a pixel problem. Keeping the model independent of SVG lets the same artboard be exported as SVG, rendered to canvas for animation, or rasterised for print — and it lets the whole editing surface be tested without a browser.',
  },
  entry: { route: '/studios/illustration', label: 'Open Illustration Studio' },
  learningSlugs: ['vector-versus-raster'],
  consumesFrom: [DESIGN_STUDIO.id],
  definitionVersion: 1,
};

export const THREE_D_STUDIO: StudioDefinition = {
  id: createStudioId('three-d'),
  slug: createStudioSlug('three-d'),
  name: '3D Studio',
  tagline: 'Exploratory: modelling, materials and lighting.',
  purpose:
    '3D is listed as exploratory on purpose. A credible 3D workspace is a large commitment — scene graph, PBR materials, lighting, cameras and a rendering budget — and choosing to embed an existing engine versus writing one changes the platform’s dependency profile. The decision will be made against concrete user needs, not added for completeness.',
  icon: 'cube',
  accent: 'slate',
  availability: 'exploratory',
  maturityNote:
    'No implementation, no committed technology. Listed so the interface boundaries stay honest.',
  produces: [
    'Product and packaging mock-ups (aspirational)',
    'Simple animated 3D scenes (aspirational)',
    '3D assets for the asset catalogue (aspirational)',
  ],
  documentTypes: [documentType('three.scene')],
  capabilities: [
    {
      id: 'scene.graph',
      label: 'Scene graph with cameras and lights',
      status: 'planned',
      detail: 'Meshes, materials, PBR lighting and multiple cameras.',
    },
    {
      id: 'materials.pbr',
      label: 'Physically based materials',
      status: 'planned',
      detail: 'Metalness/roughness workflow with texture maps.',
    },
    {
      id: 'integrate.engine',
      label: 'Engine decision',
      status: 'exploratory',
      detail:
        'Embed a mature WebGL/WebGPU engine, or build a focused renderer. Both are on the table.',
    },
    {
      id: 'export.gltf',
      label: 'glTF export',
      status: 'planned',
      detail: 'Interchange with other 3D tools.',
    },
  ],
  engine: {
    renderer: 'Undecided: WebGL2/WebGPU via an embedded engine or a purpose-built renderer',
    pipeline: 'Undecided; must not be allowed to constrain the 2D engines',
    integrationPoint: 'src/studios/three-d (only if the exploratory work justifies it)',
    rationale:
      '3D has fundamentally different evaluation, memory and tooling needs from 2D. The platform records the boundary now so no existing studio is forced to become a 3D host later.',
  },
  entry: { route: null, label: '3D Studio' },
  learningSlugs: [],
  consumesFrom: [],
  definitionVersion: 1,
};

export const STUDIO_DEFINITIONS: readonly StudioDefinition[] = [
  DESIGN_STUDIO,
  PHOTO_STUDIO,
  VIDEO_STUDIO,
  MOTION_STUDIO,
  ILLUSTRATION_STUDIO,
  THREE_D_STUDIO,
] as const;
