/**
 * Curated learning content.
 *
 * All content is authored for this repository and describes features that actually exist in this
 * build, or explicitly labels them as planned. Where a lesson touches a studio that is not
 * implemented yet, it ends with a `roadmapNote` section rather than implying working software.
 */

import { brand } from '../types/brand';
import type {
  ConceptId,
  LearningConcept,
  Lesson,
  LessonId,
  ToolExplanation,
  ToolExplanationId,
} from './types';

const conceptId = (value: string): ConceptId => brand<'ConceptId'>(value);
const lessonId = (value: string): LessonId => brand<'LessonId'>(value);
const toolId = (value: string): ToolExplanationId => brand<'ToolExplanationId'>(value);

export const CONCEPTS: readonly LearningConcept[] = [
  {
    id: conceptId('canvas'),
    term: 'Canvas',
    shortDefinition: 'The fixed-size working area of a document.',
    longDefinition:
      'A canvas has a width and a height, a unit, and a resolution (DPI). Everything you place in a document lives inside the canvas, and the canvas decides the aspect ratio of the finished piece.',
    whyItMatters:
      'Choosing the canvas first prevents the most common beginner problem: finishing a design and then discovering it has the wrong shape for where it will be published.',
    alsoKnownAs: ['artboard', 'page', 'frame'],
    relatedLessonSlugs: ['canvas-and-units', 'choose-the-right-size'],
  },
  {
    id: conceptId('dpi'),
    term: 'DPI (dots per inch)',
    shortDefinition: 'How many pixels fit into one inch of the printed result.',
    longDefinition:
      'DPI only has meaning once something is printed. A 300 DPI print document needs far more pixels than the same physical size at 96 DPI, because more pixels are packed into every inch of paper.',
    whyItMatters:
      'Print work at the wrong DPI looks soft or pixelated. Screenshot work does not need print DPI at all, and using it wastes memory.',
    alsoKnownAs: ['PPI', 'resolution'],
    relatedLessonSlugs: ['canvas-and-units', 'safe-areas-and-bleed'],
  },
  {
    id: conceptId('safe-area'),
    term: 'Safe area',
    shortDefinition:
      'The region of a canvas where important content is guaranteed to stay visible.',
    longDefinition:
      'Edges get trimmed, cropped or covered: printers cut inside the paper edge, and social platforms overlay buttons and captions on top of your image. The safe area is the inset region where text and logos should live.',
    whyItMatters:
      'A headline that sits 2 mm from the edge can be cut off on paper, and a caption that sits at the bottom of a story gets hidden behind platform controls.',
    alsoKnownAs: ['margin', 'live area'],
    relatedLessonSlugs: ['safe-areas-and-bleed'],
  },
  {
    id: conceptId('bleed'),
    term: 'Bleed',
    shortDefinition: 'Extra artwork beyond the trim edge so printing cuts cleanly.',
    longDefinition:
      'Printers cannot cut with perfect accuracy, so artwork is extended a few millimetres past the intended edge. That extra band is the bleed: 3 mm is the common default, and the artwork is trimmed back to the final size afterwards.',
    whyItMatters:
      'Without bleed, tiny cutting misalignment leaves thin white slivers along the edge of a printed piece.',
    alsoKnownAs: ['trim allowance'],
    relatedLessonSlugs: ['safe-areas-and-bleed'],
  },
  {
    id: conceptId('aspect-ratio'),
    term: 'Aspect ratio',
    shortDefinition: 'The relationship between width and height, such as 16:9 or 4:5.',
    longDefinition:
      'Aspect ratio is width divided by height, reduced to the smallest whole numbers. A 1080 × 1350 canvas and a 1080 × 1350 export share the 4:5 ratio; swapping to 1:1 crops or letterboxes the content.',
    whyItMatters:
      'Every platform has preferred ratios. Knowing the ratio lets you plan one composition that reflows across placements instead of rebuilding it each time.',
    alsoKnownAs: ['ratio', 'proportion'],
    relatedLessonSlugs: ['choose-the-right-size'],
  },
  {
    id: conceptId('vector-raster'),
    term: 'Vector and raster',
    shortDefinition: 'Vector art is stored as geometry; raster art is stored as a grid of pixels.',
    longDefinition:
      'A vector image records shapes, paths and fills, so it can be scaled to any size without losing quality. A raster image records the colour of each pixel at a fixed resolution, so enlarging it reveals individual pixels.',
    whyItMatters:
      'Logos and icons belong in vectors; photographs and textures are inherently raster. Choosing the wrong one is the difference between crisp output and visible pixelation.',
    alsoKnownAs: ['bitmap vs vector'],
    relatedLessonSlugs: ['vector-versus-raster'],
  },
  {
    id: conceptId('adjustment-stack'),
    term: 'Adjustment stack',
    shortDefinition: 'An ordered list of non-destructive edits applied to an image.',
    longDefinition:
      'Instead of baking a change into pixels, each edit is stored as a step in a stack. The original image data stays untouched, so you can reorder, disable or dial back any step later.',
    whyItMatters:
      'Non-destructive editing is what makes retouching safe and repeatable: a mistake costs one parameter, not the file.',
    alsoKnownAs: ['layer stack', 'edit history'],
    relatedLessonSlugs: ['what-adjustments-actually-do'],
  },
  {
    id: conceptId('histogram'),
    term: 'Histogram',
    shortDefinition: 'A graph of how many pixels sit at each brightness level.',
    longDefinition:
      'The horizontal axis runs from black to white; the height shows how many pixels are at that level. A clump at the far left means lost shadow detail, a clump at the far right means blown highlights.',
    whyItMatters:
      'It is the fastest way to see whether an image is clipped before the damage is obvious on screen.',
    alsoKnownAs: ['levels graph'],
    relatedLessonSlugs: ['what-adjustments-actually-do'],
  },
  {
    id: conceptId('timeline'),
    term: 'Timeline',
    shortDefinition: 'A time-based view where clips and audio are arranged on tracks.',
    longDefinition:
      'The playhead marks the current moment. Tracks stack video, audio and titles; clips are segments of media placed on tracks, and a clip’s in and out points decide which part of the source it shows.',
    whyItMatters:
      'Almost every video editing operation is a manipulation of the timeline model, so understanding it makes every editing tool predictable.',
    alsoKnownAs: ['sequence', 'compositing timeline'],
    relatedLessonSlugs: ['timeline-basics'],
  },
  {
    id: conceptId('keyframe'),
    term: 'Keyframe',
    shortDefinition: 'A recorded property value at a specific point in time.',
    longDefinition:
      'Set one keyframe at 0 s with opacity 0 and another at 1 s with opacity 1, and the animation fades in. Values between keyframes are calculated by interpolation, shaped by easing.',
    whyItMatters:
      'Keyframes are the difference between motion that looks mechanical and motion that looks intentional.',
    alsoKnownAs: ['animation curve point'],
    relatedLessonSlugs: ['keyframes-explained'],
  },
  {
    id: conceptId('easing'),
    term: 'Easing',
    shortDefinition: 'How a value accelerates and decelerates between keyframes.',
    longDefinition:
      'Linear interpolation moves at a constant speed, which reads as robotic. Easing curves, such as ease-in-out, start slowly, speed up and settle, which reads as physical.',
    whyItMatters:
      'Easing is the single highest-impact detail in motion design; it costs nothing and changes everything.',
    alsoKnownAs: ['interpolation', 'timing curve'],
    relatedLessonSlugs: ['keyframes-explained'],
  },
  {
    id: conceptId('local-storage'),
    term: 'Local storage',
    shortDefinition: 'Space a browser reserves for a website on this device only.',
    longDefinition:
      'Euler’s Forge saves projects in your browser’s local storage. The data belongs to the browser profile: it is not uploaded, not synced, and not available on another device or in a different browser.',
    whyItMatters:
      'Knowing where work is stored tells you when to export a project file as a backup, and why clearing site data is destructive.',
    alsoKnownAs: ['device storage', 'offline storage'],
    relatedLessonSlugs: ['how-your-projects-are-stored'],
  },
] as const;

