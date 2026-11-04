'use client';

/**
 * Paint controls: a solid colour, a gradient or a repeating motif.
 *
 * One component serves both the fill and the stroke slot, because both slots accept the same
 * `PaintSpec` and a second, slightly different editor is how the two drift apart. Every control is a
 * real document change through the existing style command, so undo, history labels, persistence and
 * export all see it; nothing here keeps local state that the artboard cannot see.
 *
 * The values shown are read from the stored paint rather than from an editing buffer: with a
 * gradient selected, changing a stop repaints the artboard immediately, and undoing the change puts
 * the old stop list back on screen because the controls render the document.
 */

import type { PaintSpec, PatternMotif } from '../../core/vector/paint';
import {
  describePaint,
  normalisePaint,
  PATTERN_MOTIFS,
  PAINT_LIMITS,
} from '../../core/vector/paint';
import { Button } from '../ui/button';
import { Field, Input, Select } from '../ui/field';

export type PaintSlot = 'fill' | 'stroke';

const MOTIF_LABELS: Record<PatternMotif, string> = {
  stripes: 'Stripes',
  dots: 'Dots',
  grid: 'Grid',
  checks: 'Checks',
};

function defaultPaintFor(kind: PaintSpec['kind'], colour: string): PaintSpec | null {
  switch (kind) {
    case 'solid':
      return null;
    case 'linear-gradient':
      return {
        kind: 'linear-gradient',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        stops: [
          { offset: 0, color: colour },
          { offset: 1, color: '#ffffff' },
        ],
      };
    case 'radial-gradient':
      return {
        kind: 'radial-gradient',
        centre: { x: 0.5, y: 0.5 },
        radius: 0.5,
        stops: [
          { offset: 0, color: colour },
          { offset: 1, color: '#ffffff' },
        ],
      };
    case 'pattern':
      return {
        kind: 'pattern',
        motif: 'stripes',
        foreground: colour,
        background: '#ffffff',
        scale: 0.15,
        rotation: 0,
      };
  }
}

const PAINT_KIND_LABELS: Record<PaintSpec['kind'], string> = {
  solid: 'Solid colour',
  'linear-gradient': 'Linear gradient',
  'radial-gradient': 'Radial gradient',
  pattern: 'Pattern',
};

const PAINT_KINDS: readonly PaintSpec['kind'][] = [
  'solid',
  'linear-gradient',
  'radial-gradient',
  'pattern',
];

