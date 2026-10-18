'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { VideoPayload, VideoTrack } from '../../core/documents/payload';
import { clipEnd, isTitleClip, type TimelineClip } from '../../core/video/timeline';
import { moveClipCommand, trimClipCommand } from '../../core/video/commands';
import { cn } from '../../lib/cn';
import type { WorkspaceApi } from '../workspace/workspace-api';

export type VideoSelection = { readonly clipId: string } | null;

type Drag =
  | {
      readonly kind: 'move';
      readonly clipId: string;
      readonly originX: number;
      readonly originStart: number;
    }
  | {
      readonly kind: 'trim-start' | 'trim-end';
      readonly clipId: string;
      readonly originX: number;
      readonly originValue: number;
    }
  | { readonly kind: 'scrub'; readonly originX: number };

const PX_PER_SECOND = 56;

function clipName(clip: TimelineClip): string {
  if (isTitleClip(clip)) return clip.text;
  return clip.name;
}

function trackLabel(track: VideoTrack): string {
  return `${track.name}, ${track.kind} track, ${String(track.clips.length)} clip${track.clips.length === 1 ? '' : 's'}`;
}

/**
 * The timeline.
 *
 * Clips are absolutely positioned from their times, so the picture is the model: a clip that is one
 * second long is 56 px wide at every zoom level, and the playhead's left offset is `time × 56`. Drags
 * preview locally and commit once on release — a history entry per pointer move would make undo
 * useless (ADR-0017). Trim handles are separate controls so a click on a clip selects it while a
 * click on an edge trims it.
 */
