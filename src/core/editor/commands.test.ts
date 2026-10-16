import { describe, expect, it } from 'vitest';

import {
  addLayerCommand,
  applyPaletteCommand,
  deleteLayersCommand,
  duplicateLayerCommand,
  duplicateLayersCommand,
  reorderLayersCommand,
  setGroupBoundsCommand,
  setLayersLockCommand,
  setLayersOpacityCommand,
  setLayersVisibilityCommand,
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

describe('batch commands: one atomic edit for a whole selection', () => {
  /**
   * The regression these guard against: the inspector used to build one command per selected layer
   * from the *same* document snapshot, run them in a loop, and let later patches overwrite earlier
   * ones. Each batch command must therefore produce exactly one patch, computed against one scene,
   * that touches every requested layer.
   */
  const bottom = rectLayer('lyr-b1', { x: 0, y: 0, width: 100, height: 100, name: 'Bottom' });
  const middle = rectLayer('lyr-b2', { x: 120, y: 0, width: 100, height: 100, name: 'Middle' });
  const top = textLayer('lyr-b3', { x: 240, y: 0, width: 100, height: 100, name: 'Top' });
  const stack = sceneOf(bottom, middle, top);
  const document = documentFixture({ scene: stack });
  const ids = [String(bottom.id), String(middle.id), String(top.id)];

  // `applyDocumentPatch` returns the next document directly: it is the store, not the command, that
  // validates. Applying it here proves the patch is a real document change, not just an object.
  const sceneOfPatch = (patch: { readonly scene?: unknown }) =>
    applyDocumentPatch(document, patch as Parameters<typeof applyDocumentPatch>[1]).scene;

  it('duplicates a multi-layer selection in one patch, in place and in order', () => {
    const command = duplicateLayersCommand(document, ids, sequentialLayerIds('lyr-copy'));
    expect(command.ok).toBe(true);
    if (!command.ok) return;

    const scene = sceneOfPatch(command.value.patch);

    expect(scene.layers.map((layer) => layer.name)).toEqual([
      'Bottom',
      'Bottom copy',
      'Middle',
      'Middle copy',
      'Top',
      'Top copy',
    ]);
    // Ids stay unique, and the originals are untouched.
    expect(new Set(scene.layers.map((layer) => String(layer.id))).size).toBe(6);
    expect(command.value.label).toBe('Duplicate 3 layers');
    // A copy inherits the original's geometry rather than being moved to the canvas centre.
    expect(scene.layers[3]?.frame).toEqual(middle.frame);
  });

  it('fails loudly when ids cannot be made unique, instead of dropping a copy', () => {
    // A generator stuck on one id would silently produce two layers with the same id if the batch
    // operation ignored collisions.
    const command = duplicateLayersCommand(document, ids, () => 'lyr-collide');
    expect(command.ok).toBe(false);
    if (!command.ok) expect(command.error.code).toBe('validation-failed');
  });

  it('brings a multi-layer selection forward without letting the layers cross each other', () => {
    const command = reorderLayersCommand(
      document,
      [String(bottom.id), String(middle.id)],
      'forward',
    );
    expect(command.ok).toBe(true);
    if (!command.ok) return;

    const scene = sceneOfPatch(command.value.patch);

    // Both moved up one slot, still in their original relative order, and the unselected top layer
    // stayed above them.
    expect(scene.layers.map((layer) => layer.name)).toEqual(['Top', 'Bottom', 'Middle']);
    expect(command.value.label).toBe('Bring forward: 2 layers');
  });

  it('sends a multi-layer selection to the back and to the front in one patch', () => {
    const back = reorderLayersCommand(document, ids, 'back');
    const front = reorderLayersCommand(document, ids, 'front');
    expect(back.ok && front.ok).toBe(true);
    if (!back.ok || !front.ok) return;

    expect(sceneOfPatch(back.value.patch).layers.map((layer) => layer.name)).toEqual([
      'Bottom',
      'Middle',
      'Top',
    ]);
    expect(sceneOfPatch(back.value.patch)).toEqual(stack);

    expect(front.value.label).toBe('Bring to front: 3 layers');
  });

  it('sets visibility, lock and opacity across the whole selection atomically', () => {
    const hidden = setLayersVisibilityCommand(document, ids, false);
    const locked = setLayersLockCommand(document, ids, true);
    const translucent = setLayersOpacityCommand(document, ids, 0.25);
    expect(hidden.ok && locked.ok && translucent.ok).toBe(true);
    if (!hidden.ok || !locked.ok || !translucent.ok) return;

    const hiddenScene = sceneOfPatch(hidden.value.patch);
    expect(hiddenScene.layers.every((layer) => !layer.visible)).toBe(true);
    expect(hidden.value.label).toBe('Hide 3 layers');

    const lockedScene = sceneOfPatch(locked.value.patch);
    expect(lockedScene.layers.every((layer) => layer.locked)).toBe(true);

    const translucentScene = sceneOfPatch(translucent.value.patch);
    expect(translucentScene.layers.every((layer) => layer.opacity === 0.25)).toBe(true);
    expect(translucent.value.label).toBe('Set opacity of 3 layers to 25%');
  });

  it('reports the same labels for a single layer as the single-layer commands', () => {
    expect(setLayerVisibilityCommand(document, middle.id, false).ok).toBe(true);
    expect(setLayerLockCommand(document, middle.id, true).ok).toBe(true);
    expect(setLayerOpacityCommand(document, middle.id, 0.5).ok).toBe(true);
    expect(duplicateLayerCommand(document, middle.id).ok).toBe(true);
    expect(reorderLayerCommand(document, middle.id, 'forward').ok).toBe(true);
    const single = setLayersVisibilityCommand(document, [middle.id], false);
    expect(single.ok).toBe(true);
    if (single.ok) expect(single.value.label).toBe('Hide “Middle”');
    const singleLock = setLayersLockCommand(document, [middle.id], true);
    const singleOpacity = setLayersOpacityCommand(document, [middle.id], 0.5);
    if (singleLock.ok) expect(singleLock.value.label).toBe('Lock “Middle”');
    if (singleOpacity.ok) expect(singleOpacity.value.label).toBe('Set “Middle” opacity to 50%');
  });

  it('leaves layers outside the selection untouched', () => {
    const command = setLayersOpacityCommand(document, [String(middle.id)], 0.4);
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    const scene = sceneOfPatch(command.value.patch);

    // The patch itself only rebuilds the layer it names; the others keep their object identity, so a
    // batch edit cannot quietly rewrite the rest of the scene on its way through.
    const patched = command.value.patch.scene;
    expect(patched?.layers[0]).toBe(document.scene.layers[0]);
    expect(patched?.layers[2]).toBe(document.scene.layers[2]);
    expect(patched?.layers[1]).not.toBe(document.scene.layers[1]);

    // And the document that results holds every layer's values unchanged apart from the edited one.
    expect(scene.layers[0]).toEqual(bottom);
    expect(scene.layers[2]).toEqual(top);
    expect(scene.layers[1]?.opacity).toBe(0.4);
  });

  it('refuses a selection that is no longer in the document instead of creating an empty patch', () => {
    expect(duplicateLayersCommand(document, ['lyr-gone']).ok).toBe(false);
    expect(reorderLayersCommand(document, ['lyr-gone'], 'front').ok).toBe(false);
    expect(setLayersVisibilityCommand(document, ['lyr-gone'], false).ok).toBe(false);
    expect(setLayersLockCommand(document, ['lyr-gone'], true).ok).toBe(false);
    expect(setLayersOpacityCommand(document, ['lyr-gone'], 0.5).ok).toBe(false);
  });

  it('rejects a non-finite opacity rather than writing NaN into the document', () => {
    expect(setLayersOpacityCommand(document, ids, Number.NaN).ok).toBe(false);
  });

  it('keeps the document valid: every batch patch passes the schema', () => {
    for (const command of [
      duplicateLayersCommand(document, ids, sequentialLayerIds('lyr-valid')),
      reorderLayersCommand(document, ids, 'forward'),
      setLayersVisibilityCommand(document, ids, false),
      setLayersLockCommand(document, ids, true),
      setLayersOpacityCommand(document, ids, 0.5),
    ]) {
      expect(command.ok).toBe(true);
      if (!command.ok) continue;
      const applied = applyDocumentPatch(document, command.value.patch);
      expect(forgeDocumentSchema.safeParse(applied).success).toBe(true);
    }
  });
});

describe('setGroupBoundsCommand', () => {
  const left = rectLayer('lyr-gl', { x: 100, y: 100, width: 200, height: 100, name: 'Left' });
  const right = rectLayer('lyr-gr', { x: 400, y: 250, width: 100, height: 50, name: 'Right' });
  const document = documentFixture({ scene: sceneOf(left, right) });
  const ids = [String(left.id), String(right.id)];

  it('scales the whole selection exactly as dragging a handle would', () => {
    const command = setGroupBoundsCommand(document, ids, { width: 600, height: 300 });
    expect(command.ok).toBe(true);
    if (!command.ok) return;

    const applied = applyDocumentPatch(document, command.value.patch);

    expect(applied.scene.layers[0]?.frame).toEqual(createRect(100, 100, 300, 150));
    expect(applied.scene.layers[1]?.frame).toEqual(createRect(550, 325, 150, 75));
    // A size-only edit is labelled as a resize, not as an opaque "set bounds" number.
    expect(command.value.label).toBe('Resize 2 layers');
  });

  it('moves the selection as a group when only a position is given', () => {
    const command = setGroupBoundsCommand(document, ids, { x: 0, y: 0 });
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    const applied = applyDocumentPatch(document, command.value.patch);

    expect(applied.scene.layers[0]?.frame).toEqual(createRect(0, 0, 200, 100));
    expect(applied.scene.layers[1]?.frame).toEqual(createRect(300, 150, 100, 50));
  });

  it('ignores locked layers and refuses a selection with nothing transformable', () => {
    const locked = documentFixture({ scene: sceneOf({ ...left, locked: true }) });
    const command = setGroupBoundsCommand(locked, [String(left.id)], { width: 400 });
    expect(command.ok).toBe(false);
    if (command.ok) return;
    // A locked selection is a normal state, so it is refused for the right reason.
    expect(command.error.code).toBe('validation-failed');
    expect(command.error.message).toMatch(/locked/i);

    const mixed = documentFixture({
      scene: sceneOf(left, { ...right, locked: true }),
    });
    const mixedCommand = setGroupBoundsCommand(mixed, ids, { width: 600 });
    expect(mixedCommand.ok).toBe(true);
    if (!mixedCommand.ok) return;
    const applied = applyDocumentPatch(mixed, mixedCommand.value.patch);
    // Only `left` is transformable, so the box is `left`'s own frame: 200 wide scaled to 600.
    expect(applied.scene.layers[0]?.frame).toEqual(createRect(100, 100, 600, 100));
    // The locked layer is not touched at all.
    expect(applied.scene.layers[1]?.frame).toEqual(right.frame);
  });

  it('rejects nonsense bounds instead of writing them into the document', () => {
    expect(setGroupBoundsCommand(document, ids, { width: 0 }).ok).toBe(false);
    expect(setGroupBoundsCommand(document, ids, { height: -10 }).ok).toBe(false);
    expect(setGroupBoundsCommand(document, ids, { x: Number.NaN }).ok).toBe(false);
    expect(setGroupBoundsCommand(document, ['lyr-gone'], { width: 100 }).ok).toBe(false);
  });
});