/** Rounds to two decimals so the number fields do not show float noise from clamping. */
function tidy(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function PaintControls({
  slot,
  paint,
  baseColour,
  onChange,
}: {
  readonly slot: PaintSlot;
  readonly paint: PaintSpec | null;
  /** The solid colour the slot already carries; used to seed a new gradient or pattern. */
  readonly baseColour: string;
  readonly onChange: (paint: PaintSpec | null) => void;
}): React.JSX.Element {
  const kind = paint?.kind ?? 'solid';
  const id = (suffix: string): string => `${slot}-${suffix}`;

  const commit = (next: PaintSpec): void => {
    // Clamp at the boundary: a number field can be typed past the documented range, and a document
    // must never store paint the schema would reject.
    const normalised = normalisePaint(next);
    if (normalised) onChange(normalised);
  };

  return (
    <div className="space-y-2" data-testid={`paint-controls-${slot}`}>
      <Field label={`${slot === 'fill' ? 'Fill' : 'Stroke'} type`}>
        <Select
          value={kind}
          data-testid={id('paint-kind')}
          onChange={(event) => {
            const next = event.target.value as PaintSpec['kind'];
            const built = defaultPaintFor(next, baseColour);
            onChange(built === null ? null : (normalisePaint(built) ?? null));
          }}
          options={PAINT_KINDS.map((entry) => ({ value: entry, label: PAINT_KIND_LABELS[entry] }))}
        />
      </Field>

      {paint === null ? (
        <p className="text-2xs text-fg-subtle">
          A flat colour. Choose a gradient or a pattern to paint with more than one tone.
        </p>
      ) : (
        <p className="text-2xs text-fg-subtle" data-testid={id('paint-description')}>
          {describePaint(paint, 'Solid colour')} — drawn on the artboard and written to every
          export.
        </p>
      )}

      {paint !== null && paint.kind !== 'solid' ? (
        <Button
          variant="outline"
          size="sm"
          data-testid={id('paint-remove')}
          onClick={() => {
            onChange(null);
          }}
        >
          {`Use a solid ${slot}`}
        </Button>
      ) : null}

      {paint?.kind === 'linear-gradient' ? (
        <div className="grid grid-cols-4 gap-1.5">
          <Field label="Start X">
            <Input
              type="number"
              step={0.05}
              min={-4}
              max={5}
              value={String(tidy(paint.from.x))}
              data-testid={id('linear-from-x')}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                commit({ ...paint, from: { ...paint.from, x: value } });
              }}
            />
          </Field>
          <Field label="Start Y">
            <Input
              type="number"
              step={0.05}
              min={-4}
              max={5}
              value={String(tidy(paint.from.y))}
              data-testid={id('linear-from-y')}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                commit({ ...paint, from: { ...paint.from, y: value } });
              }}
            />
          </Field>
          <Field label="End X">
            <Input
              type="number"
              step={0.05}
              min={-4}
              max={5}
              value={String(tidy(paint.to.x))}
              data-testid={id('linear-to-x')}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                commit({ ...paint, to: { ...paint.to, x: value } });
              }}
            />
          </Field>
          <Field label="End Y">
            <Input
              type="number"
              step={0.05}
              min={-4}
              max={5}
              value={String(tidy(paint.to.y))}
              data-testid={id('linear-to-y')}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                commit({ ...paint, to: { ...paint.to, y: value } });
              }}
            />
          </Field>
        </div>
      ) : null}

      {paint?.kind === 'radial-gradient' ? (
        <div className="grid grid-cols-3 gap-1.5">
          <Field label="Centre X">
            <Input
              type="number"
              step={0.05}
              min={-4}
              max={5}
              value={String(tidy(paint.centre.x))}
              data-testid={id('radial-centre-x')}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                commit({ ...paint, centre: { ...paint.centre, x: value } });
              }}
            />
          </Field>
          <Field label="Centre Y">
            <Input
              type="number"
              step={0.05}
              min={-4}
              max={5}
              value={String(tidy(paint.centre.y))}
              data-testid={id('radial-centre-y')}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                commit({ ...paint, centre: { ...paint.centre, y: value } });
              }}
            />
          </Field>
          <Field label="Radius" hint="Fraction of the short side">
            <Input
              type="number"
              step={0.05}
              min={0}
              max={4}
              value={String(tidy(paint.radius))}
              data-testid={id('radial-radius')}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                commit({ ...paint, radius: value });
              }}
            />
          </Field>
        </div>
      ) : null}

      {paint?.kind === 'pattern' ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Motif">
              <Select
                value={paint.motif}
                data-testid={id('pattern-motif')}
                onChange={(event) => {
                  commit({ ...paint, motif: event.target.value as PatternMotif });
                }}
                options={PATTERN_MOTIFS.map((motif) => ({
                  value: motif,
                  label: MOTIF_LABELS[motif],
                }))}
              />
            </Field>
            <Field label="Tile scale" hint="Fraction of the short side">
              <Input
                type="number"
                step={0.01}
                min={PAINT_LIMITS.minPatternScale}
                max={PAINT_LIMITS.maxPatternScale}
                value={String(tidy(paint.scale))}
                data-testid={id('pattern-scale')}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  commit({ ...paint, scale: value });
                }}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Motif colour">
              <input
                type="color"
                aria-label="Pattern motif colour"
                data-testid={id('pattern-foreground')}
                value={paint.foreground}
                onChange={(event) => {
                  commit({ ...paint, foreground: event.target.value });
                }}
                className="border-line h-7 w-full cursor-pointer rounded-sm border bg-transparent"
              />
            </Field>
            <Field label="Background">
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  aria-label="Pattern background colour"
                  data-testid={id('pattern-background')}
                  value={paint.background ?? '#ffffff'}
                  disabled={paint.background === null}
                  onChange={(event) => {
                    commit({ ...paint, background: event.target.value });
                  }}
                  className="border-line h-7 w-9 cursor-pointer rounded-sm border bg-transparent disabled:opacity-40"
                />
                <Button
                  variant="outline"
                  size="sm"
                  aria-pressed={paint.background === null}
                  data-testid={id('pattern-background-none')}
                  onClick={() => {
                    commit({ ...paint, background: paint.background === null ? '#ffffff' : null });
                  }}
                >
                  {paint.background === null ? 'No background' : 'Clear'}
                </Button>
              </div>
            </Field>
          </div>
          <Field label="Rotation" hint="Degrees, about the shape’s centre">
            <Input
              type="number"
              step={5}
              min={-PAINT_LIMITS.maxRotationDegrees}
              max={PAINT_LIMITS.maxRotationDegrees}
              value={String(tidy(paint.rotation))}
              data-testid={id('pattern-rotation')}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                commit({ ...paint, rotation: value });
              }}
            />
          </Field>
        </div>
      ) : null}

      {paint?.kind === 'linear-gradient' || paint?.kind === 'radial-gradient' ? (
        <GradientStops slot={slot} paint={paint} commit={commit} />
      ) : null}
    </div>
  );
}

