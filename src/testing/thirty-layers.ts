/**
 * Test support: the deterministic thirty-layer document.
 *
 * The Phase 2 acceptance criterion is that editing a thirty-layer document stays responsive, and the
 * only honest way to check that is to drive a real one. This builder produces that document through
 * the *real editor commands* — the same `addLayerCommand`, `placeAssetCommand` and settings commands
 * the toolbar and inspector run — so the fixture cannot drift away from what the application can
 * actually create, and the graphics carry genuine catalogue attribution records.
 *
 * Everything is deterministic: fixed ids, a fixed clock, a fixed layout. Two runs of the browser
 * benchmark therefore measure the same picture.
 */

import { SAMPLE_ASSETS } from '../core/assets/data';
import { isPlaceable } from '../core/assets/types';
import { createRect, type Rect } from '../core/documents/geometry';
import {
  addLayerCommand,
  placeAssetCommand,
  renameLayerCommand,
  setImageSettingsCommand,
  setLayerFramesCommand,
  setLayersOpacityCommand,
  setShapeSettingsCommand,
  setTextSettingsCommand,
} from '../core/editor/commands';
import { createDocument, applyDocumentPatch, DEFAULT_CANVAS } from '../core/documents/factories';
import type { SceneCommand } from '../core/editor/commands';
import type { ImageSettings, ShapeSettings, TextSettings } from '../core/documents/layer-types';
import type { Canvas, ForgeDocument } from '../core/documents/types';
import type { Result } from '../core/result';
import { brand } from '../core/types/brand';

/** The number of layers the criterion names. */
export const RESPONSIVE_LAYER_COUNT = 30;

/** Every layer the fixture builds. Order is paint order: first entry is the bottom-most layer. */
export type FixtureLayer =
  | {
      readonly kind: 'text';
      readonly name: string;
      readonly frame: Rect;
      readonly text: Partial<TextSettings>;
    }
  | {
      readonly kind: 'rect' | 'ellipse';
      readonly name: string;
      readonly frame: Rect;
      readonly shape?: Partial<ShapeSettings>;
    }
  | {
      readonly kind: 'image';
      /** Index into the placeable catalogue records; the graphic and its licence come from there. */
      readonly assetIndex: number;
      readonly frame: Rect;
      readonly image?: Partial<ImageSettings>;
    };

function frame(x: number, y: number, width: number, height: number): Rect {
  return createRect(x, y, width, height);
}

/**
 * The fixture's composition: bands and panels underneath, ten placed catalogue graphics, and ten text
 * layers on top — the mix a real poster or thumbnail ends up with. Frames stay inside the 1080x1080
 * canvas, and every text layer wraps (or is short enough that it does not), exactly as the renderer
 * lays it out at run time.
 */
