/**
 * Document freezing.
 *
 * Documents are immutable values: every write produces a new one. `Object.freeze` on the top level
 * alone would still leave `scene.layers[0].text.content` mutable, which is exactly the kind of
 * accidental edit that makes undo lie about what changed. This module freezes the whole graph.
 */

import { freezeLayer } from './layer-operations';
import type { ForgeDocument } from './types';

export function freezeDocument(document: ForgeDocument): ForgeDocument {
  return Object.freeze({
    ...document,
    canvas: Object.freeze({ ...document.canvas }),
    guides: Object.freeze({ ...document.guides }),
    palette: Object.freeze([...document.palette]),
    metadata: Object.freeze({
      ...document.metadata,
      tags: Object.freeze([...document.metadata.tags]),
    }),
    scene: Object.freeze({
      layers: Object.freeze(document.scene.layers.map((layer) => freezeLayer(layer))),
    }),
    attribution: Object.freeze(document.attribution.map((record) => Object.freeze({ ...record }))),
  });
}