function GradientStops({
  slot,
  paint,
  commit,
}: {
  readonly slot: PaintSlot;
  readonly paint: Extract<PaintSpec, { kind: 'linear-gradient' | 'radial-gradient' }>;
  readonly commit: (paint: PaintSpec) => void;
}): React.JSX.Element {
  const stops = paint.stops;

  const replaceStop = (index: number, patch: { offset?: number; color?: string }): void => {
    commit({
      ...paint,
      stops: stops.map((stop, position) => (position === index ? { ...stop, ...patch } : stop)),
    });
  };

  return (
    <div className="space-y-1.5">
      <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">Gradient stops</p>
      {stops.map((stop, index) => (
        <div key={index} className="flex items-end gap-1.5">
          <input
            type="color"
            aria-label={`Stop ${String(index + 1)} colour`}
            data-testid={`${slot}-paint-stop-colour-${String(index)}`}
            value={stop.color}
            onChange={(event) => {
              replaceStop(index, { color: event.target.value });
            }}
            className="border-line h-7 w-9 shrink-0 cursor-pointer rounded-sm border bg-transparent"
          />
          <Field label={`Stop ${String(index + 1)} at`}>
            <Input
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={String(Math.round(stop.offset * 1000) / 1000)}
              data-testid={`${slot}-paint-stop-offset-${String(index)}`}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                replaceStop(index, { offset: value });
              }}
            />
          </Field>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Remove stop ${String(index + 1)}`}
            data-testid={`${slot}-paint-stop-remove-${String(index)}`}
            disabled={stops.length <= PAINT_LIMITS.minStops}
            onClick={() => {
              commit({
                ...paint,
                stops: stops.filter((_, position) => position !== index),
              });
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        data-testid={`${slot}-paint-stop-add`}
        disabled={stops.length >= PAINT_LIMITS.maxStops}
        onClick={() => {
          // Insert at the middle of the last gap, using the colour of the stop before it: a new stop
          // that changes nothing visible is far easier to understand than a random colour.
          const last = stops[stops.length - 1];
          const previous = stops[stops.length - 2] ?? last;
          if (!last || !previous) return;
          const offset = Math.round(((previous.offset + last.offset) / 2) * 1000) / 1000;
          commit({
            ...paint,
            stops: [...stops, { offset, color: previous.color }],
          });
        }}
      >
        Add stop
      </Button>
    </div>
  );
}
