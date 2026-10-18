'use client';

import { Eraser, RotateCcw, Trash2 } from 'lucide-react';

import {
  MAX_MASK_STROKES,
  MAX_RETOUCH_STROKES,
  type PhotoPoint,
  type PhotoPayload,
} from '../../core/documents/payload';
import {
  clearMaskCommand,
  clearRetouchCommand,
  setMaskInvertedCommand,
  undoMaskStrokeCommand,
  undoRetouchCommand,
} from '../../core/photo/commands';
import { Button } from '../ui/button';
import { Field, SwitchField } from '../ui/field';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';
import { PHOTO_TOOLS, PHOTO_TOOL_INFO, type PhotoTool } from './photo-tools';

/**
 * Mask, retouch and brush controls.
 *
 * Everything that changes the photograph goes through a command (so it is one labelled undo step);
 * brush size, hardness and the tool itself are transient, exactly like a selection in the design
 * workspace — they configure the next stroke rather than describing a saved document.
 */
export function MaskPanel({
  api,
  payload,
  tool,
  onToolChange,
  radius,
  onRadiusChange,
  hardness,
  onHardnessChange,
  samplePoint,
  onSamplePointChange,
  maskVisible,
  onMaskVisibleChange,
}: {
  readonly api: WorkspaceApi;
  readonly payload: PhotoPayload;
  readonly tool: PhotoTool;
  readonly onToolChange: (tool: PhotoTool) => void;
  readonly radius: number;
  readonly onRadiusChange: (value: number) => void;
  readonly hardness: number;
  readonly onHardnessChange: (value: number) => void;
  readonly samplePoint: PhotoPoint | null;
  readonly onSamplePointChange: (point: PhotoPoint | null) => void;
  readonly maskVisible: boolean;
  readonly onMaskVisibleChange: (value: boolean) => void;
}) {
  const strokes = payload.mask?.strokes.length ?? 0;
  const retouch = payload.retouch.length;
  const info = PHOTO_TOOL_INFO[tool];

  return (
    <section aria-labelledby="photo-mask-heading" className="space-y-3">
      <div>
        <h3
          id="photo-mask-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Mask and retouch
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">{info.hint}</p>
      </div>

      <div role="group" aria-label="Photo tools" className="flex flex-wrap gap-1.5">
        {PHOTO_TOOLS.map((candidate) => (
          <Button
            key={candidate}
            size="sm"
            variant={tool === candidate ? 'primary' : 'outline'}
            aria-pressed={tool === candidate}
            onClick={() => {
              onToolChange(candidate);
            }}
          >
            {PHOTO_TOOL_INFO[candidate].label}
          </Button>
        ))}
      </div>

      {tool === 'view' ? (
        <p className="text-fg-subtle text-xs">
          Pick a mask or retouch tool to paint on the preview. Mask strokes limit the whole stack to
          the painted area; the stack still applies everywhere when there is no mask.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Brush size"
            labelSuffix={`${Math.round(radius * 100)}%`}
            hint="Share of the shorter edge."
          >
            <input
              type="range"
              min={1}
              max={40}
              step={1}
              value={Math.round(radius * 100)}
              aria-label="Brush size"
              className="accent-accent w-full"
              onChange={(event) => {
                onRadiusChange(Number(event.target.value) / 100);
              }}
            />
          </Field>
          <Field label="Hardness" labelSuffix={`${Math.round(hardness * 100)}%`}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(hardness * 100)}
              aria-label="Brush hardness"
              className="accent-accent w-full"
              onChange={(event) => {
                onHardnessChange(Number(event.target.value) / 100);
              }}
            />
          </Field>
        </div>
      )}

      <div className="border-line space-y-2.5 rounded-sm border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-fg text-sm font-medium">Mask</p>
          <p className="forge-numeric text-fg-subtle text-2xs">
            {strokes} / {MAX_MASK_STROKES} strokes
          </p>
        </div>
        <SwitchField
          label="Invert mask"
          description="Apply the stack outside the painted area instead of inside."
          checked={payload.mask?.inverted ?? false}
          disabled={strokes === 0}
          onCheckedChange={(checked) => {
            void api.run(setMaskInvertedCommand(api.doc, checked));
          }}
        />
        <SwitchField
          label="Show overlay"
          description="Displays the mask in pink. Display only — it is not part of the export."
          checked={maskVisible}
          onCheckedChange={onMaskVisibleChange}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            iconLeft={<Eraser aria-hidden />}
            disabled={strokes === 0}
            onClick={() => {
              void api.run(undoMaskStrokeCommand(api.doc));
            }}
          >
            Undo last stroke
          </Button>
          <Button
            size="sm"
            variant="outline"
            iconLeft={<Trash2 aria-hidden />}
            disabled={strokes === 0}
            onClick={() => {
              void api.run(clearMaskCommand(api.doc));
            }}
          >
            Clear mask
          </Button>
        </div>
        {strokes === 0 ? (
          <p className="text-fg-subtle text-xs">
            No mask: the stack applies to the whole photograph.
          </p>
        ) : null}
      </div>

      <div className="border-line space-y-2.5 rounded-sm border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-fg text-sm font-medium">Retouch</p>
          <p className="forge-numeric text-fg-subtle text-2xs">
            {retouch} / {MAX_RETOUCH_STROKES} strokes
          </p>
        </div>
        <p className="text-fg-subtle text-xs">
          {samplePoint
            ? `Clone source at ${Math.round(samplePoint.x * 100)}%, ${Math.round(samplePoint.y * 100)}%.`
            : 'Alt-click the preview with the clone tool to choose a source point; the default samples up and left.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            iconLeft={<RotateCcw aria-hidden />}
            disabled={!samplePoint}
            onClick={() => {
              onSamplePointChange(null);
            }}
          >
            Clear source point
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={retouch === 0}
            onClick={() => {
              void api.run(undoRetouchCommand(api.doc));
            }}
          >
            Undo last retouch
          </Button>
          <Button
            size="sm"
            variant="outline"
            iconLeft={<Trash2 aria-hidden />}
            disabled={retouch === 0}
            onClick={() => {
              void api.run(clearRetouchCommand(api.doc));
            }}
          >
            Clear retouch
          </Button>
        </div>
        {retouch > 0 ? (
          <InlineNote tone="neutral">
            <p>
              Retouch strokes are applied to the rendered pixels after the adjustment stack, so they
              survive an engine switch and appear in the export.
            </p>
          </InlineNote>
        ) : null}
      </div>
    </section>
  );
}
