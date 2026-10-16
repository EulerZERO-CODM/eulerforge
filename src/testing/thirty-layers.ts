/**
 * A thirty-layer document for the responsiveness measurements, built by the editor's own commands.
 *
 * The Phase 2 exit criterion is about editing a document with thirty layers, so the document used to
 * check it has to be one a person could really have made: the same `createDocument` the creation flow
 * calls, then `addLayerCommand`, `placeAssetCommand`, `renameLayerCommand`, `setLayerFrameCommand`,
 * `setTextSettingsCommand`, `setShapeSettingsCommand` and `setImageSettingsCommand` — the exact
 * commands the toolbar and the inspector run. Nothing is written into the document by hand, so the
 * fixture cannot describe a shape the product could not produce.
 *
 * It is also deterministic: fixed ids, a fixed `placedAt` for every licence record and a fixed
 * `updatedAt`, so two builds are byte-identical and two benchmark runs describe the same picture.
 * `.test.ts` beside this file asserts all of that, and that the document renders without a single
 * render issue (no empty shape, no text overflowing its box, every graphic resolvable).
 *
 * The composition is a real social post at 1600 x 1100: a header band, a strip of ten placed
 * catalogue records, a content card holding two columns of wrapped copy, and a footer row. Its
 * thirty layers are ten text layers, ten placed catalogue records (the seven graphics and three
 * textures the repository ships files for, each with its licence record) and ten shapes — seven
 * rectangles and three ellipses.
 */

import { SAMPLE_ASSETS } from '../core/assets/data';
import { isPlaceable, type AssetRecord } from '../core/assets/types';
import { applyDocumentPatch, createDocument } from '../core/documents/factories';
import { createRect, type Rect } from '../core/documents/geometry';
import type { ImageFit, TextSettings } from '../core/documents/layer-types';
import type { Canvas, ForgeDocument } from '../core/documents/types';
import {
  addLayerCommand,
  placeAssetCommand,
  renameLayerCommand,
  setImageSettingsCommand,
  setLayerFrameCommand,
  setShapeSettingsCommand,
  setTextSettingsCommand,
  type SceneCommand,
} from '../core/editor/commands';
import type { Result } from '../core/result';
import { sequentialLayerIds, TEST_DOCUMENT_TYPE } from './layers';

/** The document id the benchmark opens, so a spec and the fixture cannot drift apart. */
export const THIRTY_LAYER_DOCUMENT_ID = 'doc-thirty-layers';

/** Poster-sized, because that is where thirty layers stop being trivially cheap. */
export const THIRTY_LAYER_CANVAS: Canvas = {
  width: 1600,
  height: 1100,
  unit: 'px',
  dpi: 96,
  background: '#0f1115',
  transparent: false,
};

/** Everything the benchmark asserts about the fixture's shape, so the numbers have a fixed meaning. */
export const THIRTY_LAYER_COUNTS = { rect: 7, ellipse: 3, text: 10, image: 10 } as const;

export const THIRTY_LAYER_TOTAL =
  THIRTY_LAYER_COUNTS.rect +
  THIRTY_LAYER_COUNTS.ellipse +
  THIRTY_LAYER_COUNTS.text +
  THIRTY_LAYER_COUNTS.image;

/** A fixed instant: the fixture must not change between two runs. */
const NOW = new Date('2026-03-01T09:00:00.000Z');
const PLACED_AT = '2026-03-01T09:00:00.000Z';

/** Ink and paper for the composition, so the layers look like a poster rather than a grey box. */
const INK = {
  card: '#171b23',
  band: '#141821',
  plate: '#1d2230',
  rule: '#2b5fd9',
  accent: '#f97362',
  amber: '#ffd166',
  paper: '#f4f6fb',
  muted: '#b9c2d4',
} as const;

type ShapePlan = {
  readonly kind: 'rect' | 'ellipse';
  readonly name: string;
  readonly frame: Rect;
  readonly fill: string;
  readonly cornerRadius?: number;
  readonly stroke?: string;
  readonly strokeWidth?: number;
};

type TextPlan = {
  readonly kind: 'text';
  readonly name: string;
  readonly frame: Rect;
  readonly text: Partial<TextSettings> & { readonly content: string };
};

type ImagePlan = {
  readonly kind: 'image';
  readonly name: string;
  readonly frame: Rect;
  readonly fit?: ImageFit;
  readonly tint?: string;
};

type Plan = ShapePlan | TextPlan | ImagePlan;

/**
 * The layout, bottom-most layer first.
 *
 * Shapes come first so the band, the card and the plates sit behind everything; then the graphics,
 * then the copy on top. Text frames are sized to their copy: a paragraph that overflowed its box
 * would be clipped in the product, which is a different document from the one this claims to be.
 */
