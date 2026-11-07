'use client';

import { useEffect, useRef, useState } from 'react';

import type { VideoMedia, VideoPayload } from '../../core/documents/payload';
import type { ForgeDocument } from '../../core/documents/types';
import { evaluateVideoAt } from '../../core/video/evaluate';
import { paintVideoFrame, type VideoMediaPool } from '../../lib/browser/video-engine';
import { cn } from '../../lib/cn';

/**
 * The composition preview.
 *
 * The canvas is the document's size; CSS scales it to the panel, so what is sampled here is exactly
 * what the frame exporter paints at scale 1. While the transport runs, decoded elements play in real
 * time and the stage only corrects drift when it is visible; while paused, the stage seeks to the
 * exact time so scrubbing and frame-stepping show that frame and nothing else.
 */
export function VideoStage({
  document: doc,
  payload,
  time,
  playing,
  pool,
  onTimeChange,
}: {
  readonly document: ForgeDocument;
  readonly payload: VideoPayload;
  readonly time: number;
  readonly playing: boolean;
  readonly pool: VideoMediaPool;
  readonly onTimeChange: (time: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [waiting, setWaiting] = useState(false);

  // Paint whenever the document, the playhead or the transport changes. Painting is synchronous once
  // the elements hold the right frame, so the effect only awaits the seeks it actually needs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = doc.canvas.width;
    canvas.height = doc.canvas.height;

    const evaluated = evaluateVideoAt(doc, time);
    if (!evaluated.ok) return;
    const state = evaluated.value;

    let cancelled = false;

    const paint = async (): Promise<void> => {
      // The first paint happens immediately with whatever is decoded; then each element is brought to
      // the exact source time and the frame is painted again.
      paintVideoFrame(context, state, pool);
      if (state.videos.length === 0) return;

      let neededSeek = !playing;
      for (const video of state.videos) {
        const element = pool.peek(video.media.id);
        if (!element) {
          neededSeek = true;
          continue;
        }
        if (!playing || Math.abs(element.currentTime - video.sourceTime) > 0.2) neededSeek = true;
      }
      if (!neededSeek) return;

      if (!playing) {
        const ready = await Promise.all(
          state.videos.map(async (video) => {
            const element = await pool.ensure(video.media);
            if (!element.ok) return false;
            return pool.seek(video.media.id, video.sourceTime);
          }),
        );
        if (cancelled) return;
        setWaiting(ready.some((value) => value === false));
      }
      paintVideoFrame(context, state, pool);
    };

    void paint();

    return () => {
      cancelled = true;
    };
  }, [doc, pool, playing, time]);

  // Playing: elements run with the transport, and the transport is paused when the page hides so a
  // background tab does not keep a decoder awake.
  useEffect(() => {
    if (!playing) {
      pool.pauseAll();
      return;
    }
    const evaluated = evaluateVideoAt(doc, time);
    if (evaluated.ok) {
      for (const video of [...evaluated.value.videos, ...evaluated.value.audio]) {
        const media: VideoMedia | undefined = payload.media.find(
          (entry) => entry.id === video.media.id,
        );
        if (!media) continue;
        void pool.ensure(media);
        const element = pool.peek(media.id);
        if (element) {
          element.volume = video.volume;
          element.muted = video.volume === 0;
        }
      }
    }
    pool.playAll();
    return () => {
      pool.pauseAll();
    };
  }, [doc, payload.media, playing, pool, time]);

  // Volume follows the inspector's edits even while paused.
  useEffect(() => {
    const evaluated = evaluateVideoAt(doc, time);
    if (!evaluated.ok) return;
    for (const entry of [...evaluated.value.videos, ...evaluated.value.audio]) {
      const element = pool.peek(entry.media.id);
      if (!element) continue;
      element.volume = entry.volume;
      element.muted = entry.volume === 0;
    }
  }, [doc, pool, time]);

  const evaluatedNow = evaluateVideoAt(doc, time);
  const onScreen = evaluatedNow.ok
    ? evaluatedNow.value.videos.length + evaluatedNow.value.titles.length
    : 0;

  return (
    <div className="space-y-2">
      <div className="border-ink-800 bg-ink-950 relative overflow-hidden rounded-lg border">
        <canvas
          ref={canvasRef}
          data-testid="video-preview"
          aria-label={`Composition preview at ${time.toFixed(2)} seconds`}
          className="mx-auto block max-h-[26rem] w-auto max-w-full"
        />
        {onScreen === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-fg-subtle bg-ink-950/80 rounded px-3 py-1.5 text-xs">
              Nothing is on screen at {time.toFixed(2)} s. Add a clip or a title.
            </p>
          </div>
        ) : null}
        {waiting ? (
          <p
            data-testid="video-status"
            role="status"
            className="text-fg-subtle text-2xs absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1"
          >
            Decoding the frame at {time.toFixed(2)} s…
          </p>
        ) : null}
      </div>
      <p className="text-fg-subtle text-2xs">
        {doc.canvas.width} × {doc.canvas.height} · {payload.fps} fps ·{' '}
        <span
          data-testid="video-time"
          className={cn('font-mono', playing ? 'text-accent' : 'text-fg-muted')}
        >
          {time.toFixed(2)}s
        </span>{' '}
        of {payload.duration.toFixed(2)}s
      </p>
      <button
        type="button"
        className="text-fg-subtle hover:text-fg text-2xs underline-offset-2 hover:underline"
        onClick={() => {
          onTimeChange(0);
        }}
      >
        Back to the start
      </button>
    </div>
  );
}