export const TOOL_EXPLANATIONS: readonly ToolExplanation[] = [
  {
    id: toolId('tool.canvas-settings'),
    toolLabel: 'Canvas settings',
    summary: 'Defines the size, unit and resolution of the working document.',
    whatItDoes:
      'Sets the canvas width and height, the unit they are measured in (pixels, millimetres or inches), the resolution used for unit conversion, and the background colour or transparency.',
    whyUseIt:
      'The canvas is the contract for everything else: guides, safe areas, export checks and platform fit all derive from it. Getting it right first saves rebuilding a layout later.',
    settings: [
      {
        name: 'Width and height',
        whatItDoes: 'The canvas size, expressed in the selected unit.',
        whyItMatters:
          'Combined with the unit, this decides both the aspect ratio and the physical size of the result.',
        typicalValues:
          '1080 × 1080 for square social, 1080 × 1350 for portrait social, 1920 × 1080 for slides, 297 × 420 mm for an A3 poster.',
        advancedAlternative:
          'For multi-page print work, professionals set up separate documents per page or sizes per artboard rather than one oversized canvas.',
      },
      {
        name: 'Unit',
        whatItDoes: 'Whether numbers you type mean pixels, millimetres or inches.',
        whyItMatters:
          'Print suppliers specify physical sizes. Screens do not. Mixing units is a common source of wrong-size output.',
        typicalValues: 'px for anything screen-first, mm for European print, in for US print.',
        advancedAlternative:
          'A full colour-managed print pipeline would let you switch units per measurement while keeping the document’s physical size fixed.',
      },
      {
        name: 'DPI',
        whatItDoes: 'Pixels per inch used to convert between physical units and pixels.',
        whyItMatters:
          'It decides whether a print document has enough resolution. 300 DPI is the usual print baseline.',
        typicalValues:
          '96 DPI for screen drafts, 300 DPI for print, 150 DPI for large-format viewed at distance.',
        advancedAlternative:
          'Large-format printing uses effective resolution based on viewing distance rather than a fixed DPI.',
      },
      {
        name: 'Background',
        whatItDoes: 'The base colour of the document; transparency removes it entirely.',
        whyItMatters:
          'Backgrounds affect contrast and how the piece looks on dark or light placements.',
        typicalValues:
          'White for print, a brand dark or light tone for screen, transparent when artwork must be placed over something else.',
        advancedAlternative:
          'Layer-level backgrounds and gradient fills let you vary the backdrop per region instead of document-wide.',
      },
    ],
    whenAdvancedIsAppropriate: [
      'When a print supplier has given you a house template with fixed trim size, bleed and margin values.',
      'When you need CMYK-accurate colour rather than sRGB approximations.',
      'When artwork must sit transparently over an unknown background.',
    ],
    relatedConceptIds: [conceptId('canvas'), conceptId('dpi'), conceptId('aspect-ratio')],
    relatedLessonSlugs: ['canvas-and-units', 'choose-the-right-size'],
    studioIds: ['design'],
  },
  {
    id: toolId('tool.guides'),
    toolLabel: 'Guides: safe area, bleed, grid',
    summary: 'Overlays that show where content may safely sit.',
    whatItDoes:
      'Draws a safe margin inset from the edges, an optional bleed band outside the canvas, centre lines and a measurement grid.',
    whyUseIt:
      'Guides turn layout rules into something you can see while working, which is how the habit gets built.',
    settings: [
      {
        name: 'Safe margin',
        whatItDoes: 'How far inside the canvas edge the safe area starts.',
        whyItMatters: 'Text and logos inside this inset survive trimming and platform overlays.',
        typicalValues: '6–12 mm for print; 5–8% of the canvas dimension for screen work.',
        advancedAlternative:
          'Magazine and book layouts use multi-column grids with narrower gutters and separate outer margins for facing pages.',
      },
      {
        name: 'Bleed',
        whatItDoes: 'The band of artwork that extends past the trim edge.',
        whyItMatters: 'It prevents white slivers from imperfect cutting.',
        typicalValues: '3 mm standard, 5 mm for thick stock, 0 for digital-only work.',
        advancedAlternative:
          'Packaging and die-cut work needs a separate dieline file and creates bleed per panel.',
      },
      {
        name: 'Grid',
        whatItDoes: 'Evenly spaced lines at a fixed interval in millimetres.',
        whyItMatters:
          'A grid makes alignment objective, which is most of what makes a layout look deliberate.',
        typicalValues: '10 mm for A4, 5 mm for cards, multiples of 4 px for interface work.',
        advancedAlternative:
          'Baseline grids and modular column systems give finer typographic control once you are comfortable with a plain grid.',
      },
    ],
    whenAdvancedIsAppropriate: [
      'When producing a series of pieces that must share one underlying grid.',
      'When a printer or platform publishes exact safe-area specifications.',
    ],
    relatedConceptIds: [conceptId('safe-area'), conceptId('bleed')],
    relatedLessonSlugs: ['safe-areas-and-bleed'],
    studioIds: ['design'],
  },
  {
    id: toolId('tool.export-readiness'),
    toolLabel: 'Export readiness check',
    summary: 'Validates a document against the requirements of the format you chose.',
    whatItDoes:
      'Runs a set of checks — canvas limits, resolution for print, bleed, safe areas, title, palette and schema validity — and reports what passes, what warns and what blocks.',
    whyUseIt:
      'It moves the common failures from the end of a project to the moment you can still fix them cheaply.',
    settings: [
      {
        name: 'Format',
        whatItDoes: 'Chooses which format the checks are evaluated against.',
        whyItMatters:
          'Requirements differ: print formats need resolution and bleed; the project file must be schema-valid.',
        typicalValues: 'PNG for screen delivery, PDF for print, the project file for backup.',
        advancedAlternative:
          'Production pipelines add colour-space checks, overprint simulation and preflight profiles.',
      },
    ],
    whenAdvancedIsAppropriate: [
      'When a print house supplies a preflight profile.',
      'When output must meet accessibility or brand-compliance rules with no manual review.',
    ],
    relatedConceptIds: [conceptId('dpi'), conceptId('bleed'), conceptId('safe-area')],
    relatedLessonSlugs: ['export-readiness'],
    studioIds: ['design'],
  },
  {
    id: toolId('tool.history'),
    toolLabel: 'History and undo',
    summary: 'Every document change in this workspace is a command you can undo or redo.',
    whatItDoes:
      'Records each applied change with a label, and lets you step backwards and forwards through the sequence. The history panel is only a view over that stack.',
    whyUseIt:
      'Undo is the cheapest safety net in editing. Knowing what is recorded tells you when you can experiment freely.',
    settings: [
      {
        name: 'History depth',
        whatItDoes: 'How many steps are kept before the oldest is discarded.',
        whyItMatters: 'A deep stack lets you explore; some tools cap it to bound memory.',
        typicalValues: 'Euler’s Forge keeps up to 100 steps per document in this phase.',
        advancedAlternative:
          'Snapshot-based history lets editors jump to a named state instead of undoing many steps.',
      },
    ],
    whenAdvancedIsAppropriate: [
      'When you want named restore points before a risky change.',
      'When multiple people edit the same document, where linear undo stops being sufficient.',
    ],
    relatedConceptIds: [],
    relatedLessonSlugs: ['your-first-project'],
    studioIds: ['design'],
  },
] as const;

