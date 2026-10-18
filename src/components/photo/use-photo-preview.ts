'use client';

/**
 * Preview plumbing for Photo Studio.
 *
 * The renderer itself is browser code (`src/lib/browser/photo-engine.ts`); this hook owns the
 * lifecycle a React tree needs — one decode per image, one render per document state, and a stale
 * render that finishes late never overwrites a newer one.
 */

import { useEffect, useRef, useState } from 'react';

import type { PhotoPayload } from '../../core/documents/payload';
import {
  decodePhotoSource,
  renderPhoto,
  type DecodedPhoto,
  type PhotoEngineId,
} from '../../lib/browser/photo-engine';
import type { Result } from '../../core/result';

/**
 * The preview renders at most this many pixels on the long edge.
 *
 * The *document* keeps the full working copy (up to 2048 px, `MAX_PHOTO_WORKING_EDGE`) and export
 * re-renders at that size, so the cap costs preview sharpness and nothing else. Without it, dragging
 * a slider on a 2048×2048 photo would run a 4-megapixel CPU pass per pointer move.
 */
export const PHOTO_PREVIEW_MAX_EDGE = 1280;

/** Small LRU of decoded images: one per href, so switching tools never re-decodes. */
const DECODED = new Map<string, Promise<Result<DecodedPhoto>>>();
const DECODED_LIMIT = 4;

function decode(href: string): Promise<Result<DecodedPhoto>> {
  const cached = DECODED.get(href);
  if (cached) return cached;
  const pending = decodePhotoSource(href);
  DECODED.set(href, pending);
  if (DECODED.size > DECODED_LIMIT) {
    const oldest = DECODED.keys().next().value;
    if (oldest !== undefined) DECODED.delete(oldest);
  }
  return pending;
}

/** 404: a decode result the tests can reset between cases. */
export function clearPhotoDecodeCache(): void {
  DECODED.clear();
}

export function previewSize(
  width: number,
  height: number,
  maxEdge: number = PHOTO_PREVIEW_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type PhotoRenderState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'loading';
      /**
       * The previous render, when one exists for the same image. The stage keeps showing it so a
       * slider drag repaints rather than blanking the canvas between passes.
       */
      readonly canvas: HTMLCanvasElement | null;
    }
  | {
      readonly status: 'ready';
      /** The rendered pixels, owned by the caller until the next render replaces them. */
      readonly canvas: HTMLCanvasElement;
      readonly engine: PhotoEngineId;
      readonly requestedEngine: PhotoPayload['engine'];
      readonly fallbackReason: string | null;
      readonly durationMs: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly status: 'error'; readonly message: string; readonly detail: string | null };

type UsePhotoCanvasOptions = {
  readonly href: string | null;
  readonly payload: PhotoPayload;
  /** When true the stack, mask and retouch are skipped — the "before" half of before/after. */
  readonly showOriginal: boolean;
  readonly maxEdge?: number;
  /** Skips rendering entirely, e.g. while the import panel is the only thing on screen. */
  readonly enabled?: boolean;
};

type RenderResult = {
  readonly key: string;
  readonly href: string;
  readonly canvas: HTMLCanvasElement;
  readonly engine: PhotoEngineId;
  readonly requestedEngine: PhotoPayload['engine'];
  readonly fallbackReason: string | null;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
};

type RenderFailure = {
  readonly key: string;
  readonly message: string;
  readonly detail: string | null;
};

/**
 * Renders the payload for preview.
 *
 * State is keyed by the inputs that produced it rather than set to `loading` inside the effect: a
 * render that finishes late is compared against the current key and dropped, and React's effect
 * rules are respected (no synchronous `setState` in an effect body). A payload edit changes the
 * key, so the previous frame stays on screen while the next one is computed.
 */
export function usePhotoCanvas({
  href,
  payload,
  showOriginal,
  maxEdge = PHOTO_PREVIEW_MAX_EDGE,
  enabled = true,
}: UsePhotoCanvasOptions): PhotoRenderState {
  const [result, setResult] = useState<RenderResult | null>(null);
  const [failure, setFailure] = useState<RenderFailure | null>(null);
  const token = useRef(0);

  const previewPayload: PhotoPayload = showOriginal
    ? { ...payload, adjustments: [], mask: null, retouch: [] }
    : payload;
  // The payload is a frozen document object, so `JSON.stringify` is both stable and cheap relative
  // to a render. It also means a re-render of the React tree never re-runs the pipeline.
  const key = `${String(maxEdge)}|${JSON.stringify(previewPayload)}`;

  useEffect(() => {
    if (!enabled || !href) return;
    const current = token.current + 1;
    token.current = current;

    const applied: PhotoPayload = showOriginal
      ? { ...payload, adjustments: [], mask: null, retouch: [] }
      : payload;
    void (async () => {
      const decoded = await decode(href);
      if (token.current !== current) return;
      if (!decoded.ok) {
        setFailure({
          key,
          message: decoded.error.message,
          detail: decoded.error.detail ?? null,
        });
        return;
      }
      const size = previewSize(decoded.value.width, decoded.value.height, maxEdge);
      const rendered = await renderPhoto({
        image: decoded.value.image,
        payload: applied,
        width: size.width,
        height: size.height,
      });
      if (token.current !== current) return;
      if (!rendered.ok) {
        setFailure({ key, message: rendered.error.message, detail: rendered.error.detail ?? null });
        return;
      }
      setResult({
        key,
        href,
        canvas: rendered.value.canvas,
        engine: rendered.value.engine,
        requestedEngine: applied.engine,
        fallbackReason: rendered.value.fallbackReason,
        durationMs: rendered.value.durationMs,
        width: size.width,
        height: size.height,
      });
    })();
  }, [enabled, href, key, maxEdge, payload, showOriginal]);

  if (!enabled || !href) return { status: 'idle' };
  if (failure && failure.key === key) {
    return { status: 'error', message: failure.message, detail: failure.detail };
  }
  if (result && result.key === key) {
    return {
      status: 'ready',
      canvas: result.canvas,
      engine: result.engine,
      requestedEngine: result.requestedEngine,
      fallbackReason: result.fallbackReason,
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
    };
  }
  // A previous frame for the same image stays visible while the next one renders; a different
  // image is not shown, because that would be a stale photograph under the current controls.
  return {
    status: 'loading',
    canvas: result && result.href === href ? result.canvas : null,
  };
}

/** Decodes the source at full size for export, without the preview cap. */
export async function decodeForExport(href: string): Promise<Result<DecodedPhoto>> {
  return decode(href);
}
