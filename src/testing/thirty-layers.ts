/**
 * A deterministic thirty-layer document, built with the editor's own commands.
 *
 * Phase 2 claims that editing a thirty-layer document stays responsive. Measuring that claim needs a
 * document that exercises the real render and edit path — text that wraps, graphics that must be
 * decoded, shapes with strokes and radii — rather than thirty identical rectangles. This module
 * builds one, once, and hands the same document to the unit tests and to the browser benchmark.
 *
 * Nothing here is a hand-written object literal: every layer is created by the same command the
 * toolbar runs (`addLayerCommand`, `placeAssetCommand`) and then moved, named and styled by the same
 * commands the inspector runs. A fixture built by bypassing the commands could be a shape the
 * editors can never produce, and the benchmark would then be measuring the wrong thing. The clock
 * and the id generator are injected, so the result is byte-identical on every run.
 *
 * It is test support only: the shipped application never imports this module.
 */

import { SAMPLE_ASSETS } from '../core/assets/data';
import { brand } from '../core/types/brand';
import { isPlaceable } from '../core/assets/types';
import type { AssetRecord } from '../core/assets/types';
import { applyDocumentPatch, createDocument, DEFAULT_CANVAS } from '../core/documents/factories';
import { createRect, type Rect } from '../core/documents/geometry';
import type { ImageSettings, ShapeSettings, TextSettings } from '../core/documents/layer-types';
import type { Canvas, ForgeDocument } from '../core/documents/types';
import {
  addLayerCommand,
  placeAssetCommand,
  renameLayerCommand,
  setImageSettingsCommand,
  setLayerFramesCommand,
  setLayersOpacityCommand,
  setShapeSettingsCommand,
  setTextSettingsCommand,
  type SceneCommand,
} from '../core/editor/commands';
import type { Result } from '../core/result';
import { sequentialLayerIds, TEST_DOCUMENT_TYPE } from './layers';

/** How many layers the responsiveness criterion names. */
export const RESPONSIVE_LAYER_COUNT = 30;

/**
 * The document id the fixture is saved under, so a browser spec can open it directly.
 *
 * `createDocument` takes a `DocumentIdGenerator`, which is how the workspace's own creation flow
 * injects the id it will persist under.
 */
export const THIRTY_LAYER_DOCUMENT_ID = brand<'DocumentId'>('doc-thirty-layers');

/** The canvas the fixture is laid out on: a square poster, the shape most of the samples use. */
export const THIRTY_LAYER_CANVAS: Canvas = {
  ...DEFAULT_CANVAS,
  width: 1080,
  height: 1080,
  dpi: 96,
};

/** A fixed moment, so two runs of the builder produce the same document. */
const FIXTURE_TIME = new Date('2026-02-01T12:00:00.000Z');

type TextEntry = {
  readonly kind: 'text';
  readonly name: string;
  readonly frame: Rect;
  readonly text: Partial<TextSettings>;
};

type ShapeEntry = {
  readonly kind: 'rect' | 'ellipse';
  readonly name: string;
  readonly frame: Rect;
  readonly shape?: Partial<ShapeSettings>;
};

type GraphicEntry = {
  readonly kind: 'graphic';
  readonly name: string;
  readonly frame: Rect;
  /** Index into the placeable catalogue records, in catalogue order. */
  readonly asset: number;
  readonly image?: Partial<ImageSettings>;
};

type Entry = (TextEntry | ShapeEntry | GraphicEntry) & {
  /** Defaults to fully opaque. */
  readonly opacity?: number;
};

/**
 * The picture, bottom layer first: bands, then cards and marks, then the decided-on-top content.
 *
 * Frames are laid out so layers overlap the way a real poster overlaps — text over bands, graphics
 * inside a strip — while keeping every layer's own area reachable, which is what lets the benchmark
 * grab a layer at a point that the hit test agrees belongs to it.
 */