export const LESSONS: readonly Lesson[] = [
  {
    id: lessonId('lesson.canvas-and-units'),
    slug: 'canvas-and-units',
    kind: 'concept',
    title: 'Canvas, units and pixels per inch',
    summary:
      'How a document’s width, height, unit and DPI work together — and why the canvas is the first decision you make.',
    difficulty: 'beginner',
    estimatedMinutes: 6,
    studioIds: ['design'],
    conceptIds: [conceptId('canvas'), conceptId('dpi')],
    tags: ['fundamentals', 'canvas', 'print'],
    objectives: [
      'Explain the difference between pixels, millimetres and inches in a design document.',
      'Decide which unit and DPI a project needs before starting.',
      'Predict when a canvas has too few pixels for its intended output.',
    ],
    prerequisites: [],
    sections: [
      {
        type: 'prose',
        heading: 'A canvas has two kinds of size',
        body: [
          'A canvas has a pixel size (width × height in pixels) and, once you choose a physical unit, a physical size as well. 210 × 297 mm at 300 DPI is 2480 × 3508 pixels. It is the same piece of paper described two ways.',
          'The pixel count decides how much detail the file can hold. The physical size decides how big it looks when printed. DPI is the bridge between them.',
        ],
      },
      {
        type: 'terms',
        heading: 'Three numbers that get confused',
        terms: [
          {
            term: 'Pixel',
            definition:
              'One colour sample in a raster image. There is no such thing as a low- or high-quality pixel; there are only enough or too few of them.',
          },
          {
            term: 'DPI',
            definition:
              'Dots per inch — how many pixels are packed into each inch of a physical output. It is a property of the output, not of the image file.',
          },
          {
            term: 'Unit',
            definition:
              'The measurement system used for the canvas numbers. Choose it first: switching later changes what every number means.',
          },
        ],
      },
      {
        type: 'compare',
        heading: 'When to use which unit',
        columns: ['Screen-first work', 'Print work'],
        rows: [
          { label: 'Typical unit', left: 'px', right: 'mm or in' },
          {
            label: 'Typical resolution',
            left: '72–96 DPI (DPI is irrelevant to delivery)',
            right: '300 DPI',
          },
          {
            label: 'What breaks first',
            left: 'Wrong aspect ratio for the platform',
            right: 'Too few pixels, so fine text goes soft',
          },
          { label: 'Bleed', left: 'Not needed', right: 'Usually 3 mm' },
        ],
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'Do the arithmetic once',
        body: 'Before creating a project, write down the final size and the delivery target. Euler’s Forge shows the aspect ratio, megapixels and physical size of your canvas in the workspace inspector, so you can confirm both at a glance instead of guessing.',
      },
      {
        type: 'checklist',
        heading: 'Guided exercise (5 minutes)',
        items: [
          {
            id: 'create-canvas',
            label: 'Create a project from the Square post preset',
            why: 'You start from a size that is known to work for its platform.',
            actionHref: '/create',
            actionLabel: 'Open the creation flow',
          },
          {
            id: 'switch-unit',
            label: 'Switch the canvas unit to millimetres and read the new numbers',
            why: 'Seeing the same canvas described in two units makes the conversion concrete.',
          },
          {
            id: 'restore',
            label: 'Undo the change with Ctrl/Cmd + Z',
            why: 'Document changes in the workspace are commands, so you can experiment without fear.',
          },
          {
            id: 'compare-dpi',
            label:
              'Set the unit back to px, then to mm with 300 DPI, and compare the pixel dimensions',
            why: 'The physical size stays the same while the pixel count changes — this is the lesson.',
          },
        ],
      },
    ],
    relatedLessonSlugs: ['choose-the-right-size', 'safe-areas-and-bleed', 'export-readiness'],
    relatedAssetIds: [],
    updatedAt: '2026-02-02',
    status: 'published',
  },
  {
    id: lessonId('lesson.choose-the-right-size'),
    slug: 'choose-the-right-size',
    kind: 'concept',
    title: 'Choosing the right size for the placement',
    summary:
      'Platform ratios, safe crops and why designing at the final size beats designing big and hoping.',
    difficulty: 'beginner',
    estimatedMinutes: 5,
    studioIds: ['design'],
    conceptIds: [conceptId('aspect-ratio'), conceptId('canvas')],
    tags: ['fundamentals', 'social', 'layout'],
    objectives: [
      'Match a canvas size to a platform placement.',
      'Rebuild one composition across two aspect ratios without redesigning it.',
      'Recognise when a crop would destroy a layout.',
    ],
    prerequisites: ['canvas-and-units'],
    sections: [
      {
        type: 'prose',
        heading: 'Every placement has a shape',
        body: [
          'A feed post, a story, a slide and a poster all have different shapes. Starting from the right shape means the first layout decision is already correct, and it makes the export step uneventful.',
          'Euler’s Forge ships 13 canvas presets covering social, web, video, presentation and print sizes. They are starting points, not limits: every value stays editable.',
        ],
      },
      {
        type: 'steps',
        heading: 'A reliable way to work across placements',
        steps: [
          {
            title: 'Design the primary placement first',
            detail:
              'Build the composition at its final size, for example 1080 × 1350 for a portrait feed post.',
          },
          {
            title: 'Identify the load-bearing elements',
            detail:
              'Usually a headline, one image and one call to action. Everything else is decor and can be dropped.',
          },
          {
            title: 'Recreate, do not squash',
            detail:
              'For a 1:1 version, build a new composition at 1080 × 1080 and move the load-bearing elements. Scaling a 4:5 design into a square distorts nothing but changes every proportion you tuned.',
          },
          {
            title: 'Re-check the safe area',
            detail: 'The narrower dimension of the new ratio decides the new safe inset.',
          },
        ],
      },
      {
        type: 'callout',
        tone: 'note',
        title: 'One document, many outputs — later',
        body: 'Studio-grade tools let you place several artboards in one document and export them together. In this phase each project is a single canvas, so plan on one document per placement. Multi-artboard documents are on the roadmap.',
      },
      {
        type: 'roadmapNote',
        title: 'What is not built yet',
        body: 'Artboard duplication, layout reflow and batch export of multiple sizes do not exist in this build. The roadmap lists multi-artboard documents as a Phase 2 item.',
      },
    ],
    relatedLessonSlugs: ['canvas-and-units', 'your-first-project'],
    relatedAssetIds: [],
    updatedAt: '2026-02-02',
    status: 'published',
  },
  {
    id: lessonId('lesson.safe-areas-and-bleed'),
    slug: 'safe-areas-and-bleed',
    kind: 'concept',
    title: 'Safe areas, margins and bleed',
    summary:
      'Why finished pieces get trimmed and covered — and how to lay out work that survives both.',
    difficulty: 'intermediate',
    estimatedMinutes: 7,
    studioIds: ['design'],
    conceptIds: [conceptId('safe-area'), conceptId('bleed')],
    tags: ['print', 'layout', 'production'],
    objectives: [
      'Set a safe margin appropriate to print or screen work.',
      'Explain the difference between trim size and bleed.',
      'Spot content that would be lost to trimming or platform overlays.',
    ],
    prerequisites: ['canvas-and-units'],
    sections: [
      {
        type: 'prose',
        heading: 'Two kinds of edge risk',
        body: [
          'Inside the canvas, platform interfaces and reader attention take space away from the edges. Outside the canvas, paper gets cut to size after printing, and cutting is never exact.',
          'Safe areas handle the first risk. Bleed handles the second.',
        ],
      },
      {
        type: 'terms',
        heading: 'Production vocabulary',
        terms: [
          { term: 'Trim size', definition: 'The final size of the finished piece after cutting.' },
          {
            term: 'Bleed',
            definition:
              'Artwork extending beyond the trim size so cutting inaccuracy cannot produce white edges. 3 mm is the common default.',
          },
          {
            term: 'Safe area / live area',
            definition:
              'The inset region where text and identity elements should stay, away from cuts and folds.',
          },
          {
            term: 'Slug',
            definition:
              'Space beyond the bleed reserved for crop marks and printer notes. Never design content into it.',
          },
        ],
      },
      {
        type: 'steps',
        heading: 'Setting up a print-safe document',
        steps: [
          {
            title: 'Choose the physical size',
            detail: 'For example 210 × 297 mm for A4 at 300 DPI.',
          },
          {
            title: 'Add bleed',
            detail:
              'Set 3 mm unless the printer specifies otherwise. In Euler’s Forge this draws a band outside the canvas edge.',
          },
          {
            title: 'Add the safe margin',
            detail:
              '12 mm is a comfortable default for A4; go larger if the piece will be handled or displayed behind glass.',
          },
          {
            title: 'Keep text inside the safe area',
            detail: 'Background artwork may reach the trim edge; type and logos should not.',
          },
          {
            title: 'Run the export readiness check',
            detail:
              'It flags missing bleed and margin values for print formats before you send anything to a printer.',
          },
        ],
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'Full-bleed artwork needs full-bleed data',
        body: 'If a colour field is meant to reach the paper edge, extend it past the trim size — not to it. Ending artwork exactly at the trim line is the most common cause of white slivers on printed work.',
      },
      {
        type: 'checklist',
        heading: 'Guided exercise (6 minutes)',
        items: [
          {
            id: 'print-preset',
            label: 'Create a project from the A4 print preset',
            why: 'Notice that the canvas is measured in millimetres and set to 300 DPI.',
            actionHref: '/create',
            actionLabel: 'Open the creation flow',
          },
          {
            id: 'set-bleed',
            label: 'Set bleed to 3 mm and safe margin to 12 mm in the guides panel',
            why: 'You are configuring the document the way a print supplier would expect it.',
          },
          {
            id: 'toggle-grid',
            label: 'Toggle the grid on and off',
            why: 'Guides are overlays: they never appear in the exported file.',
          },
          {
            id: 'read-check',
            label: 'Read the export readiness checks for the PDF format',
            why: 'This is where print mistakes get caught early.',
          },
        ],
      },
    ],
    relatedLessonSlugs: ['canvas-and-units', 'export-readiness'],
    relatedAssetIds: ['preset.print-bleed-3mm'],
    updatedAt: '2026-02-02',
    status: 'published',
  },
  {
    id: lessonId('lesson.vector-versus-raster'),
    slug: 'vector-versus-raster',
    kind: 'concept',
    title: 'Vector and raster: choosing the right material',
    summary:
      'Why a logo can scale to a billboard and a photograph cannot — and how that shapes what you build with.',
    difficulty: 'beginner',
    estimatedMinutes: 5,
    studioIds: ['design', 'illustration', 'photo'],
    conceptIds: [conceptId('vector-raster')],
    tags: ['fundamentals', 'assets'],
    objectives: [
      'Describe the difference between vector and raster data.',
      'Pick the correct source material for a layout.',
      'Explain why enlarging a raster image cannot add detail.',
    ],
    prerequisites: [],
    sections: [
      {
        type: 'prose',
        heading: 'Geometry versus pixels',
        body: [
          'A vector file stores instructions: draw a curve from here to there with this stroke. The renderer works out the pixels at whatever size you ask for, so the result stays sharp.',
          'A raster file stores a grid of measured colours. It has one correct size. Enlarging it spreads the existing samples over more space, which is why enlarged photographs and screenshots look soft.',
        ],
      },
      {
        type: 'compare',
        heading: 'Practical differences',
        columns: ['Vector', 'Raster'],
        rows: [
          {
            label: 'Scales cleanly',
            left: 'Yes, at any size',
            right: 'Only up to its native resolution',
          },
          {
            label: 'Good for',
            left: 'Logos, icons, type, diagrams, illustration',
            right: 'Photographs, textures, painted work, screenshots',
          },
          { label: 'Typical formats', left: 'SVG, PDF, AI', right: 'JPEG, PNG, WebP, TIFF, RAW' },
          {
            label: 'File size behaviour',
            left: 'Grows with complexity, not size',
            right: 'Grows quickly with resolution',
          },
        ],
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'The 2× rule for screens',
        body: 'For screen delivery, export raster artwork at twice the CSS pixel size you will display when the file allows it. High-density displays then have real detail to work with instead of interpolated guesswork.',
      },
      {
        type: 'roadmapNote',
        title: 'Where this lands in Euler’s Forge',
        body: 'Design Studio will consume both vector and raster assets. The vector model belongs to Illustration Studio, and the raster pipeline to Photo Studio; neither is implemented in this phase, so the asset catalogue currently describes vector and raster material as metadata only.',
      },
    ],
    relatedLessonSlugs: ['choose-the-right-size'],
    relatedAssetIds: ['graphic.geometric-marks'],
    updatedAt: '2026-02-02',
    status: 'published',
  },
  {
    id: lessonId('lesson.what-adjustments-actually-do'),
    slug: 'what-adjustments-actually-do',
    kind: 'concept',
    title: 'What photo adjustments actually do',
    summary:
      'Exposure, contrast, white balance, curves and sharpening explained in terms of the pixels you are changing.',
    difficulty: 'intermediate',
    estimatedMinutes: 9,
    studioIds: ['photo'],
    conceptIds: [conceptId('adjustment-stack'), conceptId('histogram')],
    tags: ['photo', 'colour', 'theory'],
    objectives: [
      'Predict what each core adjustment will do to an image and its histogram.',
      'Apply adjustments in a sensible order.',
      'Recognise when clipping has already destroyed detail.',
    ],
    prerequisites: [],
    sections: [
      {
        type: 'prose',
        heading: 'Adjustments move or reshape tone',
        body: [
          'Every basic adjustment does one of three things: it shifts brightness, it redistributes contrast across the tone range, or it changes colour relationships. Naming which one you want is most of the skill.',
        ],
      },
      {
        type: 'terms',
        heading: 'The core set',
        terms: [
          {
            term: 'Exposure',
            definition:
              'Multiplies brightness uniformly. Blown highlights stay blown — exposure cannot recover data that reached pure white.',
          },
          {
            term: 'Contrast',
            definition:
              'Pushes values away from the mid-grey point, darkening shadows and brightening highlights.',
          },
          {
            term: 'White balance',
            definition:
              'Shifts the overall colour cast, usually to neutralise a warm indoor shot or a blue overcast shot.',
          },
          {
            term: 'Curves',
            definition:
              'Remaps input tone to output tone with a freeform line. Steepening a section increases local contrast there; flattening it compresses.',
          },
          {
            term: 'Saturation / vibrance',
            definition:
              'Saturation scales all colours equally; vibrance pushes muted colours more than already-saturated ones, protecting skin tones.',
          },
          {
            term: 'Sharpening',
            definition:
              'Increases local edge contrast. It cannot create detail, and over-applied it produces halos along high-contrast edges.',
          },
        ],
      },
      {
        type: 'steps',
        heading: 'A dependable order of operations',
        steps: [
          {
            title: 'Crop and straighten first',
            detail:
              'Composition is the largest-scale decision, and cropping changes what the exposure tools are averaging over.',
          },
          {
            title: 'Set white balance',
            detail:
              'Neutralise colour before judging tone; a colour cast biases your perception of brightness.',
          },
          {
            title: 'Set exposure',
            detail:
              'Get overall brightness into range, watching the histogram for clipped whites or crushed blacks.',
          },
          {
            title: 'Add local tone control with curves',
            detail:
              'Use curves for contrast shaping rather than a global contrast slider once you want control.',
          },
          {
            title: 'Adjust colour',
            detail: 'Saturation or vibrance last, since tone changes alter perceived colour.',
          },
          {
            title: 'Sharpen for the output size',
            detail:
              'Sharpening should match the final delivery size and medium, and it belongs at the end of the chain.',
          },
        ],
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'Order matters, and non-destructive wins',
        body: 'In an adjustment stack, reordering changes the result: sharpening before a heavy contrast move amplifies the halos. Because a non-destructive stack stores parameters rather than baked pixels, you can revisit any step without starting over.',
      },
      {
        type: 'roadmapNote',
        title: 'Photo Studio status',
        body: 'Photo Studio is planned, not implemented. There is no adjustment stack to use in this build yet — this lesson exists so the concepts are in place before the tools arrive, and so you can follow it in any editor in the meantime.',
      },
    ],
    relatedLessonSlugs: ['vector-versus-raster'],
    relatedAssetIds: ['texture.matte-grain'],
    updatedAt: '2026-02-02',
    status: 'published',
  },
  {
    id: lessonId('lesson.timeline-basics'),
    slug: 'timeline-basics',
    kind: 'concept',
    title: 'How a video timeline is organised',
    summary:
      'Tracks, clips, in and out points, ripple versus overwrite, and frame rates — the mental model behind every edit.',
    difficulty: 'beginner',
    estimatedMinutes: 7,
    studioIds: ['video'],
    conceptIds: [conceptId('timeline')],
    tags: ['video', 'theory'],
    objectives: [
      'Describe tracks, clips and the playhead without jargon.',
      'Distinguish ripple edits from overwrite edits.',
      'Explain frame rate and why mismatched footage stutters.',
    ],
    prerequisites: [],
    sections: [
      {
        type: 'prose',
        heading: 'A timeline is a model of time',
        body: [
          'Tracks are horizontal lanes. Video tracks stack: the upper track hides the lower one where it has content. Audio tracks mix additively. The playhead marks the moment you are looking at, and everything on the timeline is positioned relative to it.',
          'A clip is a window onto a longer source file. Its in and out points decide which part of the source appears, and where the clip sits on the timeline decides when it appears. Trimming a clip changes its window, not the original media.',
        ],
      },
      {
        type: 'terms',
        heading: 'Editing vocabulary',
        terms: [
          {
            term: 'Ripple edit',
            definition:
              'Shortening a clip closes the gap by pulling everything after it earlier. Timing downstream changes.',
          },
          {
            term: 'Overwrite edit',
            definition:
              'Replacing a section in place while everything else stays put. Useful when timing must not move.',
          },
          {
            term: 'J-cut / L-cut',
            definition:
              'Offsetting audio and video so sound runs before or after the picture, smoothing transitions between shots.',
          },
          {
            term: 'Frame rate',
            definition:
              'Frames per second. Mixing 24 and 30 fps footage in one timeline introduces either duplicated or dropped frames.',
          },
          {
            term: 'Proxy',
            definition:
              'A lower-resolution stand-in for a large file so scrubbing stays responsive; the original is used for final export.',
          },
        ],
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'Cut on the audio, not the picture',
        body: 'Speech and music give you the beats. Placing cuts on audible beats while watching only the audio waveform produces edits that feel intentional, even when visual motion is continuous.',
      },
      {
        type: 'roadmapNote',
        title: 'Video Studio status',
        body: 'Video Studio is planned, not implemented. Browser-based decoding and encoding restrictions mean the timeline model and playback strategy are being designed together — see the roadmap for the dependency chain. Nothing in this build edits video.',
      },
    ],
    relatedLessonSlugs: ['keyframes-explained'],
    relatedAssetIds: ['template.motion-title-card'],
    updatedAt: '2026-02-02',
    status: 'published',
  },
  {
    id: lessonId('lesson.keyframes-explained'),
    slug: 'keyframes-explained',
    kind: 'concept',
    title: 'Keyframes and easing in plain language',
    summary:
      'How two recorded values become smooth movement, and why easing is the difference between mechanical and convincing.',
    difficulty: 'beginner',
    estimatedMinutes: 6,
    studioIds: ['motion'],
    conceptIds: [conceptId('keyframe'), conceptId('easing')],
    tags: ['motion', 'animation', 'theory'],
    objectives: [
      'Explain what a keyframe stores and what interpolation does.',
      'Choose an easing profile for common motion goals.',
      'Identify the animation timing that makes motion feel heavy or light.',
    ],
    prerequisites: ['timeline-basics'],
    sections: [
      {
        type: 'prose',
        heading: 'Two values, and everything in between',
        body: [
          'A keyframe records one property at one moment: position at 0 s, opacity at 1.2 s. With two keyframes on the same property, the software produces every intermediate value, usually 60 times a second.',
          'Interpolation is the rule used to fill those gaps. Held keyframes jump, linear keyframes move at constant speed, and eased keyframes accelerate and decelerate.',
        ],
      },
      {
        type: 'compare',
        heading: 'Choosing an easing profile',
        columns: ['Easing', 'Reads as'],
        rows: [
          {
            label: 'Linear',
            left: 'Mechanical, useful for continuous motion such as a rotating dial',
            right: '',
          },
          {
            label: 'Ease out',
            left: 'Starts fast, settles gently — the natural finish of something thrown',
            right: '',
          },
          {
            label: 'Ease in',
            left: 'Starts slowly and accelerates — a heavy object starting to move',
            right: '',
          },
          {
            label: 'Ease in-out',
            left: 'Smooth at both ends; the safe default for interface and title motion',
            right: '',
          },
          {
            label: 'Stepped / hold',
            left: 'No interpolation at all — a deliberate jump, useful for flicker and stop-motion feels',
            right: '',
          },
        ],
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'Timing before easing',
        body: 'If a movement feels wrong, change when it happens before changing how it accelerates. Duration carries more meaning than curvature: 200 ms reads responsive, 800 ms reads deliberate.',
      },
      {
        type: 'roadmapNote',
        title: 'Motion Studio status',
        body: 'Motion Studio is planned, not implemented. The evaluator described here is a design decision recorded in the architecture documentation so that preview and exported frames cannot disagree.',
      },
    ],
    relatedLessonSlugs: ['timeline-basics'],
    relatedAssetIds: ['template.motion-title-card'],
    updatedAt: '2026-02-02',
    status: 'published',
  },
  {
    id: lessonId('lesson.how-your-projects-are-stored'),
    slug: 'how-your-projects-are-stored',
    kind: 'guide',
    title: 'Where your projects live (and what that means)',
    summary:
      'Euler’s Forge stores projects in this browser on this device. Here is exactly what that covers, and how to keep work safe.',
    difficulty: 'beginner',
    estimatedMinutes: 4,
    studioIds: [],
    conceptIds: [conceptId('local-storage')],
    tags: ['platform', 'storage', 'backup'],
    objectives: [
      'State where project data is stored and what is not stored.',
      'Export a project file as a backup.',
      'Recognise the actions that would delete local data.',
    ],
    prerequisites: [],
    sections: [
      {
        type: 'prose',
        heading: 'Device-local by design, for now',
        body: [
          'There is no account, no server and no sync in this phase. Projects are written to your browser’s local storage for this site, on this device, in this browser profile.',
          'That means: opening the app in a different browser will not show your projects. Clearing site data will remove them. Private or incognito windows may discard everything when they close.',
        ],
      },
      {
        type: 'steps',
        heading: 'Keeping work safe',
        steps: [
          {
            title: 'Export a project file after a session of real work',
            detail:
              'The workspace offers a .forge.json download containing the document definition: canvas, guides, palette and metadata.',
          },
          {
            title: 'Keep exported files somewhere you already back up',
            detail:
              'The browser is not a backup location, no matter which application writes to it.',
          },
          {
            title: 'Check storage health in Settings',
            detail:
              'Settings shows how much local space projects currently occupy and whether any record was skipped as unreadable.',
          },
        ],
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'When the browser refuses to store anything',
        body: 'Some configurations — private browsing, blocked site data, or cookies turned off — do not allow local storage at all. In that case the app keeps working but holds projects in memory for the tab only, and the interface says so with a banner, a workspace warning instead of a “saved” message, and a storage row in Settings. Nothing survives a reload, so export project files immediately if you intend to keep working that way.',
      },
      {
        type: 'callout',
        tone: 'note',
        title: 'Versioning protects you later',
        body: 'Every stored project carries a schema version. When the document model changes, older projects are migrated forward on load rather than being discarded. A project saved by a newer version of the app is refused with a clear message instead of being silently downgraded.',
      },
      {
        type: 'callout',
        tone: 'warning',
        title: '“Clear local data” is destructive',
        body: 'Settings includes a reset action. It deletes every locally stored project in this browser immediately and cannot be undone. Export first if the work matters.',
      },
    ],
    relatedLessonSlugs: ['your-first-project'],
    relatedAssetIds: [],
    updatedAt: '2026-02-02',
    status: 'published',
  },
  {
    id: lessonId('lesson.export-readiness'),
    slug: 'export-readiness',
    kind: 'tutorial',
    title: 'Passing the export readiness check',
    summary:
      'How the export checklist evaluates a document, what each result means, and which formats exist versus which are still planned.',
    difficulty: 'intermediate',
    estimatedMinutes: 6,
    studioIds: ['design'],
    conceptIds: [conceptId('dpi'), conceptId('bleed'), conceptId('safe-area')],
    tags: ['export', 'production', 'checklist'],
    objectives: [
      'Interpret pass, warning and blocked results correctly.',
      'Fix the problems the checks surface.',
      'State which export formats are available today.',
    ],
    prerequisites: ['canvas-and-units'],
    sections: [
      {
        type: 'prose',
        heading: 'Checks are format-specific',
        body: [
          'The same document can be totally ready for one destination and unfit for another. A screen-first square is fine for PNG delivery and has no business being declared print-ready.',
          'Pick the format first, then read the checks in that context.',
        ],
      },
      {
        type: 'terms',
        heading: 'Result types',
        terms: [
          { term: 'Pass', definition: 'A requirement is satisfied. Nothing to do.' },
          {
            term: 'Warning',
            definition:
              'Not fatal, but worth a decision — for example a palette that has not been chosen yet.',
          },
          {
            term: 'Blocked',
            definition:
              'The document cannot meet the format’s requirements in its current state. Fix the listed item or choose another format.',
          },
        ],
      },
      {
        type: 'callout',
        tone: 'note',
        title: 'What is genuinely available to export today',
        body: 'One format is implemented: the .forge.json project file, which contains the document definition. PNG, JPEG, PDF, SVG and video formats are listed in the UI as planned so you can see the intended shape of the pipeline — but no rasteriser exists in this build, and the interface says so rather than producing an empty file.',
      },
      {
        type: 'checklist',
        heading: 'Guided exercise (5 minutes)',
        items: [
          {
            id: 'open-workspace',
            label: 'Open a project from your library',
            why: 'The export panel lives in the workspace, next to the checks it explains.',
            actionHref: '/projects',
            actionLabel: 'Open your projects',
          },
          {
            id: 'read-blockers',
            label: 'Read every blocked item and decide whether to fix or change format',
            why: 'Blocked items are the only ones that stop a valid export.',
          },
          {
            id: 'download',
            label: 'Download the project file',
            why: 'This is a real download of the document definition — a useful backup and a way to inspect the model.',
          },
        ],
      },
    ],
    relatedLessonSlugs: ['safe-areas-and-bleed', 'how-your-projects-are-stored'],
    relatedAssetIds: ['preset.print-bleed-3mm'],
    updatedAt: '2026-02-02',
    status: 'published',
  },
  {
    id: lessonId('lesson.your-first-project'),
    slug: 'your-first-project',
    kind: 'tutorial',
    title: 'Your first project, start to finish',
    summary:
      'A complete beginner walkthrough: choose a size, set guides, pick a palette, export a file. Every step exists in this build.',
    difficulty: 'beginner',
    estimatedMinutes: 12,
    studioIds: ['design'],
    conceptIds: [conceptId('canvas'), conceptId('safe-area'), conceptId('local-storage')],
    tags: ['tutorial', 'getting-started'],
    objectives: [
      'Create a project from a preset and adjust it deliberately.',
      'Configure guides and a working palette.',
      'Export a project file and know where the project now lives.',
    ],
    prerequisites: [],
    sections: [
      {
        type: 'prose',
        heading: 'What you will produce',
        body: [
          'A configured design document for a real placement, with guides, a palette and an exported project file. No prior editing experience is assumed, and nothing in this walkthrough depends on tools that do not exist yet.',
        ],
      },
      {
        type: 'steps',
        heading: 'Walkthrough',
        steps: [
          {
            title: 'Open the creation flow',
            detail: 'Home → Create new project, or press Cmd/Ctrl + K and run “New project”.',
          },
          {
            title: 'Choose a studio and a canvas preset',
            detail:
              'Design Studio is the only studio with a working workspace today. Pick a preset such as Portrait post (1080 × 1350).',
          },
          {
            title: 'Name the project and confirm the canvas',
            detail:
              'The review step shows the aspect ratio, megapixel count and physical size of the canvas you are about to create.',
          },
          {
            title: 'Set guides in the workspace',
            detail:
              'Open the inspector’s Guides section. For social work, an 8 mm safe margin with centre lines on is a sound starting point.',
          },
          {
            title: 'Choose a working palette',
            detail:
              'Add up to 12 hex colours, or start from a bundled sample palette in the asset catalogue. The palette is a decision you can change later.',
          },
          {
            title: 'Export the project file',
            detail:
              'In the export panel, run the readiness checks and download the .forge.json project file.',
          },
          {
            title: 'Practise undo',
            detail:
              'Change anything, then press Ctrl/Cmd + Z. Every document change in the workspace is a command with a label in the history panel.',
          },
        ],
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'Where to go next',
        body: 'Once the project exists, the workspace links every control to its explanation: open the contextual panel in the inspector to read what a guide setting does without leaving the document. When you want more control, Settings exposes the defaults for new projects so you stop re-configuring the same values.',
      },
    ],
    exercise: {
      id: 'exercise.first-project',
      title: 'Configure a social post document',
      goal: 'Produce a validated 1080 × 1350 document with guides, palette and an exported project file.',
      estimatedMinutes: 12,
      steps: [
        {
          id: 'create',
          label: 'Create a project from the Portrait post preset',
          detail:
            'Creation validates your input and refuses incomplete names, so you always get a valid document.',
        },
        {
          id: 'guides',
          label: 'Set safe margin to 8 mm, turn centre lines on',
          detail: 'Both values are stored in the document, not in the interface.',
        },
        {
          id: 'palette',
          label: 'Add at least three palette colours',
          detail:
            'Palette decisions are captured with the document so future studios can reuse them.',
        },
        {
          id: 'export',
          label: 'Export the project file',
          detail: 'The download is the document definition, ready to re-import when import lands.',
        },
      ],
      workspaceHref: '/projects',
    },
    relatedLessonSlugs: ['canvas-and-units', 'export-readiness', 'how-your-projects-are-stored'],
    relatedAssetIds: ['template.square-promo', 'palette.graphite-ember'],
    updatedAt: '2026-02-02',
    status: 'published',
  },
] as const;
