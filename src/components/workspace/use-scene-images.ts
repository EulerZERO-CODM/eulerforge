'use client';

/**
 * Scene image loading.
 *
 * A graphic layer renders from a decoded image, and decoding is asynchronous. This hook keeps one
 * `<img>` per distinct source, reports whether each is ready, loading or broken, and exposes the
 * resolver the renderer needs. Nothing is reported as drawn until it is decoded — an export must
 * never claim success for a graphic the browser never loaded.
 *
 * Progress lives in refs and a revision counter, not in state that an effect writes: the effect only
 * starts loads and subscribes to their events, so loading an image cannot cascade renders.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Scene } from '../../core/documents/layer-types';
import type { ImageResolver, RenderImage } from '../../core/render/plan';

export type ImageStatus = 'loading' | 'ready' | 'error';

export type SceneImages = {
  readonly resolver: ImageResolver;
  readonly status: ReadonlyMap<string, ImageStatus>;
  /** True while at least one source is still loading. */
  readonly loading: boolean;
  /** Sources the browser refused to load. */
  readonly errors: readonly string[];
  /** Re-attempts every failed source; used by the "reload graphics" action. */
  readonly retry: () => void;
};

export function useSceneImages(scene: Scene): SceneImages {
  // Decoded images live in a ref because they are values React never renders; the *status* is state,
  // because the interface does render it. Both are only written from load callbacks.
  const loaded = useRef(new Map<string, HTMLImageElement>());
  const [status, setStatus] = useState<ReadonlyMap<string, ImageStatus>>(new Map());

  const hrefs = useMemo(() => {
    const seen = new Set<string>();
    for (const layer of scene.layers) {
      if (layer.type === 'image') seen.add(layer.image.href);
    }
    return [...seen];
  }, [scene.layers]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const pending = hrefs.filter((href) => !loaded.current.has(href));

    for (const href of pending) {
      const image = new window.Image();
      image.decoding = 'async';
      image.onload = () => {
        if (cancelled) return;
        loaded.current.set(href, image);
        setStatus((previous) => new Map(previous).set(href, 'ready'));
      };
      image.onerror = () => {
        if (cancelled) return;
        setStatus((previous) => new Map(previous).set(href, 'error'));
      };
      image.src = href;
    }

    return () => {
      cancelled = true;
    };
  }, [hrefs]);

  /** Status for the current sources, with anything not yet attempted reported as loading. */
  const currentStatus = useMemo(() => {
    const map = new Map<string, ImageStatus>();
    for (const href of hrefs) {
      map.set(href, status.get(href) ?? 'loading');
    }
    return map;
  }, [hrefs, status]);

  const resolver = useCallback<ImageResolver>((href) => {
    const image = loaded.current.get(href);
    if (image) return { image: image as unknown as RenderImage };
    return { error: 'the graphic has not finished loading' };
  }, []);

  const errors = useMemo(
    () => hrefs.filter((href) => currentStatus.get(href) === 'error'),
    [hrefs, currentStatus],
  );

  const retry = useCallback(() => {
    for (const href of hrefs) loaded.current.delete(href);
    setStatus(new Map());
  }, [hrefs]);

  return {
    resolver,
    status: currentStatus,
    loading: hrefs.some((href) => currentStatus.get(href) === 'loading'),
    errors,
    retry,
  };
}