export const THIRTY_LAYER_LAYOUT: readonly FixtureLayer[] = [
  { kind: 'rect', name: 'Header band', frame: frame(0, 0, 1080, 210), shape: { fill: '#171a21' } },
  {
    kind: 'rect',
    name: 'Footer band',
    frame: frame(0, 960, 1080, 120),
    shape: { fill: '#12141a' },
  },
  { kind: 'ellipse', name: 'Halo', frame: frame(900, 60, 140, 140), shape: { fill: '#23303f' } },
  {
    kind: 'ellipse',
    name: 'Accent dot',
    frame: frame(980, 20, 56, 56),
    shape: { fill: '#e2833a' },
  },
  { kind: 'rect', name: 'Divider', frame: frame(48, 216, 380, 4), shape: { fill: '#e2833a' } },
  {
    kind: 'rect',
    name: 'Card',
    frame: frame(450, 220, 580, 200),
    shape: { fill: '#1b1f27', stroke: '#2b3240', strokeWidth: 2, cornerRadius: 18 },
  },
  {
    kind: 'rect',
    name: 'Panel',
    frame: frame(450, 440, 580, 300),
    shape: { fill: '#151922', cornerRadius: 18 },
  },
  {
    kind: 'rect',
    name: 'Badge plate',
    frame: frame(740, 680, 280, 90),
    shape: { fill: '#e2833a', cornerRadius: 12 },
  },
  {
    kind: 'rect',
    name: 'Logo strip',
    frame: frame(48, 500, 380, 130),
    shape: { fill: null, stroke: '#2b3240', strokeWidth: 2, cornerRadius: 10 },
  },
  { kind: 'ellipse', name: 'Marker', frame: frame(48, 460, 26, 26), shape: { fill: '#7dd3fc' } },
  ...Array.from({ length: 10 }, (_, index): FixtureLayer => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    return {
      kind: 'image',
      assetIndex: index,
      frame: frame(60 + column * 74, 512 + row * 58, 64, 48),
      ...(index === 3 ? { image: { fit: 'cover' as const } } : {}),
      ...(index === 7 ? { image: { tint: '#e2833a' as const } } : {}),
    };
  }),
  {
    kind: 'text',
    name: 'Headline',
    frame: frame(48, 40, 620, 88),
    text: { content: 'Launch night: new work, live', fontSize: 64, fontWeight: 700 },
  },
  {
    kind: 'text',
    name: 'Subhead',
    frame: frame(48, 136, 520, 62),
    text: { content: 'Two nights of talks, screenings and workshops.', fontSize: 24 },
  },
  {
    kind: 'text',
    name: 'Intro copy',
    frame: frame(48, 240, 380, 180),
    text: {
      content:
        'Doors open at seven, and the first session starts on the hour. Everything shown tonight was made in the studio this season, from the first sketches to the final exports.',
      fontSize: 22,
      lineHeight: 1.4,
    },
  },
  {
    kind: 'text',
    name: 'Sponsors label',
    frame: frame(48, 640, 300, 40),
    text: { content: 'SPONSORS', fontSize: 18, letterSpacing: 3, color: '#9aa4b2' },
  },
  {
    kind: 'text',
    name: 'Programme heading',
    frame: frame(470, 240, 260, 48),
    text: { content: 'Programme', fontSize: 30, fontWeight: 600 },
  },
  {
    kind: 'text',
    name: 'Programme copy',
    frame: frame(470, 296, 320, 150),
    text: {
      content: '19:00 doors. 19:30 first look. 20:15 a conversation with the makers.',
      fontSize: 20,
      lineHeight: 1.5,
    },
  },
  {
    kind: 'text',
    name: 'Quote',
    frame: frame(600, 460, 400, 120),
    text: {
      content: 'A whole evening of first looks, and every piece started in this workspace.',
      fontSize: 26,
      align: 'right',
    },
  },
  {
    kind: 'text',
    name: 'Badge label',
    frame: frame(760, 700, 240, 44),
    text: { content: 'Free entry', fontSize: 22, align: 'center', color: '#1b1f27' },
  },
  {
    kind: 'text',
    name: 'Caption',
    frame: frame(48, 1000, 460, 32),
    text: { content: 'forge.example/launch · doors 19:00', fontSize: 16 },
  },
  {
    kind: 'text',
    name: 'Footer note',
    frame: frame(600, 1000, 420, 32),
    text: { content: "Made with Euler's Forge", fontSize: 16, align: 'right' },
  },
];

export type ThirtyLayerOptions = {
  readonly canvas?: Canvas;
  readonly title?: string;
  /** Clock used for `updatedAt` and the attribution `placedAt` values. */
  readonly now?: () => Date;
};

/**
 * Builds the thirty-layer document.
 *
 * Throws when a command refuses: a fixture that could not be created would otherwise make the
 * benchmark measure a smaller document than it claims.
 */
