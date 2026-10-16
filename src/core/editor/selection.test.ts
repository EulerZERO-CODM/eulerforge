import { describe, expect, it } from 'vitest';

import {
  describeSelection,
  EMPTY_SELECTION,
  isSelected,
  lockedSelectionIds,
  normaliseSelection,
  selectedLayers,
  selectionFrame,
  selectOnly,
  singleSelectedLayer,
  toggleSelection,
  transformFrame,
  transformTargets,
  transformableLayers,
  unionSelection,
} from './selection';
import { createRect } from '../documents/geometry';
import {
  documentFixture,
  empty,
  layerId,
  rectLayer,
  sceneOf,
  textLayer,
} from '../../testing/layers';
import { forgeDocumentSchema } from '../documents/schema';

/**
 * Selection semantics.
 *
 * Selection is interface state, so these tests are as much about what selection *cannot* do: it is
 * never stored in a document, it cannot keep a deleted layer alive, and scene order — not click
 * order — decides the order of the layers it reports.
 */
describe('selection', () => {
  const bottom = rectLayer('lyr-bottom', { x: 0, y: 0, width: 100, height: 100 });
  const top = textLayer('lyr-top', { x: 200, y: 50, width: 240, height: 80 });
  const scene = sceneOf(bottom, top);

  it('reports selected layers in scene order, not the order they were clicked', () => {
    const clickedTopFirst = Object.freeze([layerId('lyr-top'), layerId('lyr-bottom')]);

    expect(selectedLayers(scene, clickedTopFirst).map((layer) => String(layer.id))).toEqual([
      'lyr-bottom',
      'lyr-top',
    ]);
  });

  it('drops ids that are no longer in the scene', () => {
    const stale = Object.freeze([layerId('lyr-top'), layerId('lyr-deleted')]);

    expect(normaliseSelection(stale, scene)).toEqual([layerId('lyr-top')]);
    // ...and keeps the very same array when nothing was dropped, so React sees no change.
    const fresh = Object.freeze([layerId('lyr-top')]);
    expect(normaliseSelection(fresh, scene)).toBe(fresh);
  });

  it('unions the frames of everything selected, and reports nothing for an empty selection', () => {
    expect(selectionFrame(scene, EMPTY_SELECTION)).toBeUndefined();

    const frame = selectionFrame(scene, Object.freeze([layerId('lyr-top'), layerId('lyr-bottom')]));
    expect(frame).toEqual({ x: 0, y: 0, width: 440, height: 130 });
  });

  it('resolves a single layer only when exactly one is selected', () => {
    expect(singleSelectedLayer(scene, Object.freeze([layerId('lyr-top')]))?.name).toBe(
      'Text lyr-top',
    );
    expect(singleSelectedLayer(scene, EMPTY_SELECTION)).toBeUndefined();
    expect(
      singleSelectedLayer(scene, Object.freeze([layerId('lyr-top'), layerId('lyr-bottom')])),
    ).toBeUndefined();
  });

  it('toggles a layer in and out, without duplicating it', () => {
    const once = toggleSelection(EMPTY_SELECTION, layerId('lyr-top'));
    expect(once).toEqual([layerId('lyr-top')]);

    const twice = toggleSelection(once, layerId('lyr-top'));
    expect(twice).toEqual([]);

    expect(isSelected(selectOnly('lyr-bottom'), 'lyr-bottom')).toBe(true);
    expect(isSelected(selectOnly('lyr-bottom'), 'lyr-top')).toBe(false);
  });

  it('selects by string id too, which is what DOM event handlers carry', () => {
    expect(isSelected(EMPTY_SELECTION, 'lyr-top')).toBe(false);
    expect(isSelected(selectOnly('lyr-top'), 'lyr-top')).toBe(true);
  });

  it('describes the selection for assistive technology', () => {
    expect(describeSelection(scene, EMPTY_SELECTION)).toBe('Nothing selected');
    expect(describeSelection(scene, selectOnly('lyr-top'))).toBe('Text lyr-top selected');
    expect(
      describeSelection(scene, Object.freeze([layerId('lyr-top'), layerId('lyr-bottom')])),
    ).toBe('2 layers selected');
  });

  it('never appears in a persisted document', () => {
    const populated = documentFixture({ scene });
    const keys = Object.keys(populated);

    expect(keys).not.toContain('selection');
    expect(keys).not.toContain('selectedLayerId');
    // The document still validates, so nothing selection-shaped leaked into the model either.
    expect(forgeDocumentSchema.safeParse(populated).success).toBe(true);
    expect(empty().layers).toHaveLength(0);
  });
});

describe('selection helpers for gestures', () => {
  const lower = rectLayer('lyr-low', { x: 0, y: 0, width: 100, height: 100, name: 'Lower' });
  const upper = rectLayer('lyr-up', { x: 200, y: 50, width: 100, height: 100, name: 'Upper' });
  const locked = {
    ...rectLayer('lyr-lock', { x: 400, y: 0, width: 100, height: 100 }),
    locked: true,
  };
  const scene = sceneOf(lower, upper, locked);

  it('unions an additive selection without reordering what was already selected', () => {
    const existing = Object.freeze([upper.id]);
    const union = unionSelection(existing, [lower.id, upper.id]);

    expect(union.map(String)).toEqual([String(upper.id), String(lower.id)]);
    // Adding nothing returns the very same value, so a marquee over empty space is a no-op.
    expect(unionSelection(existing, [upper.id])).toBe(existing);
    expect(unionSelection(EMPTY_SELECTION, [])).toEqual([]);
  });

  it('excludes locked layers from what a gesture can transform', () => {
    const selection = [lower.id, upper.id, locked.id];
    const targets = transformTargets(scene, selection);

    expect(targets.map((target) => String(target.id))).toEqual([
      String(lower.id),
      String(upper.id),
    ]);
    expect(lockedSelectionIds(scene, selection).map(String)).toEqual([String(locked.id)]);
    expect(transformableLayers(scene, selection).map((layer) => layer.name)).toEqual([
      'Lower',
      'Upper',
    ]);
  });

  it('draws the transform box around the transformable part only', () => {
    // The box a handle drag will change: 0,0 to 300,150 - the locked layer at x=400 is excluded.
    expect(transformFrame(scene, [lower.id, upper.id, locked.id])).toEqual(
      createRect(0, 0, 300, 150),
    );
    // Everything selected is still drawn as selected, so the user sees the locked layer is in play.
    expect(selectionFrame(scene, [lower.id, upper.id, locked.id])).toEqual(
      createRect(0, 0, 500, 150),
    );
  });

  it('reports no transform box when every selected layer is locked', () => {
    expect(transformFrame(scene, [locked.id])).toBeUndefined();
    expect(transformTargets(scene, [locked.id])).toEqual([]);
    // Selection itself is not lost: the layer is listed as selected and shown in the artboard box.
    expect(selectionFrame(scene, [locked.id])).toEqual(locked.frame);
  });

  it('ignores ids that are no longer in the scene', () => {
    const stale = Object.freeze([lower.id, layerId('lyr-gone')]);
    expect(transformTargets(scene, stale).map((target) => String(target.id))).toEqual([
      String(lower.id),
    ]);
    expect(lockedSelectionIds(scene, stale)).toEqual([]);
  });
});