const PLAN: readonly Plan[] = [
  // Header band, content card, plates, rules and accents: the shapes.
  {
    kind: 'rect',
    name: 'Header band',
    frame: createRect(0, 0, 1600, 150),
    fill: INK.band,
  },
  {
    kind: 'rect',
    name: 'Content card',
    frame: createRect(80, 470, 1440, 530),
    fill: INK.card,
    cornerRadius: 18,
  },
  {
    kind: 'ellipse',
    name: 'Accent dot',
    frame: createRect(1480, 34, 64, 64),
    fill: INK.accent,
  },
  {
    kind: 'rect',
    name: 'Plate A',
    frame: createRect(80, 170, 290, 270),
    fill: INK.plate,
    cornerRadius: 16,
  },
  {
    kind: 'rect',
    name: 'Plate B',
    frame: createRect(370, 170, 290, 270),
    fill: INK.plate,
    cornerRadius: 16,
  },
  {
    kind: 'rect',
    name: 'Plate C',
    frame: createRect(660, 170, 290, 270),
    fill: INK.plate,
    cornerRadius: 16,
  },
  {
    kind: 'rect',
    name: 'Plate D',
    frame: createRect(950, 170, 290, 270),
    fill: INK.plate,
    cornerRadius: 16,
  },
  {
    kind: 'ellipse',
    name: 'Plate E',
    frame: createRect(1240, 170, 290, 270),
    fill: INK.plate,
  },
  {
    kind: 'rect',
    name: 'Rule line',
    frame: createRect(80, 470, 1440, 6),
    fill: INK.rule,
  },
  {
    kind: 'ellipse',
    name: 'Footer stamp',
    frame: createRect(1442, 980, 60, 44),
    fill: INK.amber,
    stroke: INK.card,
    strokeWidth: 3,
  },

  // Ten placed catalogue records: the repository's own sample files, two rows of five.
  ...stripPlans(),

  // Ten text layers: the poster's copy, in the header and in two columns inside the card.
  {
    kind: 'text',
    name: 'Headline',
    frame: createRect(120, 38, 900, 72),
    text: { content: 'Autumn Programme 2026', fontSize: 48, fontWeight: 800, color: INK.paper },
  },
  {
    kind: 'text',
    name: 'Dateline',
    frame: createRect(980, 56, 440, 46),
    text: {
      content: 'Sept 14 – Nov 30',
      fontSize: 20,
      fontWeight: 500,
      align: 'right',
      color: INK.muted,
    },
  },
  {
    kind: 'text',
    name: 'Section heading',
    frame: createRect(120, 505, 620, 48),
    text: { content: 'Programme', fontSize: 30, fontWeight: 700, color: INK.paper },
  },
  {
    kind: 'text',
    name: 'Intro copy',
    frame: createRect(120, 570, 620, 240),
    text: {
      content:
        'Ten weeks of print, motion and type. Every session runs twice, once in the studio and once over video, so nobody has to choose between being in the room and getting the work finished.',
      fontSize: 17,
      lineHeight: 1.55,
      color: INK.muted,
    },
  },
  {
    kind: 'text',
    name: 'Offer line',
    frame: createRect(120, 830, 620, 48),
    text: {
      content: 'Doors 19:00 · Studio 4 · £12',
      fontSize: 20,
      fontWeight: 600,
      color: INK.paper,
    },
  },
  {
    kind: 'text',
    name: 'Notes',
    frame: createRect(120, 890, 620, 90),
    text: {
      content:
        'Tickets include materials and a printed riso zine. Concessions are available at the door.',
      fontSize: 15,
      lineHeight: 1.5,
      color: INK.muted,
    },
  },
  {
    kind: 'text',
    name: 'Schedule heading',
    frame: createRect(800, 505, 680, 48),
    text: { content: 'Schedule', fontSize: 30, fontWeight: 700, color: INK.paper },
  },
  {
    kind: 'text',
    name: 'Schedule copy',
    frame: createRect(800, 570, 680, 240),
    text: {
      content:
        'Sep 14 · Type as texture\nSep 21 · Colour separations\nSep 28 · Motion tests\nOct 05 · Print week\nOct 12 · Review and binding',
      fontSize: 17,
      lineHeight: 1.6,
      color: INK.muted,
    },
  },
  {
    kind: 'text',
    name: 'Quote',
    frame: createRect(800, 830, 680, 110),
    text: {
      content: '“The first week redrew how I think about a page.”',
      fontSize: 26,
      fontWeight: 600,
      color: INK.paper,
    },
  },
  {
    kind: 'text',
    name: 'Footer note',
    frame: createRect(800, 950, 680, 44),
    text: {
      content: 'Booking closes Sept 8',
      fontSize: 15,
      letterSpacing: 0.4,
      align: 'right',
      color: INK.muted,
    },
  },
];

