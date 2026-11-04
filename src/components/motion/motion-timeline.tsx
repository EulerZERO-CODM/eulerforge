'use client';

import { useRef, useState } from 'react';

import type { MotionPayload, MotionProperty, MotionTrack } from '../../core/documents/payload';
import { MOTION_PROPERTY_INFO } from '../../core/documents/payload';
import type { Layer } from '../../core/documents/layer-types';
import { cn } from '../../lib/cn';

export type TimelineSelection = {
  readonly layerId: string;
  readonly property: MotionProperty;
  readonly keyframeId: string;
};

/**
 * The timeline.
 *
 * A lane per animated property, with the playhead over them. Times are the composition's own
 * seconds — the ruler is not a scrollable track view, because a five-second title does not need one
 * and a fake zoom control would be a control that does nothing.
 *
 * A keyframe is a button, so it can be reached by keyboard and named by a screen reader. Dragging it
 * previews the new time locally and commits once on release through the workspace's command, which
 * keeps one drag equal to one history entry.
 */
export function MotionTimeline({
  payload,
  layers,
  time,
  selection,
  onSeek,
  onSelect,
  onMoveKeyframe,
}: {
  readonly payload: MotionPayload;
  readonly layers: readonly Layer[];
  readonly time: number;
  readonly selection: TimelineSelection | null;
  readonly onSeek: (time: number) => void;
  readonly onSelect: (selection: TimelineSelection) => void;
  readonly onMoveKeyframe: (
    layerId: string,
    property: MotionProperty,
    keyframeId: string,
    time: number,
  ) => void;
}) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ keyframeId: string; time: number } | null>(null);
  const layerNames = new Map(layers.map((layer) => [String(layer.id), layer.name]));

  function timeFromPointer(event: { clientX: number }): number {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    // Quantised to the millisecond, then clamped by the command itself.
    return Math.round(ratio * payload.duration * 1000) / 1000;
  }

  const ticks = rulerTicks(payload.duration);
  const playheadPercent = payload.duration > 0 ? (time / payload.duration) * 100 : 0;

  return (
    <section aria-labelledby="motion-timeline-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3
          id="motion-timeline-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Timeline
        </h3>
        <p className="forge-numeric text-fg-subtle text-xs">
          {payload.tracks.length} animated {payload.tracks.length === 1 ? 'property' : 'properties'}{' '}
          · {payload.fps} fps
        </p>
      </div>

      <div className="border-line bg-surface-raised/30 rounded-md border p-2">
        <div
          ref={rulerRef}
          role="presentation"
          data-testid="motion-ruler"
          onPointerDown={(event) => {
            onSeek(timeFromPointer(event));
          }}
          className="border-line-subtle relative h-6 cursor-pointer border-b"
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className="text-fg-subtle forge-numeric absolute -translate-x-1/2 text-[10px]"
              style={{ left: `${String((tick / payload.duration) * 100)}%`, top: 0 }}
            >
              {formatSeconds(tick)}
            </span>
          ))}
          <span
            aria-hidden
            data-testid="motion-playhead"
            className="bg-accent pointer-events-none absolute top-0 bottom-0 w-px"
            style={{ left: `${String(playheadPercent)}%` }}
          />
        </div>

        {payload.tracks.length === 0 ? (
          <p className="text-fg-subtle px-1 py-4 text-xs">
            No animation yet. Choose a layer and a property, then add a keyframe at the playhead.
          </p>
        ) : (
          <ul aria-label="Animation tracks" className="mt-1 space-y-1">
            {payload.tracks.map((track) => (
              <TimelineRow
                key={`${track.layerId}:${track.property}`}
                track={track}
                label={`${layerNames.get(track.layerId) ?? 'Missing layer'} · ${MOTION_PROPERTY_INFO[track.property].label}`}
                duration={payload.duration}
                fps={payload.fps}
                selection={selection}
                dragging={dragging}
                onDragTime={setDragging}
                onSeek={onSeek}
                onSelect={onSelect}
                onMoveKeyframe={onMoveKeyframe}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TimelineRow({
  track,
  label,
  duration,
  fps,
  selection,
  dragging,
  onDragTime,
  onSeek,
  onSelect,
  onMoveKeyframe,
}: {
  readonly track: MotionTrack;
  readonly label: string;
  readonly duration: number;
  readonly fps: number;
  readonly selection: TimelineSelection | null;
  readonly dragging: { keyframeId: string; time: number } | null;
  readonly onDragTime: (value: { keyframeId: string; time: number } | null) => void;
  readonly onSeek: (time: number) => void;
  readonly onSelect: (selection: TimelineSelection) => void;
  readonly onMoveKeyframe: (
    layerId: string,
    property: MotionProperty,
    keyframeId: string,
    time: number,
  ) => void;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ pointerId: number; keyframeId: string } | null>(null);

  function laneTime(event: { clientX: number }): number {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return Math.round(ratio * duration * 1000) / 1000;
  }

  return (
    <li className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)] items-center gap-2">
      <span className="text-fg-muted truncate text-xs" title={label}>
        {label}
      </span>
      <div
        ref={laneRef}
        className="bg-ink-950 border-line-subtle relative h-7 rounded-sm border"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          onSeek(laneTime(event));
        }}
      >
        {track.keyframes.map((keyframe) => {
          const previewTime = dragging?.keyframeId === keyframe.id ? dragging.time : keyframe.time;
          const selected =
            selection?.layerId === track.layerId &&
            selection.property === track.property &&
            selection.keyframeId === keyframe.id;
          return (
            <button
              key={keyframe.id}
              type="button"
              aria-label={`${MOTION_PROPERTY_INFO[track.property].label} keyframe at ${keyframe.time.toFixed(2)} seconds`}
              aria-pressed={selected}
              data-testid={`keyframe-${keyframe.id}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect({
                  layerId: track.layerId,
                  property: track.property,
                  keyframeId: keyframe.id,
                });
                onSeek(previewTime);
                dragOrigin.current = { pointerId: event.pointerId, keyframeId: keyframe.id };
                const target = event.currentTarget;
                const move = (moveEvent: PointerEvent): void => {
                  onDragTime({ keyframeId: keyframe.id, time: laneTime(moveEvent) });
                };
                const up = (upEvent: PointerEvent): void => {
                  target.removeEventListener('pointermove', move);
                  target.removeEventListener('pointerup', up);
                  target.removeEventListener('pointercancel', up);
                  const next = laneTime(upEvent);
                  onDragTime(null);
                  dragOrigin.current = null;
                  if (Math.abs(next - keyframe.time) >= 1 / fps / 2) {
                    onMoveKeyframe(track.layerId, track.property, keyframe.id, next);
                  }
                };
                target.addEventListener('pointermove', move);
                target.addEventListener('pointerup', up);
                target.addEventListener('pointercancel', up);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const delta = (event.key === 'ArrowLeft' ? -1 : 1) / fps;
                onMoveKeyframe(
                  track.layerId,
                  track.property,
                  keyframe.id,
                  Math.round((keyframe.time + delta) * 1000) / 1000,
                );
                onSeek(Math.round((keyframe.time + delta) * 1000) / 1000);
              }}
              className={cn(
                'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border transition-colors',
                'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
                selected
                  ? 'border-accent bg-accent'
                  : 'border-accent/70 bg-surface hover:bg-accent/40',
              )}
              style={{ left: `${String(duration > 0 ? (previewTime / duration) * 100 : 0)}%` }}
            />
          );
        })}
      </div>
    </li>
  );
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

/** A tick every half second, plus the end of the composition. */
function rulerTicks(duration: number): readonly number[] {
  const step = duration <= 4 ? 0.5 : duration <= 10 ? 1 : 2;
  const ticks: number[] = [];
  for (let time = 0; time < duration - 1e-9; time += step) {
    ticks.push(Math.round(time * 100) / 100);
  }
  ticks.push(duration);
  return ticks;
}
