'use client';

import { CirclePlay, Layers, Pause, Plus, SkipBack, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { addLayerCommand } from '../../core/editor/commands';
import type { Layer } from '../../core/documents/layer-types';
import type { MotionPayload, MotionProperty } from '../../core/documents/payload';
import {
  deleteMotionLayerCommand,
  motionHasAnimation,
  moveKeyframeCommand,
  setMotionTimingCommand,
} from '../../core/motion/commands';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/field';
import { InlineNote } from '../ui/states';
import { AssistantUnavailable } from '../assistant/assistant-unavailable';
import { HistoryPanel } from '../workspace/history-panel';
import type { WorkspaceApi } from '../workspace/workspace-api';
import { KeyframePanel } from './keyframe-panel';
import { MotionExportPanel } from './motion-export-panel';
import { MotionStage } from './motion-stage';
import { MotionTimeline, type TimelineSelection } from './motion-timeline';
import { useMotionPlayback } from './use-motion-playback';

/** True for the document type Motion Studio owns. */
export function isMotionDocument(documentTypeId: string): boolean {
  return documentTypeId === 'motion.scene';
}

/**
 * The Motion Studio workspace.
 *
 * Composition preview and transport on the left, layers/keyframes/export on the right, timeline
 * underneath. The playhead is component state (ADR-0017): it is an observation, not part of the
 * document, and moving it never creates a history entry. The composition's length and frame rate
 * *are* document state and go through the same command path as every other edit.
 */
export function MotionWorkspace({
  api,
  payload,
  history,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  readonly api: WorkspaceApi;
  readonly payload: MotionPayload;
  readonly history: readonly { readonly id: number; readonly label: string }[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}) {
  const layers = api.doc.scene.layers;
  const [layerId, setLayerId] = useState<string | null>(layers[0] ? String(layers[0].id) : null);
  const [property, setProperty] = useState<MotionProperty>('x');
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const playback = useMotionPlayback({ duration: payload.duration, fps: payload.fps });

  // Derived, not synchronised in an effect: a layer deleted by any means (this panel, undo, another
  // tab) must not stay selected, and the panel should simply fall back to the first layer that is
  // still there.
  const activeLayerId =
    layerId && layers.some((layer) => String(layer.id) === layerId)
      ? layerId
      : layers[0]
        ? String(layers[0].id)
        : null;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (typing) return;
      if (event.code === 'Space') {
        event.preventDefault();
        playback.toggle();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        playback.step(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [playback]);

  function add(layerType: 'text' | 'rect' | 'ellipse'): void {
    const command = addLayerCommand(api.doc, layerType);
    if (!command.ok) {
      void api.run(command);
      return;
    }
    // The new layer comes from the command's own patch: reading `api.doc` inside the callback would
    // see the document from the render that created this closure, not the one that was committed.
    const added = command.value.patch.scene?.layers.at(-1);
    void api.run(command).then((applied) => {
      if (applied && added) setLayerId(String(added.id));
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-5">
        <div className="space-y-3">
          <MotionStage doc={api.doc} time={playback.time} />
          <Transport
            time={playback.time}
            duration={payload.duration}
            fps={payload.fps}
            playing={playback.playing}
            onToggle={playback.toggle}
            onStep={playback.step}
            onSeek={playback.seek}
          />
        </div>
        <MotionTimeline
          payload={payload}
          layers={layers}
          time={playback.time}
          selection={selection}
          onSeek={playback.seek}
          onSelect={(next) => {
            setSelection(next);
            setLayerId(next.layerId);
            setProperty(next.property);
          }}
          onMoveKeyframe={(trackLayerId, trackProperty, keyframeId, time) => {
            void api.run(
              moveKeyframeCommand(api.doc, {
                layerId: trackLayerId,
                property: trackProperty,
                keyframeId,
                time,
              }),
            );
          }}
        />
        {payload.tracks.length === 0 ? (
          <InlineNote tone="tip" title="Start with one layer and two keyframes">
            <p>
              Add a layer, choose a property, then add a keyframe at 0 s and another at the end of
              the composition. The preview, the timeline and the export all read the same evaluated
              scene, so what you scrub is what the frames contain.
            </p>
          </InlineNote>
        ) : null}
      </div>

      <aside
        aria-label="Motion inspector"
        className="forge-scroll min-w-0 space-y-7 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:pr-1"
      >
        <LayersPanel
          layers={layers}
          layerId={activeLayerId}
          onSelect={(next) => {
            setLayerId(next);
            setSelection(null);
          }}
          onAdd={add}
          onDelete={() => {
            if (!activeLayerId) return;
            const command = deleteMotionLayerCommand(api.doc, activeLayerId);
            void api.run(command);
            setSelection(null);
          }}
        />
        <KeyframePanel
          api={api}
          payload={payload}
          layers={layers}
          time={playback.time}
          layerId={activeLayerId}
          property={property}
          selectedKeyframeId={selection?.keyframeId ?? null}
          onSelectLayer={(next) => {
            setLayerId(next);
            setSelection(null);
          }}
          onSelectProperty={(next) => {
            setProperty(next);
            setSelection(null);
          }}
          onSelectKeyframe={(keyframeId) => {
            if (!activeLayerId) return;
            setSelection(keyframeId ? { layerId: activeLayerId, property, keyframeId } : null);
            const keyframe = keyframeId
              ? payload.tracks
                  .find((track) => track.layerId === activeLayerId && track.property === property)
                  ?.keyframes.find((candidate) => candidate.id === keyframeId)
              : null;
            if (keyframe) playback.seek(keyframe.time);
          }}
        />
        <TimingPanel api={api} payload={payload} />
        <MotionExportPanel doc={api.doc} payload={payload} />
        <AssistantUnavailable studio="motion" />
        <HistoryPanel
          labels={history}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      </aside>
    </div>
  );
}

function Transport({
  time,
  duration,
  fps,
  playing,
  onToggle,
  onStep,
  onSeek,
}: {
  readonly time: number;
  readonly duration: number;
  readonly fps: number;
  readonly playing: boolean;
  readonly onToggle: () => void;
  readonly onStep: (direction: 1 | -1) => void;
  readonly onSeek: (time: number) => void;
}) {
  const frame = Math.round(time * fps);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Playback" className="flex items-center gap-1.5">
        <Button size="sm" variant="quiet" aria-label="Go to start" onClick={() => onSeek(0)}>
          <SkipBack className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label={playing ? 'Pause' : 'Play'}
          iconLeft={playing ? <Pause aria-hidden /> : <CirclePlay aria-hidden />}
          onClick={onToggle}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button size="sm" variant="quiet" aria-label="Previous frame" onClick={() => onStep(-1)}>
          −1f
        </Button>
        <Button size="sm" variant="quiet" aria-label="Next frame" onClick={() => onStep(1)}>
          +1f
        </Button>
      </div>
      <label className="flex min-w-[12rem] flex-1 items-center gap-2">
        <span className="text-fg-subtle text-xs">Playhead</span>
        <input
          type="range"
          min={0}
          max={duration}
          step={1 / fps}
          value={time}
          aria-label="Playhead"
          className="accent-accent w-full"
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </label>
      <p className="forge-numeric text-fg-muted text-xs" data-testid="motion-time">
        {time.toFixed(2)}s · frame {frame} · {duration.toFixed(2)}s total
      </p>
    </div>
  );
}

function LayersPanel({
  layers,
  layerId,
  onSelect,
  onAdd,
  onDelete,
}: {
  readonly layers: readonly Layer[];
  readonly layerId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onAdd: (type: 'text' | 'rect' | 'ellipse') => void;
  readonly onDelete: () => void;
}) {
  return (
    <section aria-labelledby="motion-layers-heading" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3
          id="motion-layers-heading"
          className="text-2xs text-fg-subtle flex items-center gap-1.5 font-semibold tracking-wider uppercase"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden /> Layers
        </h3>
        <span className="text-fg-subtle forge-numeric text-[10px]">{layers.length}</span>
      </div>
      <div role="group" aria-label="Add a layer" className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Plus aria-hidden />}
          onClick={() => onAdd('text')}
        >
          Text
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onAdd('rect')}>
          Rectangle
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onAdd('ellipse')}>
          Ellipse
        </Button>
        <Button
          size="sm"
          variant="quiet"
          iconLeft={<Trash2 aria-hidden />}
          disabled={layerId === null}
          aria-label="Delete the selected layer"
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
      {layers.length === 0 ? (
        <p className="border-line-subtle text-fg-subtle rounded-sm border border-dashed px-3 py-3 text-xs">
          This composition is empty. Add text or a shape to animate.
        </p>
      ) : (
        <ul aria-label="Composition layers" className="space-y-1">
          {[...layers].reverse().map((layer) => (
            <li key={String(layer.id)}>
              <button
                type="button"
                aria-pressed={String(layer.id) === layerId}
                onClick={() => onSelect(String(layer.id))}
                className={
                  String(layer.id) === layerId
                    ? 'border-accent bg-accent/10 text-fg w-full rounded-sm border px-2 py-1.5 text-left text-xs'
                    : 'border-line text-fg-muted hover:border-line-strong w-full rounded-sm border px-2 py-1.5 text-left text-xs'
                }
              >
                {layer.name}
                <span className="text-fg-subtle ml-1.5 text-[10px] uppercase">{layer.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TimingPanel({
  api,
  payload,
}: {
  readonly api: WorkspaceApi;
  readonly payload: MotionPayload;
}) {
  const [duration, setDuration] = useState(String(payload.duration));
  const [fps, setFps] = useState(String(payload.fps));
  const [error, setError] = useState<string | null>(null);

  function apply(): void {
    const result = setMotionTimingCommand(api.doc, {
      duration: Number(duration),
      fps: Number(fps),
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    void api.run(result);
  }

  return (
    <section aria-labelledby="motion-timing-heading" className="space-y-2">
      <div>
        <h3
          id="motion-timing-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Composition
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          {payload.duration.toFixed(2)} s at {payload.fps} fps ·{' '}
          {motionHasAnimation(payload) ? 'animated' : 'no animation yet'}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Length (s)">
          <Input
            type="number"
            min={0.5}
            max={120}
            step={0.5}
            value={duration}
            aria-label="Composition length"
            onChange={(event) => {
              setDuration(event.target.value);
            }}
            onBlur={apply}
          />
        </Field>
        <Field label="Frame rate">
          <Input
            type="number"
            min={1}
            max={60}
            step={1}
            value={fps}
            aria-label="Composition frame rate"
            onChange={(event) => {
              setFps(event.target.value);
            }}
            onBlur={apply}
          />
        </Field>
      </div>
      {error ? (
        <InlineNote tone="warning" title="That change was not applied">
          <p>{error}</p>
        </InlineNote>
      ) : null}
    </section>
  );
}