export function VideoTimeline({
  api,
  payload,
  time,
  selection,
  onSelect,
  onSeek,
  onStep,
}: {
  readonly api: WorkspaceApi;
  readonly payload: VideoPayload;
  readonly time: number;
  readonly selection: VideoSelection;
  readonly onSelect: (selection: VideoSelection) => void;
  readonly onSeek: (time: number) => void;
  /** Steps by frames, as an accumulating update — a burst of key presses must not collapse. */
  readonly onStep: (frames: number) => void;
}) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<{
    readonly start: number;
    readonly duration: number;
  } | null>(null);
  const width = Math.max(payload.duration * PX_PER_SECOND, 240);

  const clipById = useCallback(
    (clipId: string): TimelineClip | null => {
      for (const track of payload.tracks) {
        const found = track.clips.find((clip) => clip.id === clipId);
        if (found) return found;
      }
      return null;
    },
    [payload.tracks],
  );

  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent): void => {
      if (drag.kind === 'scrub') {
        const rect = laneRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return;
        const ratio = (event.clientX - rect.left) / rect.width;
        onSeek(Math.min(payload.duration, Math.max(0, ratio * payload.duration)));
        return;
      }
      const clip = clipById(drag.clipId);
      if (!clip) return;
      const deltaSeconds = (event.clientX - drag.originX) / PX_PER_SECOND;

      if (drag.kind === 'move') {
        const start = Math.min(
          Math.max(payload.duration - clip.duration, 0),
          Math.max(0, drag.originStart + deltaSeconds),
        );
        setPreview({ start: Math.round(start * 1000) / 1000, duration: clip.duration });
        return;
      }
      if (drag.kind === 'trim-start') {
        const start = Math.min(Math.max(drag.originValue + deltaSeconds, 0), clipEnd(clip) - 0.1);
        const duration = clipEnd(clip) - start;
        setPreview({
          start: Math.round(start * 1000) / 1000,
          duration: Math.round(duration * 1000) / 1000,
        });
        return;
      }
      const end = Math.max(drag.originValue + deltaSeconds, clip.start + 0.1);
      setPreview({
        start: clip.start,
        duration: Math.round((Math.min(end, payload.duration) - clip.start) * 1000) / 1000,
      });
    };

    const onUp = (): void => {
      const clip = 'clipId' in drag ? clipById(drag.clipId) : null;
      if (clip && preview) {
        if (drag.kind === 'move') {
          if (Math.abs(preview.start - clip.start) > 0.001) {
            void api.run(moveClipCommand(api.doc, { clipId: clip.id, toStart: preview.start }));
          }
        } else if (drag.kind === 'trim-start') {
          void api.run(
            trimClipCommand(api.doc, { clipId: clip.id, edge: 'start', to: preview.start }),
          );
        } else if (drag.kind === 'trim-end') {
          void api.run(
            trimClipCommand(api.doc, {
              clipId: clip.id,
              edge: 'end',
              to: preview.start + preview.duration,
            }),
          );
        }
      }
      setDrag(null);
      setPreview(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [api, clipById, drag, onSeek, payload.duration, preview]);

  return (
    <section aria-labelledby="video-timeline-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="video-timeline-heading" className="text-fg text-sm font-medium">
          Timeline
        </h2>
        <p className="text-fg-subtle text-2xs">
          Drag a clip to move it, drag an edge to trim, drag the ruler to scrub. One drag is one
          undo step.
        </p>
      </div>

      <div className="border-ink-800 bg-ink-950 overflow-x-auto rounded-lg border">
        <div
          ref={laneRef}
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={payload.duration}
          aria-valuenow={Number(time.toFixed(2))}
          aria-valuetext={`${time.toFixed(2)} seconds`}
          className="border-ink-800 relative h-7 cursor-crosshair border-b"
          style={{ width }}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (rect.width === 0) return;
            onSeek(
              Math.min(
                payload.duration,
                Math.max(0, ((event.clientX - rect.left) / rect.width) * payload.duration),
              ),
            );
            setDrag({ kind: 'scrub', originX: event.clientX });
          }}
          onKeyDown={(event) => {
            // The workspace also listens for arrow keys; without stopping propagation here a press
            // on the focused ruler would move the playhead twice.
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              event.stopPropagation();
              onStep(-1);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              event.stopPropagation();
              onStep(1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              event.stopPropagation();
              onSeek(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              event.stopPropagation();
              onSeek(payload.duration);
            }
          }}
        >
          {Array.from({ length: Math.floor(payload.duration) + 1 }, (_, second) => (
            <span
              key={second}
              className="border-ink-800 text-fg-subtle text-2xs absolute top-0 h-full border-l pl-1"
              style={{ left: second * PX_PER_SECOND }}
            >
              {second}s
            </span>
          ))}
          <div
            aria-hidden
            className="bg-accent pointer-events-none absolute top-0 h-full w-px"
            style={{ left: time * PX_PER_SECOND }}
          />
        </div>

        <div className="divide-ink-800 divide-y">
          {payload.tracks.map((track) => (
            <div key={track.id} className="flex items-stretch">
              <div className="border-ink-800 w-32 shrink-0 border-r px-2 py-1.5">
                <p className="text-fg text-2xs truncate font-medium">{track.name}</p>
                <p className="text-fg-subtle text-2xs capitalize">{track.kind}</p>
              </div>
              <div
                className="relative h-12"
                style={{ width }}
                aria-label={trackLabel(track)}
                data-testid={`video-track-${track.id}`}
              >
                {track.clips.map((clip) => {
                  const selected = selection?.clipId === clip.id;
                  const draggingThisClip =
                    drag !== null && drag.kind !== 'scrub' && drag.clipId === clip.id;
                  const shown =
                    draggingThisClip && preview
                      ? preview
                      : { start: clip.start, duration: clip.duration };
                  return (
                    <div
                      key={clip.id}
                      className={cn(
                        'text-2xs absolute top-1.5 h-9 overflow-hidden rounded-sm border',
                        clip.kind === 'title'
                          ? 'border-amber-500/60 bg-amber-500/20'
                          : clip.kind === 'audio'
                            ? 'border-emerald-500/60 bg-emerald-500/20'
                            : 'border-sky-500/60 bg-sky-500/20',
                        selected && 'ring-accent ring-1',
                      )}
                      style={{
                        left: shown.start * PX_PER_SECOND,
                        width: Math.max(shown.duration * PX_PER_SECOND, 10),
                      }}
                    >
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${clipName(clip)} at ${clip.start.toFixed(2)} seconds`}
                        className="h-full w-full px-1.5 text-left"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          onSelect({ clipId: clip.id });
                          if (event.button !== 0) return;
                          setDrag({
                            kind: 'move',
                            clipId: clip.id,
                            originX: event.clientX,
                            originStart: clip.start,
                          });
                        }}
                      >
                        <span className="text-fg block truncate font-medium">{clipName(clip)}</span>
                        <span className="text-fg-subtle block truncate font-mono">
                          {shown.start.toFixed(2)}–{(shown.start + shown.duration).toFixed(2)}s
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Trim start of ${clipName(clip)}`}
                        className="hover:bg-accent/40 absolute top-0 left-0 h-full w-1.5 cursor-ew-resize"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelect({ clipId: clip.id });
                          setDrag({
                            kind: 'trim-start',
                            clipId: clip.id,
                            originX: event.clientX,
                            originValue: clip.start,
                          });
                        }}
                      />
                      <button
                        type="button"
                        aria-label={`Trim end of ${clipName(clip)}`}
                        className="hover:bg-accent/40 absolute top-0 right-0 h-full w-1.5 cursor-ew-resize"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelect({ clipId: clip.id });
                          setDrag({
                            kind: 'trim-end',
                            clipId: clip.id,
                            originX: event.clientX,
                            originValue: clipEnd(clip),
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
