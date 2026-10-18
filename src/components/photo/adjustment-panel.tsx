'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  MAX_PHOTO_ADJUSTMENTS,
  PHOTO_ADJUSTMENT_INFO,
  PHOTO_ADJUSTMENT_KINDS,
  type PhotoAdjustment,
  type PhotoAdjustmentKind,
  type PhotoPayload,
} from '../../core/documents/payload';
import {
  addPhotoAdjustmentCommand,
  movePhotoAdjustmentCommand,
  removePhotoAdjustmentCommand,
  setPhotoAdjustmentEnabledCommand,
  setPhotoAdjustmentValueCommand,
} from '../../core/photo/commands';
import { Button } from '../ui/button';
import { SegmentedControl } from '../ui/controls';
import { Field, Select } from '../ui/field';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';

/**
 * The non-destructive adjustment stack.
 *
 * Order is not decoration: each entry is applied to the *result* of the one above it, so moving an
 * exposure above or below a contrast is a different photograph. Reordering is two real buttons
 * rather than drag-and-drop, because drag-and-drop cannot be the only path to a document change.
 */
export function AdjustmentPanel({
  api,
  payload,
}: {
  readonly api: WorkspaceApi;
  readonly payload: PhotoPayload;
}) {
  const [kind, setKind] = useState<PhotoAdjustmentKind>('exposure');

  const atLimit = payload.adjustments.length >= MAX_PHOTO_ADJUSTMENTS;

  return (
    <section aria-labelledby="photo-adjustments-heading" className="space-y-3">
      <div>
        <h3
          id="photo-adjustments-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Adjustment stack
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          {payload.adjustments.length === 0
            ? 'No adjustments yet. Nothing is baked in: every entry stays editable and can be bypassed.'
            : `Applied top to bottom — ${String(payload.adjustments.length)} of ${String(
                MAX_PHOTO_ADJUSTMENTS,
              )} entries. Bypassing keeps the value.`}
        </p>
      </div>

      <div className="flex items-end gap-2">
        <Field label="Add an adjustment" className="min-w-0 flex-1">
          <Select
            value={kind}
            onChange={(event) => {
              const next = PHOTO_ADJUSTMENT_KINDS.find(
                (candidate) => candidate === event.target.value,
              );
              if (next) setKind(next);
            }}
            options={PHOTO_ADJUSTMENT_KINDS.map((candidate) => ({
              value: candidate,
              label: PHOTO_ADJUSTMENT_INFO[candidate].label,
            }))}
          />
        </Field>
        <Button
          size="sm"
          iconLeft={<Plus aria-hidden />}
          disabled={atLimit}
          onClick={() => {
            void api.run(addPhotoAdjustmentCommand(api.doc, kind));
          }}
        >
          Add
        </Button>
      </div>

      {atLimit ? (
        <InlineNote tone="warning" title="The stack is full">
          <p>
            A document holds {MAX_PHOTO_ADJUSTMENTS} adjustments. Merge two related entries by
            removing one and setting the other.
          </p>
        </InlineNote>
      ) : null}

      {payload.adjustments.length === 0 ? (
        <p className="border-line-subtle text-fg-subtle rounded-sm border border-dashed px-3 py-4 text-xs">
          The photo is shown as imported. Add exposure, contrast or colour to start the edit — the
          original pixels are never overwritten.
        </p>
      ) : (
        <ol aria-label="Adjustment stack" className="space-y-2.5">
          {payload.adjustments.map((adjustment, index) => (
            <AdjustmentRow
              key={adjustment.id}
              api={api}
              adjustment={adjustment}
              index={index}
              total={payload.adjustments.length}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function AdjustmentRow({
  api,
  adjustment,
  index,
  total,
}: {
  readonly api: WorkspaceApi;
  readonly adjustment: PhotoAdjustment;
  readonly index: number;
  readonly total: number;
}) {
  // Identity of the current visit to this slider, so one drag is one history entry. A ref because it
  // must not re-render and it is interaction state, not document state (ADR-0017).
  const drag = useRef({ active: false, id: 0 });
  const info = PHOTO_ADJUSTMENT_INFO[adjustment.kind];
  const name = info.label.toLowerCase();
  const id = `adjustment-${adjustment.id}`;

  return (
    <li
      className="border-line bg-surface-raised/40 space-y-2 rounded-sm border p-3"
      data-testid={`adjustment-row-${adjustment.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-fg text-sm font-medium">
            {info.label}
            {adjustment.enabled ? null : (
              <span className="text-fg-subtle text-2xs ml-2 tracking-wide uppercase">bypassed</span>
            )}
          </p>
          <p className="text-fg-subtle text-2xs">{info.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="quiet"
            size="sm"
            aria-label={`Move ${name} earlier`}
            disabled={index === 0}
            iconLeft={<ArrowUp aria-hidden />}
            onClick={() => {
              void api.run(movePhotoAdjustmentCommand(api.doc, adjustment.id, 'up'));
            }}
          />
          <Button
            variant="quiet"
            size="sm"
            aria-label={`Move ${name} later`}
            disabled={index === total - 1}
            iconLeft={<ArrowDown aria-hidden />}
            onClick={() => {
              void api.run(movePhotoAdjustmentCommand(api.doc, adjustment.id, 'down'));
            }}
          />
          <Button
            variant="quiet"
            size="sm"
            aria-label={`Remove ${name}`}
            iconLeft={<Trash2 aria-hidden />}
            onClick={() => {
              void api.run(removePhotoAdjustmentCommand(api.doc, adjustment.id));
            }}
          />
        </div>
      </div>

      <Field label={`${info.label} value`} labelSuffix={String(adjustment.value)}>
        <input
          id={id}
          type="range"
          min={info.min}
          max={info.max}
          step={info.step}
          value={adjustment.value}
          aria-label={`${info.label} amount`}
          className="accent-accent w-full"
          onPointerDown={() => {
            drag.current = { active: true, id: drag.current.id + 1 };
          }}
          onPointerUp={() => {
            drag.current.active = false;
          }}
          onPointerCancel={() => {
            drag.current.active = false;
          }}
          onChange={(event) => {
            // One drag is one edit: coalescing keeps the history entry count equal to the number of
            // decisions the user made, not the number of pixels the slider crossed.
            void api.run(
              setPhotoAdjustmentValueCommand(api.doc, adjustment.id, Number(event.target.value)),
              drag.current.active
                ? { coalesceKey: `adjustment:${adjustment.id}:${String(drag.current.id)}` }
                : undefined,
            );
          }}
        />
      </Field>

      <SegmentedControl
        size="sm"
        label={`${info.label} state`}
        value={adjustment.enabled ? 'on' : 'off'}
        onChange={(next) => {
          void api.run(setPhotoAdjustmentEnabledCommand(api.doc, adjustment.id, next === 'on'));
        }}
        options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Bypassed' },
        ]}
      />
    </li>
  );
}