/** The ten placed catalogue records, laid out in two rows of five inside the plates. */
function stripPlans(): readonly ImagePlan[] {
  const records = catalogueFiles();
  return records.map((record, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    return {
      kind: 'image',
      name: record.name,
      frame: createRect(100 + column * 290, 190 + row * 120, 250, 100),
      fit: index % 2 === 0 ? 'cover' : 'contain',
    };
  });
}

/**
 * The catalogue records that ship a file, in catalogue order.
 *
 * Seven of the ten are graphics and three are textures; all ten are placeable as image layers, and
 * using the whole file-backed set keeps the fixture honest about what the repository actually
 * contains. A catalogue that lost its files fails loudly here rather than producing a document full
 * of broken images.
 */
export function catalogueFiles(): readonly AssetRecord[] {
  const placeable = SAMPLE_ASSETS.filter((record) => isPlaceable(record));
  if (placeable.length < THIRTY_LAYER_COUNTS.image) {
    throw new Error(
      `the catalogue ships ${String(placeable.length)} placeable records, but the fixture needs ${String(THIRTY_LAYER_COUNTS.image)}`,
    );
  }
  return placeable.slice(0, THIRTY_LAYER_COUNTS.image);
}

function applied(
  document: ForgeDocument,
  command: Result<SceneCommand>,
  what: string,
): ForgeDocument {
  if (!command.ok) {
    throw new Error(`${what} was refused while building the fixture: ${command.error.message}`);
  }
  return applyDocumentPatch(document, command.value.patch, NOW);
}

/** Builds the document. Pure: no storage, no DOM, no clock. */
export function thirtyLayerDocument(): ForgeDocument {
  const created = createDocument(
    {
      title: 'Autumn programme — thirty layers',
      studioId: 'design',
      documentTypeId: TEST_DOCUMENT_TYPE,
      canvas: { ...THIRTY_LAYER_CANVAS },
    },
    // A fixed clock as well as fixed ids: `createdAt` is part of the document, so a real clock
    // would make two builds differ.
    { generateId: () => THIRTY_LAYER_DOCUMENT_ID, now: () => NOW },
  );
  if (!created.ok) throw new Error(`the thirty-layer fixture is invalid: ${created.error.message}`);

  const ids = sequentialLayerIds('lyr-30');
  const graphics = catalogueFiles();
  let document = created.value;
  let nextGraphic = 0;

  for (const plan of PLAN) {
    if (plan.kind === 'image') {
      const record = graphics[nextGraphic];
      nextGraphic += 1;
      if (!record) throw new Error('the fixture ran out of catalogue records');
      document = applied(
        document,
        placeAssetCommand(document, record, ids, PLACED_AT),
        `placing “${record.name}”`,
      );
    } else {
      document = applied(
        document,
        addLayerCommand(document, plan.kind, ids),
        `adding a ${plan.kind}`,
      );
    }

    const id = document.scene.layers[document.scene.layers.length - 1]?.id;
    if (id === undefined) throw new Error('a layer should have been added');

    document = applied(
      document,
      renameLayerCommand(document, id, plan.name),
      `renaming a layer to “${plan.name}”`,
    );
    document = applied(
      document,
      setLayerFrameCommand(document, id, plan.frame, `Place “${plan.name}”`),
      `framing “${plan.name}”`,
    );

    if (plan.kind === 'text') {
      document = applied(
        document,
        setTextSettingsCommand(document, id, plan.text),
        `styling “${plan.name}”`,
      );
    } else if (plan.kind === 'image') {
      document = applied(
        document,
        setImageSettingsCommand(document, id, {
          ...(plan.fit === undefined ? {} : { fit: plan.fit }),
          ...(plan.tint === undefined ? {} : { tint: plan.tint }),
        }),
        `fitting “${plan.name}”`,
      );
    } else {
      document = applied(
        document,
        setShapeSettingsCommand(document, id, {
          fill: plan.fill,
          ...(plan.cornerRadius === undefined ? {} : { cornerRadius: plan.cornerRadius }),
          ...(plan.stroke === undefined ? {} : { stroke: plan.stroke }),
          ...(plan.strokeWidth === undefined ? {} : { strokeWidth: plan.strokeWidth }),
        }),
        `styling “${plan.name}”`,
      );
    }
  }

  return document;
}