export function thirtyLayerDocument(options: ThirtyLayerOptions = {}): ForgeDocument {
  const now = options.now ?? (() => new Date('2026-02-01T12:00:00.000Z'));
  const created = createDocument(
    {
      title: options.title ?? 'Thirty layer stress document',
      studioId: 'design',
      documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
      canvas: options.canvas ?? DEFAULT_CANVAS,
    },
    { generateId: () => 'doc-thirty-layers', now },
  );
  if (!created.ok) throw new Error(`thirty-layer document is invalid: ${created.error.message}`);

  const placeable = SAMPLE_ASSETS.filter((record) => isPlaceable(record));
  const graphics = THIRTY_LAYER_LAYOUT.filter((layer) => layer.kind === 'image');
  if (placeable.length < graphics.length) {
    throw new Error(
      `the catalogue offers ${String(placeable.length)} placeable graphics, the fixture needs ${String(graphics.length)}`,
    );
  }

  let counter = 0;
  const generateId = (): string => {
    counter += 1;
    return `lyr-perf-${String(counter)}`;
  };

  let document = created.value;
  const errors: string[] = [];

  const apply = (command: Result<SceneCommand>, what: string): void => {
    if (!command.ok) {
      errors.push(`${what}: ${command.error.message}`);
      return;
    }
    document = applyDocumentPatch(document, command.value.patch, now());
  };

  /** The layer a command just added: `addNewLayer` puts it on top, so it is the last one. */
  const topLayerId = (): string => {
    const layer = document.scene.layers[document.scene.layers.length - 1];
    if (!layer) throw new Error('the fixture added no layer');
    return String(layer.id);
  };

  for (const [index, spec] of THIRTY_LAYER_LAYOUT.entries()) {
    const where = `layer ${String(index + 1)}`;
    if (spec.kind === 'image') {
      const record = placeable[spec.assetIndex];
      if (!record)
        throw new Error(`${where}: no catalogue record at index ${String(spec.assetIndex)}`);
      apply(placeAssetCommand(document, record, generateId, now().toISOString()), `${where} place`);
    } else {
      apply(addLayerCommand(document, spec.kind, generateId), `${where} add`);
    }

    const id = topLayerId();
    // Placed graphics keep the catalogue name, so the layer tree and every history label name the
    // graphic a person chose (that is what `placeAssetCommand` does in the application).
    if (spec.kind !== 'image') {
      apply(renameLayerCommand(document, id, spec.name), `${where} rename`);
    }
    apply(setLayerFramesCommand(document, [{ id, frame: spec.frame }], 'Fixture placement'), where);

    if (spec.kind === 'text') {
      apply(setTextSettingsCommand(document, id, spec.text), `${where} typography`);
    } else if (spec.kind === 'image') {
      if (spec.image) apply(setImageSettingsCommand(document, id, spec.image), `${where} graphic`);
    } else if (spec.shape) {
      apply(setShapeSettingsCommand(document, id, spec.shape), `${where} shape`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`the thirty-layer fixture could not be built:\n${errors.join('\n')}`);
  }
  if (document.scene.layers.length !== RESPONSIVE_LAYER_COUNT) {
    throw new Error(
      `the fixture built ${String(document.scene.layers.length)} layers, not ${String(RESPONSIVE_LAYER_COUNT)}`,
    );
  }
  return document;
}

/** Layers of one kind in the fixture, for assertions that it is a realistic mix. */
export function fixtureLayerCounts(document: ForgeDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const layer of document.scene.layers) {
    counts[layer.type] = (counts[layer.type] ?? 0) + 1;
  }
  return counts;
}

/** Applies an opacity to a named fixture layer; used by specs that need a starting value. */
export function withOpacity(document: ForgeDocument, name: string, opacity: number): ForgeDocument {
  const layer = document.scene.layers.find((candidate) => candidate.name === name);
  if (!layer) throw new Error(`no fixture layer named ${name}`);
  const command = setLayersOpacityCommand(document, [layer.id], opacity);
  if (!command.ok) throw new Error(command.error.message);
  return applyDocumentPatch(document, command.value.patch);
}
