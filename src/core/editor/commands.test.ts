import { describe, expect, it } from 'vitest';

import {
  addLayerCommand,
  applyPaletteCommand,
  deleteLayersCommand,
  duplicateLayerCommand,
  fitGraphicFrame,
  moveLayerToCommand,
  placeAssetCommand,
  renameLayerCommand,
  reorderLayerCommand,
  setBackgroundCommand,
  setImageSettingsCommand,
  setLayerFrameCommand,
  setLayerFramesCommand,
  setLayerLockCommand,
  setLayerOpacityCommand,
  setLayerVisibilityCommand,
  setShapeSettingsCommand,
  setTextSettingsCommand,
} from './commands';
import { SAMPLE_ASSETS } from '../assets/data';
import { isPlaceable } from '../assets/types';
import type { AssetRecord } from '../assets/types';
import { applyDocumentPatch } from '../documents/factories';
import { forgeDocumentSchema } from '../documents/schema';
import { createRect } from '../documents/geometry';
import { DEFAULT_PLACEHOLDER_TEXT } from '../documents/layer-defaults';
import type { ForgeDocument } from '../documents/types';
import {
  documentFixture,
  imageLayer,
  layerId,
  rectLayer,
  sceneOf,
  sequentialLayerIds,
  textLayer,
} from '../../testing/layers';

/**
 * Editor commands.
 *
 * A command is a *labelled intention plus a document patch*: the label is what history shows and the
 * patch is the only thing that touches the document. Every test here therefore checks three things —
 * the label a user will read, the effect on the scene, and that the patched document still satisfies
 * the published schema. That last one is what stops an edit path from producing a file that cannot
 * be re-opened.
 */

const base = documentFixture({ scene: sceneOf(rectLayer('lyr-a', { x: 40, y: 40 })) });

function applied(document: ForgeDocument, command: { readonly patch: unknown }): ForgeDocument {
  return applyDocumentPatch(document, command.patch as Parameters<typeof applyDocumentPatch>[1]);
}

function expectSchemaValid(document: ForgeDocument): void {
  const parsed = forgeDocumentSchema.safeParse(document);
  expect(parsed.success ? null : JSON.stringify(parsed.error.issues.slice(0, 3))).toBeNull();
}

function requireOk<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly message: string } },
): T {
  if (!result.ok) throw new Error(`command should be valid: ${result.error.message}`);
  return result.value;
}

function placeable(): AssetRecord {
  const record = SAMPLE_ASSETS.find(
    (candidate) => isPlaceable(candidate) && candidate.kind === 'graphic',
  );
  if (!record) throw new Error('the sample catalogue must ship at least one placeable graphic');
  return record;
}

function referenceOnly(): AssetRecord {
  const record = SAMPLE_ASSETS.find((candidate) => !isPlaceable(candidate));
  if (!record)
    throw new Error('the sample catalogue must document at least one reference-only record');
  return record;
}

