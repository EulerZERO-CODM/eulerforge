import { describe, expect, it } from 'vitest';

import {
  describeSelection,
  EMPTY_SELECTION,
  isSelected,
  normaliseSelection,
  selectedLayers,
  selectionFrame,
  selectOnly,
  singleSelectedLayer,
  toggleSelection,
} from './selection';
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
