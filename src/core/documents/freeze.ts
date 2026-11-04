/**
 * Document freezing.
 *
 * Documents are immutable values: every write produces a new one. `Object.freeze` on the top level
 * alone would still leave `scene.layers[0].text.content` mutable, which is exactly the kind of
 * accidental edit that makes undo lie about what changed. This module freezes the whole graph.
 */

import { freezeLayer } from './layer-operations';
import type { StudioPayload } from './payload';
import type { ForgeDocument } from './types';

function freezePayload(payload: StudioPayload | null): StudioPayload | null {
  if (!payload) return null;
  switch (payload.kind) {
    case 'photo':
      return Object.freeze({
        ...payload,
        source: payload.source ? Object.freeze({ ...payload.source }) : null,
        adjustments: Object.freeze(payload.adjustments.map((item) => Object.freeze({ ...item }))),
        mask: payload.mask
          ? Object.freeze({
              ...payload.mask,
              strokes: Object.freeze(
                payload.mask.strokes.map((stroke) =>
                  Object.freeze({ ...stroke, points: Object.freeze([...stroke.points]) }),
                ),
              ),
            })
          : null,
        retouch: Object.freeze(
          payload.retouch.map((stroke) =>
            Object.freeze({ ...stroke, points: Object.freeze([...stroke.points]) }),
          ),
        ),
      });
    case 'motion':
      return Object.freeze({
        ...payload,
        tracks: Object.freeze(
          payload.tracks.map((track) =>
            Object.freeze({
              ...track,
              keyframes: Object.freeze(
                track.keyframes.map((keyframe) =>
                  Object.freeze({ ...keyframe, easing: Object.freeze({ ...keyframe.easing }) }),
                ),
              ),
            }),
          ),
        ),
      });
    case 'video':
      return Object.freeze({
        ...payload,
        media: Object.freeze(payload.media.map((item) => Object.freeze({ ...item }))),
        tracks: Object.freeze(
          payload.tracks.map((track) =>
            Object.freeze({
              ...track,
              clips: Object.freeze(track.clips.map((clip) => Object.freeze({ ...clip }))),
            }),
          ),
        ),
      });
  }
}

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
    studioPayload: freezePayload(document.studioPayload),
  });
}
