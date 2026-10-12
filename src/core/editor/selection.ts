/**
 * Selection state.
 *
 * Selection is transient: it lives in the interface, never in the document and never in history
 * (ADR-0015). These helpers therefore take a scene and a selection and return plain values — they
 * have no place to store anything, which is the point.
 */

import { unionRects, type Rect } from '../documents/geometry';
import type { Layer, LayerId, Scene } from '../documents/layer-types';

export type Selection = readonly LayerId[];

export const EMPTY_SELECTION: Selection = Object.freeze([]);

/** Drops ids that are no longer in the scene, so a deleted layer cannot stay selected. */
export function normaliseSelection(selection: Selection, scene: Scene): Selection {
  const present = new Set(scene.layers.map((layer) => String(layer.id)));
  const kept = selection.filter((id) => present.has(String(id)));
  if (kept.length === selection.length) return selection;
  return Object.freeze(kept);
}

export function selectedLayers(scene: Scene, selection: Selection): readonly Layer[] {
  return scene.layers.filter((layer) => selection.some((id) => String(id) === String(layer.id)));
}

export function isSelected(selection: Selection, id: LayerId | string): boolean {
  return selection.some((candidate) => String(candidate) === String(id));
}

/** Replaces the selection with one layer. */
export function selectOnly(id: LayerId | string): Selection {
  return Object.freeze([id as LayerId]);
}

/** Adds or removes a layer, as Cmd/Ctrl-click does. */
export function toggleSelection(selection: Selection, id: LayerId | string): Selection {
  if (isSelected(selection, id)) {
    return Object.freeze(selection.filter((candidate) => String(candidate) !== String(id)));
  }
  return Object.freeze([...selection, id as LayerId]);
}

/** Bounding box of the selection, used to draw the selection overlay and the resize handles. */
export function selectionFrame(scene: Scene, selection: Selection): Rect | undefined {
  return unionRects(selectedLayers(scene, selection).map((layer) => layer.frame));
}

/** The single selected layer, or undefined when the selection is empty or multiple. */
export function singleSelectedLayer(scene: Scene, selection: Selection): Layer | undefined {
  const layers = selectedLayers(scene, selection);
  return layers.length === 1 ? layers[0] : undefined;
}

/** Human label for the current selection, used in the artboard's accessible name. */
export function describeSelection(scene: Scene, selection: Selection): string {
  const layers = selectedLayers(scene, selection);
  if (layers.length === 0) return 'Nothing selected';
  if (layers.length === 1) return `${layers[0]?.name ?? 'Layer'} selected`;
  return `${String(layers.length)} layers selected`;
}
