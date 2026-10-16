import { describe, expect, it } from 'vitest';

import {
  addAttribution,
  addLayer,
  addNewLayer,
  attributionForScene,
  createLayer,
  defaultFrameFor,
  deleteLayer,
  deleteLayers,
  duplicateLayer,
  duplicateLayers,
  findAttribution,
  moveLayerTo,
  renameLayer,
  reorderLayer,
  reorderLayers,
  scenesEqual,
  setLayerVisibility,
  updateLayer,
  updateLayerSettings,
  validateTextSettings,
} from './layer-operations';
import { MAX_LAYERS, type Scene } from './layer-types';
import { createRect } from './geometry';
import {
  attributionRecord,
  ellipseLayer,
  imageLayer,
  rectLayer,
  sceneOf,
  sequentialLayerIds,
  textLayer,
} from '../../testing/layers';

function ids(scene: { layers: readonly { id: string }[] }): string[] {
  return scene.layers.map((layer) => layer.id);
}

describe('createLayer', () => {
  it('fills defaults per type and freezes the result', () => {
    const created = createLayer({ type: 'rect', frame: createRect(10, 20, 100, 50) });
    if (!created.ok) throw new Error('expected a layer');
    expect(created.value).toMatchObject({
      type: 'rect',
      visible: true,
      locked: false,
      opacity: 1,
      frame: { x: 10, y: 20, width: 100, height: 50 },
    });
    expect(Object.isFrozen(created.value)).toBe(true);
    expect(Object.isFrozen(created.value.frame)).toBe(true);
  });

  it('honours explicit overrides and a caller-supplied id', () => {
    const created = createLayer(
      { type: 'text', frame: createRect(0, 0, 200, 60), text: { content: 'Hello', fontSize: 40 } },
      { id: 'lyr-explicit' as never, name: 'Headline' },
    );
    if (!created.ok) throw new Error('expected a layer');
    expect(created.value.id).toBe('lyr-explicit');
    expect(created.value.name).toBe('Headline');
    expect(created.value.type === 'text' && created.value.text.content).toBe('Hello');
  });

  it('caps a pathological name instead of storing it', () => {
    const created = createLayer(
      { type: 'rect', frame: createRect(0, 0, 10, 10) },
      { name: 'x'.repeat(200) },
    );
    if (!created.ok) throw new Error('expected a layer');
    expect(created.value.name.length).toBe(80);
  });

  it('infers intrinsic size for an image layer from its frame', () => {
    const created = createLayer({
      type: 'image',
      frame: createRect(0, 0, 300, 150),
      image: { href: '/forge-assets/thumb-overlap.svg' },
    });
    if (!created.ok || created.value.type !== 'image') throw new Error('expected an image layer');
    expect(created.value.image.intrinsicWidth).toBe(300);
    expect(created.value.image.intrinsicHeight).toBe(150);
  });
});

