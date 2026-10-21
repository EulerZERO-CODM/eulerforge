'use client';

import { Eraser, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  MAX_MASK_RANGES,
  MAX_MASK_STROKES,
  MAX_RETOUCH_STROKES,
  maskHasCoverage,
  type PhotoPoint,
  type PhotoPayload,
  type PhotoRangeSelection,
} from '../../core/documents/payload';
import {
  addRangeSelectionCommand,
  clearMaskCommand,
  clearRangeSelectionsCommand,
  clearRetouchCommand,
  removeRangeSelectionCommand,
  setMaskInvertedCommand,
  undoMaskStrokeCommand,
  undoRetouchCommand,
} from '../../core/photo/commands';
import { Button } from '../ui/button';
import { Field, SwitchField } from '../ui/field';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';
import { PHOTO_TOOLS, PHOTO_TOOL_INFO, type PhotoTool } from './photo-tools';

/** One-line summary of a stored range selection, used in the list and by the tests. */
export function describeRangeSelection(range: PhotoRangeSelection): string {
  const feather = Math.round(range.feather * 100);
  if (range.kind === 'luminance') {
    return `Luminance ${String(Math.round(range.min * 100))}–${String(
      Math.round(range.max * 100),
    )}%, edge ${String(feather)}%`;
  }
  return `Colour ${range.colour.toUpperCase()} ±${String(
    Math.round(range.tolerance * 100),
  )}%, edge ${String(feather)}%`;
}

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
  const ranges = payload.mask?.ranges ?? [];
  const hasMask = maskHasCoverage(payload.mask);
  const retouch = payload.retouch.length;
  const info = PHOTO_TOOL_INFO[tool];

  // Not part of the document: these configure the next range selection, exactly as brush size
  // configures the next stroke. A stored range is immutable except for being removed — editing a
  // threshold after the fact would make an undo step mean "change an arbitrary past selection".
  const [luminanceMin, setLuminanceMin] = useState(20);
  const [luminanceMax, setLuminanceMax] = useState(80);
  const [luminanceFeather, setLuminanceFeather] = useState(20);
  const [colour, setColour] = useState('#808080');
  const [tolerance, setTolerance] = useState(15);
  const [colourFeather, setColourFeather] = useState(20);
  const full = ranges.length >= MAX_MASK_RANGES;
  const noSource = payload.source === null;

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
          <p className="forge-numeric text-fg-subtle text-2xs" data-testid="photo-mask-count">
            {strokes} / {MAX_MASK_STROKES} strokes · {ranges.length} / {MAX_MASK_RANGES} ranges
          </p>
        </div>
        <SwitchField
          label="Invert mask"
          description="Apply the stack outside the painted area instead of inside."
          checked={payload.mask?.inverted ?? false}
          disabled={!hasMask}
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
            disabled={!hasMask}
            onClick={() => {
              void api.run(clearMaskCommand(api.doc));
            }}
          >
            Clear mask
          </Button>
        </div>
        {!hasMask ? (
          <p className="text-fg-subtle text-xs">
            No mask: the stack applies to the whole photograph.
          </p>
        ) : null}
      </div>

      <div className="border-line space-y-2.5 rounded-sm border p-3" data-testid="photo-ranges">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-fg text-sm font-medium">Select by range</p>
          <p className="forge-numeric text-fg-subtle text-2xs">
            {ranges.length} / {MAX_MASK_RANGES}
          </p>
        </div>
        <p className="text-fg-subtle text-xs">
          Measured from the imported photograph, not the adjusted preview, so the selection stays
          put while you edit. Ranges and painted strokes combine; inverting applies to both.
        </p>

        {noSource ? (
          <p className="text-fg-subtle text-xs" data-testid="photo-ranges-empty">
            Import a photograph to select pixels by luminance or colour.
          </p>
        ) : (
          <div className="space-y-3">
            <fieldset className="space-y-2" data-testid="photo-range-luminance">
              <legend className="text-fg-muted text-xs font-medium">Luminance window</legend>
              <Field label="From" labelSuffix={`${luminanceMin}%`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={luminanceMin}
                  aria-label="Luminance range start"
                  data-testid="photo-range-min"
                  className="accent-accent w-full"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setLuminanceMin(Math.min(next, luminanceMax));
                  }}
                />
              </Field>
              <Field label="To" labelSuffix={`${luminanceMax}%`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={luminanceMax}
                  aria-label="Luminance range end"
                  data-testid="photo-range-max"
                  className="accent-accent w-full"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setLuminanceMax(Math.max(next, luminanceMin));
                  }}
                />
              </Field>
              <Field label="Edge softness" labelSuffix={`${luminanceFeather}%`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={luminanceFeather}
                  aria-label="Luminance edge softness"
                  data-testid="photo-range-luminance-feather"
                  className="accent-accent w-full"
                  onChange={(event) => {
                    setLuminanceFeather(Number(event.target.value));
                  }}
                />
              </Field>
              <Button
                size="sm"
                variant="outline"
                data-testid="photo-range-add-luminance"
                disabled={full}
                onClick={() => {
                  void api.run(
                    addRangeSelectionCommand(api.doc, {
                      kind: 'luminance',
                      min: luminanceMin / 100,
                      max: luminanceMax / 100,
                      feather: luminanceFeather / 100,
                    }),
                  );
                }}
              >
                Select by luminance
              </Button>
            </fieldset>

            <fieldset className="space-y-2" data-testid="photo-range-colour-fields">
              <legend className="text-fg-muted text-xs font-medium">Colour match</legend>
              <Field
                label="Target colour"
                hint="Pick any colour; the photograph is compared to it."
              >
                <input
                  type="color"
                  value={colour}
                  aria-label="Selection colour"
                  data-testid="photo-range-colour"
                  className="border-line h-8 w-full cursor-pointer rounded-sm border bg-transparent"
                  onChange={(event) => {
                    setColour(event.target.value.toLowerCase());
                  }}
                />
              </Field>
              <Field label="Tolerance" labelSuffix={`±${tolerance}%`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={tolerance}
                  aria-label="Colour tolerance"
                  data-testid="photo-range-tolerance"
                  className="accent-accent w-full"
                  onChange={(event) => {
                    setTolerance(Number(event.target.value));
                  }}
                />
              </Field>
              <Field label="Edge softness" labelSuffix={`${colourFeather}%`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={colourFeather}
                  aria-label="Colour edge softness"
                  data-testid="photo-range-colour-feather"
                  className="accent-accent w-full"
                  onChange={(event) => {
                    setColourFeather(Number(event.target.value));
                  }}
                />
              </Field>
              <Button
                size="sm"
                variant="outline"
                data-testid="photo-range-add-colour"
                disabled={full}
                onClick={() => {
                  void api.run(
                    addRangeSelectionCommand(api.doc, {
                      kind: 'colour',
                      colour,
                      tolerance: tolerance / 100,
                      feather: colourFeather / 100,
                    }),
                  );
                }}
              >
                Select by colour
              </Button>
            </fieldset>

            {full ? (
              <p className="text-fg-subtle text-xs">
                {MAX_MASK_RANGES} ranges is the limit for one mask. Remove one to select again.
              </p>
            ) : null}
          </div>
        )}

        {ranges.length > 0 ? (
          <ul aria-label="Range selections" className="space-y-1.5">
            {ranges.map((range, index) => (
              <li
                key={range.id}
                className="border-line flex items-center justify-between gap-2 rounded-sm border px-2 py-1.5"
                data-testid={`photo-range-row-${String(index)}`}
              >
                <span className="text-fg-muted text-xs">{describeRangeSelection(range)}</span>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`Remove range selection ${String(index + 1)}`}
                  data-testid={`photo-range-remove-${String(index)}`}
                  onClick={() => {
                    void api.run(removeRangeSelectionCommand(api.doc, range.id));
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <Button
          size="sm"
          variant="outline"
          iconLeft={<Trash2 aria-hidden />}
          data-testid="photo-range-clear"
          disabled={ranges.length === 0}
          onClick={() => {
            void api.run(clearRangeSelectionsCommand(api.doc));
          }}
        >
          Clear range selections
        </Button>
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