const LAYOUT: readonly Entry[] = [
  {
    kind: 'rect',
    name: 'Header band',
    frame: createRect(0, 0, 1080, 210),
    shape: { fill: '#171a21' },
  },
  {
    kind: 'rect',
    name: 'Footer band',
    frame: createRect(0, 960, 1080, 120),
    shape: { fill: '#12141a' },
  },
  {
    kind: 'ellipse',
    name: 'Halo',
    frame: createRect(900, 60, 140, 140),
    shape: { fill: '#23303f' },
    opacity: 0.7,
  },
  {
    kind: 'rect',
    name: 'Card A',
    frame: createRect(450, 220, 580, 200),
    shape: { fill: '#1b1f27', stroke: '#2b3240', strokeWidth: 2, cornerRadius: 18 },
  },
  {
    kind: 'ellipse',
    name: 'Accent dot',
    frame: createRect(980, 20, 56, 56),
    shape: { fill: '#e2833a' },
  },
  {
    kind: 'rect',
    name: 'Panel',
    frame: createRect(450, 440, 580, 300),
    shape: { fill: '#151922', cornerRadius: 18 },
  },
  {
    kind: 'rect',
    name: 'Tile',
    frame: createRect(48, 340, 200, 200),
    shape: { fill: '#1d2530', cornerRadius: 10 },
  },
  {
    kind: 'rect',
    name: 'Divider',
    frame: createRect(48, 216, 380, 4),
    shape: { fill: '#e2833a', cornerRadius: 2 },
  },
  {
    kind: 'ellipse',
    name: 'Marker',
    frame: createRect(48, 460, 26, 26),
    shape: { fill: '#7dd3fc' },
  },
  {
    kind: 'rect',
    name: 'Badge plate',
    frame: createRect(740, 700, 280, 90),
    shape: { fill: '#e2833a', cornerRadius: 12 },
  },
  {
    kind: 'text',
    name: 'Headline',
    frame: createRect(48, 40, 700, 92),
    text: { content: 'Launch night: new work, live', fontSize: 64, fontWeight: 700 },
  },
  {
    kind: 'text',
    name: 'Subhead',
    frame: createRect(48, 140, 560, 64),
    text: {
      content: 'Two evenings of talks, screenings and workshops with the people who made it.',
      fontSize: 24,
      lineHeight: 1.3,
    },
  },
  {
    kind: 'text',
    name: 'Sponsors label',
    frame: createRect(48, 468, 240, 40),
    text: {
      content: 'Partners',
      fontSize: 18,
      fontWeight: 500,
      letterSpacing: 3,
      color: '#9aa4b2',
    },
  },
  {
    kind: 'text',
    name: 'Intro copy',
    frame: createRect(48, 240, 380, 190),
    text: {
      content:
        'Every project in this room started as a drawing on a wall. Come and see what it became, and meet the studios that kept going when the first draft did not work.',
      fontSize: 22,
      lineHeight: 1.45,
    },
  },
  {
    kind: 'text',
    name: 'Programme heading',
    frame: createRect(470, 240, 300, 48),
    text: { content: 'Programme', fontSize: 30, fontWeight: 600 },
  },
  {
    kind: 'text',
    name: 'Programme copy',
    frame: createRect(470, 300, 320, 170),
    text: {
      content:
        'Thursday: doors, first look, and a short talk from the studio floor. Friday: workshops in pairs, then the long table.',
      fontSize: 20,
      lineHeight: 1.4,
    },
  },
  {
    kind: 'text',
    name: 'Quote',
    frame: createRect(600, 480, 400, 130),
    text: {
      content: 'A whole evening of first looks, and nobody checking their phone.',
      fontSize: 26,
      lineHeight: 1.35,
      align: 'right',
    },
  },
  {
    kind: 'text',
    name: 'Badge label',
    frame: createRect(760, 723, 240, 44),
    text: { content: 'Free entry', fontSize: 22, align: 'center', color: '#12141a' },
  },
  {
    kind: 'text',
    name: 'Footer note',
    frame: createRect(600, 1000, 420, 34),
    text: {
      content: 'forge.example/launch',
      fontSize: 16,
      align: 'right',
      color: '#9aa4b2',
    },
  },
  {
    kind: 'text',
    name: 'Caption',
    frame: createRect(48, 1000, 420, 34),
    text: { content: 'Doors 19:00 · Studio 4', fontSize: 16, color: '#9aa4b2' },
  },
  ...graphicStrip(),
];

