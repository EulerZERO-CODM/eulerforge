'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { MotionEasing, MotionPayload, MotionProperty } from '../../core/documents/payload';
import {
  MOTION_EASING_PRESETS,
  MOTION_PROPERTIES,
  MOTION_PROPERTY_INFO,
} from '../../core/documents/payload';
import type { Layer } from '../../core/documents/layer-types';
import {
  addKeyframeCommand,
  findKeyframe,
  removeKeyframeCommand,
  setKeyframeEasingCommand,
  setKeyframeValueCommand,
} from '../../core/motion/commands';
import { cubicEasing, easingPoints } from '../../core/motion/easing';
import { evaluateProperty } from '../../core/motion/evaluate';
import { Button } from '../ui/button';
import { Field, Input, Select } from '../ui/field';
import { InlineNote } from '../ui/states';
import { EasingCurveEditor } from './easing-curve-editor';
import type { WorkspaceApi } from '../workspace/workspace-api';

/**
 * Property and keyframe editing.
 *
 * The value field starts at what the scene currently evaluates to, so adding a keyframe at the
 * playhead pins the picture the user is looking at rather than jumping to zero. The easing editor
 * writes one command when a drag ends, and the four numbers under the curve are a keyboard path to
 * the same values.
 */
export function KeyframePanel({
  api,
  payload,
  layers,
  time,
  layerId,
  property,
  selectedKeyframeId,
  onSelectLayer,
  onSelectProperty,
  onSelectKeyframe,
}: {
  readonly api: WorkspaceApi;
  readonly payload: MotionPayload;
  readonly layers: readonly Layer[];
  readonly time: number;
  readonly layerId: string | null;
  readonly property: MotionProperty;
  readonly selectedKeyframeId: string | null;
  readonly onSelectLayer: (layerId: string) => void;
  readonly onSelectProperty: (property: MotionProperty) => void;
  readonly onSelectKeyframe: (keyframeId: string | null) => void;
}) {
  const layer = layers.find((candidate) => String(candidate.id) === layerId) ?? null;
  const evaluated = layer ? evaluateProperty(layer, payload, property, time) : 0;
  const [draftValue, setDraftValue] = useState<string>(evaluated.toFixed(2));
  const [error, setError] = useState<string | null>(null);

  const track = payload.tracks.find(
    (candidate) => candidate.layerId === layerId && candidate.property === property,
  );
  const keyframes = track?.keyframes ?? [];
  const selected = selectedKeyframeId ? findKeyframe(payload, selectedKeyframeId) : null;
  const editable =
    selected && selected.layerId === layerId && selected.property === property
      ? selected.keyframe
      : null;

  function report(result: { ok: boolean; error?: { message: string } }): void {
    if (result.ok) {
      setError(null);
      return;
    }
    setError(result.error?.message ?? 'That edit was not applied.');
  }

  return (
    <section aria-labelledby="motion-keyframe-heading" className="space-y-3">
      <div>
        <h3
          id="motion-keyframe-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Property and keyframes
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          Keyframe values are absolute: position in document pixels, scale as a multiplier, opacity
          between 0 and 1.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Layer">
          <Select
            value={layerId ?? ''}
            onChange={(event) => {
              onSelectLayer(event.target.value);
              onSelectKeyframe(null);
            }}
            options={[
              { value: '', label: layers.length === 0 ? 'No layers yet' : 'Choose a layer' },
              ...layers.map((candidate) => ({
                value: String(candidate.id),
                label: candidate.name,
              })),
            ]}
          />
        </Field>
        <Field label="Property">
          <Select
            value={property}
            onChange={(event) => {
              const next = MOTION_PROPERTIES.find((candidate) => candidate === event.target.value);
              if (next) {
                onSelectProperty(next);
                onSelectKeyframe(null);
              }
            }}
            options={MOTION_PROPERTIES.map((candidate) => ({
              value: candidate,
              label: MOTION_PROPERTY_INFO[candidate].label,
            }))}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label="Value" labelSuffix={MOTION_PROPERTY_INFO[property].label}>
          <Input
            type="number"
            aria-label="Keyframe value"
            value={draftValue}
            step={MOTION_PROPERTY_INFO[property].step}
            onChange={(event) => {
              setDraftValue(event.target.value);
            }}
          />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Plus aria-hidden />}
          disabled={layer === null}
          onClick={() => {
            if (!layer) return;
            const parsed = Number(draftValue);
            const result = addKeyframeCommand(api.doc, {
              layerId: String(layer.id),
              property,
              time,
              value: Number.isFinite(parsed) ? parsed : evaluated,
            });
            report(result);
            if (result.ok) void api.run(result);
          }}
        >
          Add keyframe at {time.toFixed(2)}s
        </Button>
      </div>

      {error ? (
        <InlineNote tone="danger" title="That edit was not applied">
          <p>{error}</p>
        </InlineNote>
      ) : null}

      {keyframes.length === 0 ? (
        <p className="border-line-subtle text-fg-subtle rounded-sm border border-dashed px-3 py-3 text-xs">
          This property is not animated. Add a keyframe at the playhead, move the playhead and add
          another to create a segment.
        </p>
      ) : (
        <ol aria-label="Keyframes" className="space-y-1.5">
          {keyframes.map((keyframe) => (
            <li
              key={keyframe.id}
              className="border-line flex items-center gap-2 rounded-sm border px-2 py-1.5"
            >
              <button
                type="button"
                aria-pressed={keyframe.id === selectedKeyframeId}
                aria-label={`Select keyframe at ${keyframe.time.toFixed(2)} seconds`}
                onClick={() => {
                  onSelectKeyframe(keyframe.id);
                }}
                className={
                  keyframe.id === selectedKeyframeId
                    ? 'forge-numeric text-accent text-xs underline'
                    : 'forge-numeric text-fg-muted hover:text-fg text-xs underline'
                }
              >
                {keyframe.time.toFixed(2)}s
              </button>
              <span className="forge-numeric text-fg-subtle text-xs">
                {keyframe.value.toFixed(2)}
              </span>
              <span className="text-fg-subtle ml-auto text-[10px] uppercase">
                {keyframe.easing.kind}
              </span>
              <button
                type="button"
                aria-label={`Delete keyframe at ${keyframe.time.toFixed(2)} seconds`}
                onClick={() => {
                  const result = removeKeyframeCommand(api.doc, {
                    layerId: layerId ?? '',
                    property,
                    keyframeId: keyframe.id,
                  });
                  report(result);
                  if (result.ok) void api.run(result);
                  if (keyframe.id === selectedKeyframeId) onSelectKeyframe(null);
                }}
                className="text-fg-subtle hover:text-danger rounded-sm p-1"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}

      {editable ? (
        <div className="border-line space-y-3 rounded-sm border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-fg-muted text-xs">Segment easing at {editable.time.toFixed(2)}s</p>
            <span className="text-fg-subtle text-[10px] uppercase">one change per drag</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <EasingCurveEditor
              easing={editable.easing}
              onChange={(easing: MotionEasing) => {
                const result = setKeyframeEasingCommand(api.doc, {
                  layerId: layerId ?? '',
                  property,
                  keyframeId: editable.id,
                  easing,
                });
                report(result);
                if (result.ok) void api.run(result);
              }}
            />
            <div className="space-y-2">
              <Field label="Preset">
                <Select
                  value={editable.easing.kind}
                  onChange={(event) => {
                    const kind = MOTION_EASING_PRESETS.find(
                      (preset) => preset.kind === event.target.value,
                    );
                    if (!kind) return;
                    const easing: MotionEasing =
                      kind.kind === 'cubic'
                        ? cubicEasing(
                            easingPoints(editable.easing) ?? {
                              x1: 0.42,
                              y1: 0,
                              x2: 0.58,
                              y2: 1,
                            },
                          )
                        : { kind: kind.kind };
                    const result = setKeyframeEasingCommand(api.doc, {
                      layerId: layerId ?? '',
                      property,
                      keyframeId: editable.id,
                      easing,
                    });
                    report(result);
                    if (result.ok) void api.run(result);
                  }}
                  options={MOTION_EASING_PRESETS.map((preset) => ({
                    value: preset.kind,
                    label: preset.label,
                  }))}
                />
              </Field>
              <Field label="Value">
                <Input
                  type="number"
                  aria-label="Selected keyframe value"
                  defaultValue={String(editable.value)}
                  key={editable.id + String(editable.value)}
                  onBlur={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    const result = setKeyframeValueCommand(api.doc, {
                      layerId: layerId ?? '',
                      property,
                      keyframeId: editable.id,
                      value,
                    });
                    report(result);
                    if (result.ok) void api.run(result);
                  }}
                />
              </Field>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