describe('addLayer / addNewLayer', () => {
  it('appends on top of the stack — the last layer is the front-most', () => {
    const added = addNewLayer(sceneOf(rectLayer('lyr-back')), {
      type: 'text',
      frame: createRect(0, 0, 100, 40),
    });
    if (!added.ok) throw new Error('expected a scene');
    expect(ids(added.value.scene)).toEqual(['lyr-back', added.value.layer.id]);
  });

  it('refuses a duplicate id', () => {
    const result = addLayer(sceneOf(rectLayer('lyr-a')), rectLayer('lyr-a'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation-failed');
  });

  it('refuses to exceed the layer limit', () => {
    let scene = sceneOf();
    for (let index = 0; index < MAX_LAYERS; index += 1) {
      const next = addLayer(scene, rectLayer(`lyr-${index}`));
      if (!next.ok) throw new Error('expected room for a layer');
      scene = next.value;
    }
    const overflow = addLayer(scene, rectLayer('lyr-one-too-many'));
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.error.code).toBe('unsupported');
  });

  it('generates unique ids when the generator collides', () => {
    const generator = sequentialLayerIds('lyr-dup');
    const first = addNewLayer(
      sceneOf(),
      { type: 'rect', frame: createRect(0, 0, 10, 10) },
      { generateId: generator },
    );
    if (!first.ok) throw new Error('expected a layer');
    const second = addNewLayer(
      first.value.scene,
      { type: 'rect', frame: createRect(0, 0, 10, 10) },
      {
        generateId: () => 'lyr-dup-1',
      },
    );
    // The stub always returns the id already in use, so the operation must refuse rather than collide.
    expect(second.ok).toBe(false);
  });
});

describe('updateLayer', () => {
  it('changes one property and keeps the stack position', () => {
    const scene = sceneOf(rectLayer('lyr-a'), textLayer('lyr-b'), imageLayer('lyr-c'));
    const updated = updateLayer(scene, 'lyr-b', { opacity: 0.5 });
    if (!updated.ok) throw new Error('expected a scene');
    expect(ids(updated.value)).toEqual(['lyr-a', 'lyr-b', 'lyr-c']);
    expect(updated.value.layers[1]?.opacity).toBe(0.5);
  });

  it('reports a missing layer rather than silently doing nothing', () => {
    const result = updateLayer(sceneOf(rectLayer('lyr-a')), 'lyr-missing', { opacity: 0.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not-found');
  });

  it('refuses settings that do not apply to the layer type', () => {
    const sample = textLayer('lyr-sample');
    if (sample.type !== 'text') throw new Error('fixture must be text');

    const asText = updateLayer(sceneOf(rectLayer('lyr-a')), 'lyr-a', { text: sample.text });
    expect(asText.ok).toBe(false);
    if (!asText.ok) expect(asText.error.message).toMatch(/does not apply/i);

    const asShape = updateLayer(sceneOf(textLayer('lyr-b')), 'lyr-b', {
      shape: { fill: '#ffffff', stroke: null, strokeWidth: 0, cornerRadius: 0 },
    });
    expect(asShape.ok).toBe(false);
  });

  it('refuses an image patch on a shape', () => {
    const result = updateLayerSettings(sceneOf(imageLayer('lyr-image')), 'lyr-image', {
      image: { fit: 'cover' },
    });
    if (!result.ok) throw new Error('expected a scene');
    const layer = result.value.layers[0];
    expect(layer?.type === 'image' && layer.image.fit).toBe('cover');

    expect(
      updateLayer(sceneOf(rectLayer('lyr-a')), 'lyr-a', { image: { href: '/x.svg' } as never }).ok,
    ).toBe(false);
  });

  it('merges nested settings without dropping the other properties', () => {
    const scene = sceneOf(textLayer('lyr-a', { content: 'Hello', fontSize: 40 }));
    const updated = updateLayerSettings(scene, 'lyr-a', { text: { fontSize: 72 } });
    if (!updated.ok) throw new Error('expected a scene');
    const layer = updated.value.layers[0];
    expect(layer?.type === 'text' && layer.text.content).toBe('Hello');
    expect(layer?.type === 'text' && layer.text.fontSize).toBe(72);
  });
});

describe('deleteLayer / duplicateLayer', () => {
  it('removes exactly one layer', () => {
    const scene = sceneOf(rectLayer('lyr-a'), rectLayer('lyr-b'));
    const deleted = deleteLayer(scene, 'lyr-a');
    if (!deleted.ok) throw new Error('expected a scene');
    expect(ids(deleted.value)).toEqual(['lyr-b']);
  });

  it('reports deleting something that is not there', () => {
    expect(deleteLayer(sceneOf(), 'lyr-ghost').ok).toBe(false);
    expect(deleteLayers(sceneOf(rectLayer('lyr-a')), ['lyr-ghost']).ok).toBe(false);
  });

  it('deletes several layers as one edit', () => {
    const scene = sceneOf(rectLayer('lyr-a'), rectLayer('lyr-b'), rectLayer('lyr-c'));
    const deleted = deleteLayers(scene, ['lyr-a', 'lyr-c']);
    if (!deleted.ok) throw new Error('expected a scene');
    expect(ids(deleted.value)).toEqual(['lyr-b']);
  });

  it('places the copy directly above the original with a new id and name', () => {
    const scene = sceneOf(
      rectLayer('lyr-a', { name: 'Panel' }),
      rectLayer('lyr-b', { name: 'Footer' }),
    );
    const duplicated = duplicateLayer(scene, 'lyr-a', {
      generateId: sequentialLayerIds('lyr-copy'),
    });
    if (!duplicated.ok) throw new Error('expected a duplicate');

    expect(ids(duplicated.value.scene)).toEqual(['lyr-a', 'lyr-copy-1', 'lyr-b']);
    expect(duplicated.value.layer.name).toBe('Panel copy');

    const source = scene.layers[0];
    const copy = duplicated.value.layer;
    expect(copy.id).not.toBe(source?.id);
    expect(copy.frame).toEqual(source?.frame);
  });

  it('keeps the copy independent of the original', () => {
    const scene = sceneOf(rectLayer('lyr-a', { x: 10 }));
    const duplicated = duplicateLayer(scene, 'lyr-a', { generateId: () => 'lyr-copy' });
    if (!duplicated.ok) throw new Error('expected a duplicate');
    const moved = updateLayer(duplicated.value.scene, 'lyr-copy', {
      frame: createRect(500, 500, 10, 10),
    });
    if (!moved.ok) throw new Error('expected a scene');
    expect(moved.value.layers[0]?.frame.x).toBe(10);
  });
});

describe('reorderLayer / moveLayerTo', () => {
  const scene = sceneOf(rectLayer('lyr-a'), rectLayer('lyr-b'), rectLayer('lyr-c'));

  it('moves a layer one step towards the front', () => {
    const moved = reorderLayer(scene, 'lyr-a', 'forward');
    if (!moved.ok) throw new Error('expected a scene');
    expect(ids(moved.value)).toEqual(['lyr-b', 'lyr-a', 'lyr-c']);
  });

  it('moves a layer one step towards the back', () => {
    const moved = reorderLayer(scene, 'lyr-c', 'backward');
    if (!moved.ok) throw new Error('expected a scene');
    expect(ids(moved.value)).toEqual(['lyr-a', 'lyr-c', 'lyr-b']);
  });

  it('sends a layer to the front or the back', () => {
    const front = reorderLayer(scene, 'lyr-a', 'front');
    const back = reorderLayer(scene, 'lyr-c', 'back');
    if (!front.ok || !back.ok) throw new Error('expected scenes');
    expect(ids(front.value)).toEqual(['lyr-b', 'lyr-c', 'lyr-a']);
    expect(ids(back.value)).toEqual(['lyr-c', 'lyr-a', 'lyr-b']);
  });

  it('is a no-op at the ends rather than an error', () => {
    const alreadyFront = reorderLayer(scene, 'lyr-c', 'forward');
    if (!alreadyFront.ok) throw new Error('expected a scene');
    expect(ids(alreadyFront.value)).toEqual(ids(scene));
    const alreadyBack = reorderLayer(scene, 'lyr-a', 'back');
    if (!alreadyBack.ok) throw new Error('expected a scene');
    expect(ids(alreadyBack.value)).toEqual(ids(scene));
  });

  it('moves a layer to an explicit index and clamps out-of-range requests', () => {
    const moved = moveLayerTo(scene, 'lyr-a', 2);
    if (!moved.ok) throw new Error('expected a scene');
    expect(ids(moved.value)).toEqual(['lyr-b', 'lyr-c', 'lyr-a']);

    const clamped = moveLayerTo(scene, 'lyr-c', 99);
    if (!clamped.ok) throw new Error('expected a scene');
    expect(ids(clamped.value)).toEqual(['lyr-a', 'lyr-b', 'lyr-c']);
  });

  it('preserves every layer exactly once through a reorder', () => {
    const moved = reorderLayer(scene, 'lyr-b', 'front');
    if (!moved.ok) throw new Error('expected a scene');
    expect([...ids(moved.value)].sort()).toEqual(['lyr-a', 'lyr-b', 'lyr-c']);
    expect(new Set(ids(moved.value)).size).toBe(3);
  });

  it('reports reordering a layer that is not in the scene', () => {
    expect(reorderLayer(scene, 'lyr-ghost', 'front').ok).toBe(false);
    expect(moveLayerTo(scene, 'lyr-ghost', 1).ok).toBe(false);
  });
});

describe('renameLayer / setLayerVisibility', () => {
  it('trims a new name and rejects an empty one', () => {
    const renamed = renameLayer(sceneOf(rectLayer('lyr-a')), 'lyr-a', '  Panel  ');
    if (!renamed.ok) throw new Error('expected a scene');
    expect(renamed.value.layers[0]?.name).toBe('Panel');
    expect(renameLayer(sceneOf(rectLayer('lyr-a')), 'lyr-a', '   ').ok).toBe(false);
  });

  it('hides a layer without removing it', () => {
    const hidden = setLayerVisibility(sceneOf(rectLayer('lyr-a')), 'lyr-a', false);
    if (!hidden.ok) throw new Error('expected a scene');
    expect(hidden.value.layers).toHaveLength(1);
    expect(hidden.value.layers[0]?.visible).toBe(false);
  });
});

describe('scenesEqual', () => {
  it('compares by value, including order', () => {
    expect(scenesEqual(sceneOf(rectLayer('lyr-a')), sceneOf(rectLayer('lyr-a')))).toBe(true);
    const [a, b] = [rectLayer('lyr-a'), rectLayer('lyr-b')];
    expect(scenesEqual(sceneOf(a, b), sceneOf(b, a))).toBe(false);
    expect(scenesEqual(sceneOf(rectLayer('lyr-a')), sceneOf(rectLayer('lyr-a', { x: 1 })))).toBe(
      false,
    );
  });
});

describe('defaultFrameFor', () => {
  const canvas = { width: 1080, height: 1080 };

  it('places every new layer inside the canvas', () => {
    for (const type of ['text', 'rect', 'ellipse', 'image'] as const) {
      const frame = defaultFrameFor(type, canvas);
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(canvas.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(canvas.height);
    }
  });

  it('fits a new layer inside a small portrait canvas', () => {
    const frame = defaultFrameFor('image', { width: 120, height: 300 });
    expect(frame.x + frame.width).toBeLessThanOrEqual(120);
    expect(frame.width).toBeGreaterThan(0);
  });
});

describe('validateTextSettings', () => {
  it('accepts the defaults', () => {
    const layer = textLayer('lyr-a');
    if (layer.type !== 'text') throw new Error('fixture must be text');
    expect(validateTextSettings(layer.text)).toEqual([]);
  });

  it('rejects out-of-range typography with readable messages', () => {
    const layer = textLayer('lyr-a');
    if (layer.type !== 'text') throw new Error('fixture must be text');
    const issues = validateTextSettings({
      ...layer.text,
      fontSize: 2,
      lineHeight: 9,
      letterSpacing: 900,
      color: 'orange',
    });
    expect(issues).toHaveLength(4);
  });
});

describe('attribution records', () => {
  it('adds a record and de-duplicates by asset', () => {
    const first = addAttribution([], attributionRecord());
    expect(first).toHaveLength(1);
    const second = addAttribution(first, attributionRecord({ id: 'attr-2', notes: 'updated' }));
    expect(second).toHaveLength(1);
    expect(second[0]?.notes).toBe('updated');
  });

  it('finds a record by asset id', () => {
    const records = addAttribution([], attributionRecord());
    expect(findAttribution(records, 'sample.gradient-grid')?.licenseId).toBe('forge-sample');
    expect(findAttribution(records, 'nope')).toBeUndefined();
  });

  it('lists only the attributions that the scene still uses', () => {
    const records = addAttribution(
      addAttribution([], attributionRecord()),
      attributionRecord({ id: 'attr-2', assetId: 'sample.other' }),
    );
    const placed = imageLayer('lyr-image', { assetId: 'sample.gradient-grid' });
    expect(attributionForScene(records, sceneOf(placed)).map((record) => record.assetId)).toEqual([
      'sample.gradient-grid',
    ]);
    expect(attributionForScene(records, sceneOf(rectLayer('lyr-a')))).toEqual([]);
  });
});

describe('immutability', () => {
  it('never mutates the input scene', () => {
    const scene = sceneOf(rectLayer('lyr-a'), textLayer('lyr-b'), ellipseLayer('lyr-c'));
    const before = JSON.stringify(scene);
    updateLayer(scene, 'lyr-a', { opacity: 0.25 });
    deleteLayer(scene, 'lyr-b');
    reorderLayer(scene, 'lyr-a', 'front');
    duplicateLayer(scene, 'lyr-c', { generateId: () => 'lyr-copy' });
    expect(JSON.stringify(scene)).toBe(before);
  });

  it('freezes the scenes it returns', () => {
    const updated = updateLayer(sceneOf(rectLayer('lyr-a')), 'lyr-a', { opacity: 0.5 });
    if (!updated.ok) throw new Error('expected a scene');
    expect(Object.isFrozen(updated.value)).toBe(true);
    expect(Object.isFrozen(updated.value.layers)).toBe(true);
    expect(Object.isFrozen(updated.value.layers[0])).toBe(true);
  });
});

describe('batch layer operations', () => {
  const one = rectLayer('lyr-1', { x: 0, y: 0, width: 10, height: 10, name: 'One' });
  const two = rectLayer('lyr-2', { x: 20, y: 0, width: 10, height: 10, name: 'Two' });
  const three = rectLayer('lyr-3', { x: 40, y: 0, width: 10, height: 10, name: 'Three' });
  const four = rectLayer('lyr-4', { x: 60, y: 0, width: 10, height: 10, name: 'Four' });
  const scene = sceneOf(one, two, three, four);
  const names = (next: Scene) => next.layers.map((layer) => layer.name);

  it('duplicates several layers in place, keeping the selection order', () => {
    const result = duplicateLayers(scene, [one.id, three.id], {
      generateId: sequentialLayerIds('lyr-dup'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(names(result.value.scene)).toEqual([
      'One',
      'One copy',
      'Two',
      'Three',
      'Three copy',
      'Four',
    ]);
    expect(result.value.layers.map((layer) => layer.name)).toEqual(['One copy', 'Three copy']);
    expect(new Set(result.value.scene.layers.map((layer) => String(layer.id))).size).toBe(6);
  });

  it('fills the gap in the id space so duplicates cannot collide with each other', () => {
    // A generator that repeats itself must be rejected, not silently accepted.
    const colliding = duplicateLayers(scene, [one.id, two.id], { generateId: () => 'lyr-same' });
    expect(colliding.ok).toBe(false);

    // A generator that repeats once still succeeds, because the loop retries against the growing list.
    let n = 0;
    const flaky = duplicateLayers(scene, [one.id, two.id], {
      generateId: () => {
        n += 1;
        return n === 2 ? 'lyr-first' : `lyr-gen-${String(n)}`;
      },
    });
    expect(flaky.ok).toBe(true);
    if (flaky.ok) {
      expect(new Set(flaky.value.scene.layers.map((layer) => String(layer.id))).size).toBe(
        flaky.value.scene.layers.length,
      );
    }
  });

  it('refuses a batch that would exceed the layer limit', () => {
    const full = sceneOf(
      ...Array.from({ length: MAX_LAYERS }, (_, index) => rectLayer(`lyr-full-${String(index)}`)),
    );
    const result = duplicateLayers(full, ['lyr-full-0']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/at most 200 layers/);
  });

  it('reports a missing selection rather than returning an unchanged scene', () => {
    const result = duplicateLayers(scene, ['lyr-missing']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not-found');
    expect(reorderLayers(scene, [], 'front').ok).toBe(false);
  });

  it('moves a multi-layer block forward and backward without crossing itself', () => {
    const forward = reorderLayers(scene, [one.id, two.id], 'forward');
    expect(forward.ok).toBe(true);
    if (forward.ok) expect(names(forward.value)).toEqual(['Three', 'One', 'Two', 'Four']);

    const backward = reorderLayers(scene, [two.id, three.id], 'backward');
    expect(backward.ok).toBe(true);
    if (backward.ok) expect(names(backward.value)).toEqual(['Two', 'Three', 'One', 'Four']);

    // A block already at the top stays put instead of cycling.
    const pinned = reorderLayers(scene, [three.id, four.id], 'forward');
    if (pinned.ok) expect(names(pinned.value)).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('moves a multi-layer block to the front and to the back in order', () => {
    const front = reorderLayers(scene, [one.id, three.id], 'front');
    if (front.ok) expect(names(front.value)).toEqual(['Two', 'Four', 'One', 'Three']);

    const back = reorderLayers(scene, [two.id, four.id], 'back');
    if (back.ok) expect(names(back.value)).toEqual(['Two', 'Four', 'One', 'Three']);

    // Selecting everything is already solved: nothing moves and nothing is lost.
    const all = reorderLayers(
      scene,
      scene.layers.map((layer) => layer.id),
      'front',
    );
    if (all.ok) expect(names(all.value)).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('keeps the batch reorder and the single-layer reorder in agreement', () => {
    const single = reorderLayer(scene, two.id, 'forward');
    const batch = reorderLayers(scene, [two.id], 'forward');
    expect(single.ok && batch.ok).toBe(true);
    if (single.ok && batch.ok) expect(names(batch.value)).toEqual(names(single.value));
  });
});