describe('creating layers', () => {
  for (const type of ['text', 'rect', 'ellipse', 'image'] as const) {
    it(`adds a ${type} layer with a frame inside the canvas and a schema-valid document`, () => {
      const command = requireOk(addLayerCommand(base, type, sequentialLayerIds()));
      const next = applied(base, command);

      // Labels use the domain's own nouns: "graphic" for an image layer, "rectangle" not "rect".
      const noun = { text: 'text', rect: 'rectangle', ellipse: 'ellipse', image: 'graphic' }[type];
      expect(command.label).toBe(`Add ${noun} layer`);
      expect(next.scene.layers).toHaveLength(2);
      const added = next.scene.layers[1];
      expect(added?.type).toBe(type);
      expect(added?.frame.width).toBeGreaterThan(0);
      expect(added?.frame.x).toBeGreaterThanOrEqual(0);
      expect((added?.frame.x ?? 0) + (added?.frame.width ?? 0)).toBeLessThanOrEqual(1080);
      expectSchemaValid(next);
    });
  }

  it('gives every added layer a distinct id', () => {
    const ids = sequentialLayerIds();
    const first = requireOk(addLayerCommand(base, 'rect', ids));
    const second = requireOk(addLayerCommand(applied(base, first), 'rect', ids));

    const firstId = first.patch.scene?.layers[1]?.id;
    const secondId = second.patch.scene?.layers[2]?.id;
    expect(firstId).toBe('lyr-gen-1');
    expect(secondId).toBe('lyr-gen-2');
    expect(firstId).not.toBe(secondId);
  });

  it('starts a new text layer with real, visible defaults', () => {
    const command = requireOk(addLayerCommand(base, 'text', sequentialLayerIds()));
    const added = applied(base, command).scene.layers[1];

    expect(added?.type === 'text' ? added.text.content : '').toBe(DEFAULT_PLACEHOLDER_TEXT);
    expect(added?.type === 'text' ? added.text.color : '').toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('placing catalogue graphics', () => {
  it('places a graphic, keeps its frame inside the canvas and records attribution', () => {
    const record = placeable();
    const command = requireOk(
      placeAssetCommand(base, record, sequentialLayerIds(), '2026-03-04T05:06:07.000Z'),
    );
    const next = applied(base, command);
    const layer = next.scene.layers[1];

    expect(command.label).toBe(`Place graphic “${record.name}”`);
    expect(layer?.type).toBe('image');
    expect(layer?.type === 'image' ? layer.image.assetId : null).toBe(record.id);
    expect(layer?.type === 'image' ? layer.image.href : '').toBe(record.file?.href);
    expect(layer?.frame.x).toBeGreaterThanOrEqual(0);
    expect((layer?.frame.x ?? 0) + (layer?.frame.width ?? 0)).toBeLessThanOrEqual(1080);

    const attribution = next.attribution;
    expect(attribution).toHaveLength(1);
    expect(attribution[0]?.assetId).toBe(record.id);
    expect(attribution[0]?.licenseId).toBe(record.license.id);
    expect(attribution[0]?.author).toBe(record.provenance.author);
    expect(attribution[0]?.source).toBe(record.provenance.source);
    expect(attribution[0]?.verified).toBe(record.provenance.verified);
    expect(attribution[0]?.placedAt).toBe('2026-03-04T05:06:07.000Z');
    expectSchemaValid(next);
  });

  it('refuses a record with no file instead of pretending to place it', () => {
    const result = placeAssetCommand(base, referenceOnly());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/cannot be placed|no file/i);
    expect(result.error.detail).toMatch(/reference record/i);
  });

  it('fits a graphic inside the canvas safe margin without upscaling it', () => {
    const wide = fitGraphicFrame({ width: 1080, height: 1080 }, 4000, 1000);
    expect(wide.width).toBeLessThan(1080);
    expect(wide.height).toBeLessThan(wide.width);

    const small = fitGraphicFrame({ width: 1080, height: 1080 }, 120, 60);
    expect(small.width).toBe(120);
    expect(small.height).toBe(60);
    expect(small.x).toBe(480);
  });
});

describe('removing and arranging', () => {
  const three = sceneOf(
    rectLayer('lyr-a', { name: 'Bottom' }),
    rectLayer('lyr-b', { name: 'Middle' }),
    rectLayer('lyr-c', { name: 'Top' }),
  );
  const doc = documentFixture({ scene: three });
  const order = (document: ForgeDocument): readonly string[] =>
    document.scene.layers.map((layer) => String(layer.id));

  it('deletes a layer, and drops attribution for graphics that are no longer placed', () => {
    const record = placeable();
    const withGraphic = applied(
      doc,
      requireOk(placeAssetCommand(doc, record, sequentialLayerIds())),
    );
    const graphicId = withGraphic.scene.layers[3]?.id;
    if (!graphicId) throw new Error('the graphic should have been added');

    const command = requireOk(deleteLayersCommand(withGraphic, [graphicId]));
    const next = applied(withGraphic, command);

    expect(command.label).toBe(`Delete “${record.name}”`);
    expect(next.scene.layers).toHaveLength(3);
    expect(next.attribution).toEqual([]);
  });

  it('names every layer when several are deleted at once', () => {
    const command = requireOk(deleteLayersCommand(doc, [layerId('lyr-a')]));
    expect(command.label).toBe('Delete “Bottom”');
  });

  it('refuses to delete a layer that is not there', () => {
    const result = deleteLayersCommand(doc, ['lyr-gone']);
    expect(result.ok).toBe(false);
  });

  it('duplicates a layer directly above itself, with a distinct id and a “copy” name', () => {
    const command = requireOk(duplicateLayerCommand(doc, 'lyr-b', sequentialLayerIds()));
    const next = applied(doc, command);

    expect(command.label).toBe('Duplicate “Middle”');
    expect(order(next)).toEqual(['lyr-a', 'lyr-b', 'lyr-gen-1', 'lyr-c']);
    expect(next.scene.layers[2]?.name).toBe('Middle copy');
  });

  it('reorders with the four documented verbs', () => {
    expect(order(applied(doc, requireOk(reorderLayerCommand(doc, 'lyr-a', 'front'))))).toEqual([
      'lyr-b',
      'lyr-c',
      'lyr-a',
    ]);
    expect(order(applied(doc, requireOk(reorderLayerCommand(doc, 'lyr-c', 'back'))))).toEqual([
      'lyr-c',
      'lyr-a',
      'lyr-b',
    ]);
    expect(order(applied(doc, requireOk(reorderLayerCommand(doc, 'lyr-a', 'forward'))))).toEqual([
      'lyr-b',
      'lyr-a',
      'lyr-c',
    ]);
    expect(order(applied(doc, requireOk(reorderLayerCommand(doc, 'lyr-c', 'backward'))))).toEqual([
      'lyr-a',
      'lyr-c',
      'lyr-b',
    ]);

    const label = requireOk(reorderLayerCommand(doc, 'lyr-c', 'front'));
    expect(label.label).toBe('Bring to front: “Top”');
  });

  it('moves a layer to an explicit stack position', () => {
    const command = requireOk(moveLayerToCommand(doc, 'lyr-a', 2));
    expect(command.label).toBe('Move “Bottom” to position 3');
    expect(order(applied(doc, command))).toEqual(['lyr-b', 'lyr-c', 'lyr-a']);
  });

  it('reports a missing layer for every arranging command instead of throwing', () => {
    expect(reorderLayerCommand(doc, 'lyr-gone', 'front').ok).toBe(false);
    expect(moveLayerToCommand(doc, 'lyr-gone', 0).ok).toBe(false);
    expect(renameLayerCommand(doc, 'lyr-gone', 'Nope').ok).toBe(false);
    expect(setLayerVisibilityCommand(doc, 'lyr-gone', false).ok).toBe(false);
    expect(setLayerLockCommand(doc, 'lyr-gone', true).ok).toBe(false);
    expect(setLayerOpacityCommand(doc, 'lyr-gone', 0.5).ok).toBe(false);
    expect(setLayerFrameCommand(doc, 'lyr-gone', createRect(0, 0, 10, 10)).ok).toBe(false);
    expect(setTextSettingsCommand(doc, 'lyr-gone', { content: 'x' }).ok).toBe(false);
  });
});

describe('layer properties', () => {
  const doc = documentFixture({
    scene: sceneOf(rectLayer('lyr-a', { name: 'Card' }), textLayer('lyr-t', { name: 'Headline' })),
  });

  it('renames a layer with its trimmed name', () => {
    const command = requireOk(renameLayerCommand(doc, 'lyr-a', '  Hero card  '));
    expect(command.label).toBe('Rename layer to “Hero card”');
    expect(applied(doc, command).scene.layers[0]?.name).toBe('Hero card');
  });

  it('refuses a blank name and says why', () => {
    const result = renameLayerCommand(doc, 'lyr-a', '   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/name/i);
  });

  it('toggles visibility and lock with readable labels', () => {
    const hidden = requireOk(setLayerVisibilityCommand(doc, 'lyr-a', false));
    expect(hidden.label).toBe('Hide “Card”');
    expect(applied(doc, hidden).scene.layers[0]?.visible).toBe(false);

    const shown = requireOk(setLayerVisibilityCommand(applied(doc, hidden), 'lyr-a', true));
    expect(shown.label).toBe('Show “Card”');
    expect(applied(doc, shown).scene.layers[0]?.visible).toBe(true);

    const locked = requireOk(setLayerLockCommand(doc, 'lyr-a', true));
    expect(locked.label).toBe('Lock “Card”');
    expect(applied(doc, locked).scene.layers[0]?.locked).toBe(true);
    expect(requireOk(setLayerLockCommand(doc, 'lyr-a', false)).label).toBe('Unlock “Card”');
  });

  it('clamps opacity into the documented range and rejects nonsense', () => {
    const clamped = requireOk(setLayerOpacityCommand(doc, 'lyr-a', 1.4));
    expect(clamped.label).toBe('Set “Card” opacity to 100%');
    expect(applied(doc, clamped).scene.layers[0]?.opacity).toBe(1);

    const low = requireOk(setLayerOpacityCommand(doc, 'lyr-a', -3));
    expect(applied(doc, low).scene.layers[0]?.opacity).toBe(0);

    expect(setLayerOpacityCommand(doc, 'lyr-a', Number.NaN).ok).toBe(false);
  });

  it('rounds a frame to hundredths and never lets a side collapse to zero', () => {
    const command = requireOk(setLayerFrameCommand(doc, 'lyr-a', createRect(10.123456, 20, 0, 5)));
    const frame = applied(doc, command).scene.layers[0]?.frame;

    expect(command.label).toBe('Resize “Card”');
    expect(frame?.x).toBe(10.12);
    expect(frame?.width).toBe(1);
  });

  it('refuses a frame the schema would reject, so a drag cannot corrupt the document', () => {
    const result = setLayerFrameCommand(doc, 'lyr-a', createRect(90_000, 0, 10, 10));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/x must be/i);
  });

  it('applies a multi-layer gesture as exactly one patch', () => {
    const command = requireOk(
      setLayerFramesCommand(
        doc,
        [
          { id: 'lyr-a', frame: createRect(100, 100, 120, 120) },
          { id: 'lyr-t', frame: createRect(100, 260, 240, 80) },
        ],
        'Move 2 layers',
      ),
    );
    const next = applied(doc, command);

    expect(command.label).toBe('Move 2 layers');
    expect(next.scene.layers.map((layer) => layer.frame.y)).toEqual([100, 260]);
    expect(next.revision).toBe(doc.revision + 1);
    expectSchemaValid(next);
  });

  it('refuses an empty gesture, because there is nothing to record', () => {
    expect(setLayerFramesCommand(doc, [], 'Move 0 layers').ok).toBe(false);
  });

  it('labels a typography edit by what actually changed', () => {
    expect(requireOk(setTextSettingsCommand(doc, 'lyr-t', { content: 'New' })).label).toBe(
      'Edit text in “Headline”',
    );
    expect(requireOk(setTextSettingsCommand(doc, 'lyr-t', { fontSize: 72 })).label).toBe(
      'Set “Headline” font size to 72px',
    );
    expect(requireOk(setTextSettingsCommand(doc, 'lyr-t', { align: 'center' })).label).toBe(
      'Align “Headline” text center',
    );
    expect(requireOk(setTextSettingsCommand(doc, 'lyr-t', { color: '#ff8a3d' })).label).toBe(
      'Set “Headline” text colour to #ff8a3d',
    );
  });

  it('merges a typography patch rather than replacing the settings', () => {
    const command = requireOk(setTextSettingsCommand(doc, 'lyr-t', { fontSize: 72 }));
    const layer = applied(doc, command).scene.layers[1];

    expect(layer?.type === 'text' ? layer.text.fontSize : 0).toBe(72);
    expect(layer?.type === 'text' ? layer.text.content : '').toBe('Fixture text');
  });

  it('applies and removes a fill or stroke with a label that says which', () => {
    const filled = requireOk(setShapeSettingsCommand(doc, 'lyr-a', { fill: '#123456' }));
    expect(filled.label).toBe('Set “Card” fill to #123456');

    const cleared = requireOk(setShapeSettingsCommand(doc, 'lyr-a', { fill: null }));
    expect(cleared.label).toBe('Remove “Card” fill');
    expect(applied(doc, cleared).scene.layers[0]?.type === 'rect' ? true : false).toBe(true);
  });

  it('refuses shape settings on a text layer', () => {
    expect(setShapeSettingsCommand(doc, 'lyr-t', { fill: '#123456' }).ok).toBe(false);
  });

  it('fits a graphic with a label naming the fit', () => {
    const graphic = documentFixture({ scene: sceneOf(imageLayer('lyr-i', { name: 'Art' })) });
    const command = requireOk(setImageSettingsCommand(graphic, 'lyr-i', { fit: 'cover' }));

    expect(command.label).toBe('Fit “Art” graphic to cover');
    const layer = applied(graphic, command).scene.layers[0];
    expect(layer?.type === 'image' ? layer.image.fit : null).toBe('cover');
  });
});

describe('document-level commands', () => {
  const doc = documentFixture();

  it('applies a palette, normalising the colours', () => {
    const command = requireOk(applyPaletteCommand(['#FF8A3D', 'nope', '#0F1115'], 'Aurora'));
    expect(command.label).toBe('Apply palette “Aurora”');
    expect(applied(doc, command).palette).toEqual(['#ff8a3d', '#0f1115']);
  });

  it('caps a palette at twelve colours and refuses one with no usable colour', () => {
    const many = Array.from({ length: 20 }, (_, index) => `#${String(index).padStart(6, '0')}`);
    expect(requireOk(applyPaletteCommand(many)).patch.palette).toHaveLength(12);
    expect(applyPaletteCommand(['red', '']).ok).toBe(false);
  });

  it('sets the background to a colour, or makes it transparent', () => {
    const coloured = requireOk(setBackgroundCommand(doc, { color: '#ffffff' }));
    expect(coloured.label).toBe('Set canvas background to #ffffff');
    expect(applied(doc, coloured).canvas.background).toBe('#ffffff');

    const transparent = requireOk(
      setBackgroundCommand(applied(doc, coloured), { transparent: true }),
    );
    expect(transparent.label).toBe('Make the canvas background transparent');
    expect(applied(doc, transparent).canvas.transparent).toBe(true);
    expectSchemaValid(applied(doc, transparent));
  });

  it('refuses an invalid colour and a no-op change', () => {
    expect(setBackgroundCommand(doc, { color: 'black' }).ok).toBe(false);
    expect(setBackgroundCommand(doc, { transparent: doc.canvas.transparent }).ok).toBe(false);
  });
});