/** Ten placed catalogue graphics laid out as a two-row strip inside the logo panel. */
function graphicStrip(): readonly Entry[] {
  const placeable = placeableRecords();
  return placeable.slice(0, 10).map((record, index) => ({
    kind: 'graphic' as const,
    name: record.name,
    frame: createRect(60 + (index % 5) * 76, 512 + Math.floor(index / 5) * 56, 64, 48),
    asset: index,
  }));
}

/** The catalogue's placeable records, in catalogue order: what "place a graphic" can choose. */
export function placeableRecords(): readonly AssetRecord[] {
  const records = SAMPLE_ASSETS.filter((record) => isPlaceable(record));
  if (records.length < 10) {
    throw new Error(
      `the sample catalogue has ${String(records.length)} placeable records; the thirty-layer fixture needs 10`,
    );
  }
  return records;
}

/** Applies a command's patch, so the fixture moves through exactly the states a user would create. */
function apply(document: ForgeDocument, command: Result<SceneCommand>): ForgeDocument {
  if (!command.ok) {
    throw new Error(`the thirty-layer fixture command was refused: ${command.error.message}`);
  }
  return applyDocumentPatch(document, command.value.patch, FIXTURE_TIME);
}

function addEntry(document: ForgeDocument, entry: Entry, id: string): ForgeDocument {
  const next =
    entry.kind === 'graphic'
      ? apply(
          document,
          placeAssetCommand(
            document,
            placeableRecords()[entry.asset] as AssetRecord,
            () => id,
            FIXTURE_TIME.toISOString(),
          ),
        )
      : apply(
          document,
          addLayerCommand(document, entry.kind, () => id),
        );

  let current = apply(next, renameLayerCommand(next, id, entry.name));
  current = apply(
    current,
    setLayerFramesCommand(current, [{ id, frame: entry.frame }], `Place “${entry.name}”`),
  );

  if (entry.kind === 'text') {
    current = apply(current, setTextSettingsCommand(current, id, entry.text));
  } else if (entry.kind === 'graphic') {
    if (entry.image) current = apply(current, setImageSettingsCommand(current, id, entry.image));
  } else if (entry.shape) {
    current = apply(current, setShapeSettingsCommand(current, id, entry.shape));
  }

  if (entry.opacity !== undefined) {
    current = apply(current, setLayersOpacityCommand(current, [id], entry.opacity));
  }

  // The layer must exist under the name the fixture asked for, or every later lookup is a lie.
  const created = current.scene.layers.find((layer) => String(layer.id) === id);
  if (!created || created.name !== entry.name) {
    throw new Error(`the fixture could not create “${entry.name}”`);
  }
  return current;
}

/**
 * The thirty-layer document.
 *
 * Deterministic: fixed ids, a fixed clock, and a layout defined in this file. `createDocument` is
 * given a fixed id generator so the document id is stable too.
 */
export function thirtyLayerDocument(): ForgeDocument {
  const nextId = sequentialLayerIds('lyr-perf');
  const created = createDocument(
    {
      title: 'Launch night poster',
      studioId: 'design',
      documentTypeId: TEST_DOCUMENT_TYPE,
      canvas: { ...THIRTY_LAYER_CANVAS },
      tags: ['benchmark', 'thirty layers'],
    },
    { generateId: () => THIRTY_LAYER_DOCUMENT_ID, now: () => FIXTURE_TIME },
  );
  if (!created.ok) {
    throw new Error(`the thirty-layer fixture document is invalid: ${created.error.message}`);
  }

  let document = created.value;
  for (const entry of LAYOUT) {
    document = addEntry(document, entry, nextId());
  }

  if (document.scene.layers.length !== RESPONSIVE_LAYER_COUNT) {
    throw new Error(
      `the fixture holds ${String(document.scene.layers.length)} layers, not ${String(RESPONSIVE_LAYER_COUNT)}`,
    );
  }
  return document;
}
