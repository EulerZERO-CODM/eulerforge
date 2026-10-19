'use client';

import { useState } from 'react';

import type { LayerId, PathLayer } from '../../core/documents/layer-types';
import { FILL_RULE_LABELS, FILL_RULES } from '../../core/vector/types';
import {
  BOOLEAN_OPERATION_HINTS,
  BOOLEAN_OPERATION_LABELS,
  type BooleanOperation,
} from '../../core/vector/boolean';
import { STROKE_LINE_CAPS, STROKE_LINE_JOINS } from '../../core/vector/style';
import { stylePaintsSomething } from '../../core/vector/style';
import { segmentTotal } from '../../core/vector/pick';
import { DEFAULT_VECTOR_STYLE } from '../../core/vector/style';
import {
  booleanLayersCommand,
  deletePathNodesCommand,
  outlineShapeCommand,
  setPathNodesKindCommand,
  setVectorStyleCommand,
  transformPathLayerCommand,
} from '../../core/editor/vector-commands';
import type { NodeReference } from '../../core/vector/pick';
import { ok } from '../../core/result';
import { cn } from '../../lib/cn';
import { useForgeServices } from '../../state/forge-provider';
import { Button } from '../ui/button';
import { Field, Input, Select } from '../ui/field';
import { InlineNote } from '../ui/states';
import { PaintControls } from './paint-controls';
import type { WorkspaceApi } from '../workspace/workspace-api';

const CAP_LABELS: Record<(typeof STROKE_LINE_CAPS)[number], string> = {
  butt: 'Flat',
  round: 'Round',
  square: 'Square',
};

const JOIN_LABELS: Record<(typeof STROKE_LINE_JOINS)[number], string> = {
  miter: 'Mitre',
  round: 'Round',
  bevel: 'Bevel',
  'miter-clip': 'Mitre (clipped)',
};

/**
 * Vector inspector.
 *
 * Four real sections over the existing command layer: geometry, node editing, paint and boolean
 * combination. Nothing here is a placeholder — a control that cannot act on the current selection is
 * disabled with the reason next to it, and every operation reports what it did, including the
 * approximation a boolean operation introduces.
 */
export function VectorInspector({
  api,
  selection,
  nodeSelection,
  onNodeSelectionChange,
  onSelectionChange,
}: {
  readonly api: WorkspaceApi;
  readonly selection: readonly LayerId[];
  readonly nodeSelection: readonly NodeReference[];
  readonly onNodeSelectionChange: (nodes: readonly NodeReference[]) => void;
  readonly onSelectionChange: (selection: readonly LayerId[]) => void;
}) {
  const { toasts } = useForgeServices();
  const [booleanReport, setBooleanReport] = useState<string | null>(null);

  const layers = selection
    .map((id) => api.doc.scene.layers.find((layer) => layer.id === id))
    .filter((layer): layer is NonNullable<typeof layer> => layer !== undefined);
  const paths = layers.filter((layer): layer is PathLayer => layer.type === 'path');
  const editable = paths.length === 1 && !paths[0]?.locked ? paths[0] : null;
  const shapes = layers.filter((layer) => layer.type === 'rect' || layer.type === 'ellipse');

  async function runBoolean(operation: BooleanOperation): Promise<void> {
    const result = booleanLayersCommand(api.doc, selection, operation);
    if (!result.ok) {
      toasts.warning('Those shapes were not combined', result.error.message);
      return;
    }
    const committed = await api.run(ok(result.value.command));
    if (!committed) return;
    // The operation replaced the inputs with one new layer, so the selection has to follow it: a
    // selection pointing at layers that no longer exist would leave the inspector describing nothing.
    const before = new Set(api.doc.scene.layers.map((layer) => String(layer.id)));
    const combined = result.value.command.patch.scene?.layers.find(
      (layer) => !before.has(String(layer.id)),
    );
    if (combined) onSelectionChange([combined.id]);
    const report = result.value.result;
    setBooleanReport(
      `${BOOLEAN_OPERATION_LABELS[operation]} wrote ${String(report.flattenedSegments.output)} line segments from ${String(report.flattenedSegments.inputs)} input segments, flattening curves at a tolerance of ${String(report.tolerance)} units. The result is a polygonal path: it has real editable nodes, but it is no longer a set of curves.`,
    );
    onNodeSelectionChange([]);
  }

  if (layers.length === 0) {
    return (
      <section aria-labelledby="vector-inspector-heading" className="space-y-3">
        <h3
          id="vector-inspector-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Vector
        </h3>
        <p className="text-fg-subtle text-xs">
          Select a shape on the artboard or in the layer list to edit its geometry and paint.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="vector-inspector-heading" className="space-y-5">
      <div>
        <h3
          id="vector-inspector-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Vector
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          {layers.length === 1
            ? `${layers[0]?.name ?? ''} · ${layers[0]?.type ?? ''}`
            : `${String(layers.length)} layers selected`}
        </p>
      </div>

      {editable ? (
        <>
          <GeometrySection api={api} layer={editable} />
          <NodeSection
            api={api}
            layer={editable}
            nodeSelection={nodeSelection}
            onNodeSelectionChange={onNodeSelectionChange}
          />
          <PaintSection api={api} layer={editable} />
        </>
      ) : null}

      {shapes.length > 0 ? (
        <div className="space-y-2">
          <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
            Shape to path
          </p>
          {shapes.map((shape) => (
            <Button
              key={String(shape.id)}
              variant="outline"
              size="sm"
              fullWidth
              data-testid={`outline-${String(shape.id)}`}
              onClick={() => {
                void api.run(outlineShapeCommand(api.doc, shape.id));
              }}
            >
              Convert “{shape.name}” to editable paths
            </Button>
          ))}
          <p className="text-2xs text-fg-subtle">
            The outline is the same curve, expressed as nodes: a rectangle becomes four corners with
            rounded corners as arcs, an ellipse becomes four cubic segments.
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
          Combine shapes
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(BOOLEAN_OPERATION_LABELS) as BooleanOperation[]).map((operation) => (
            <Button
              key={operation}
              variant="outline"
              size="sm"
              disabled={selection.length < 2}
              data-testid={`boolean-${operation}`}
              title={
                selection.length < 2
                  ? 'Select two or more shapes to combine them'
                  : BOOLEAN_OPERATION_HINTS[operation]
              }
              onClick={() => {
                void runBoolean(operation);
              }}
            >
              {BOOLEAN_OPERATION_LABELS[operation]}
            </Button>
          ))}
        </div>
        <p className="text-2xs text-fg-subtle">
          {BOOLEAN_OPERATION_HINTS.subtract} The back-most shape is the subject, so “Subtract”
          removes what is drawn over it.
        </p>
        <InlineNote tone="neutral">
          <p>
            Boolean results are computed from flattened outlines, so every curve in the inputs
            becomes straight segments at the documented tolerance. The result is real editable
            geometry, but it is polygonal rather than curved — the report after each operation says
            exactly how many segments were produced.
          </p>
        </InlineNote>
        {booleanReport ? (
          <p data-testid="boolean-report" className="text-fg-muted forge-numeric text-2xs">
            {booleanReport}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Position and size, expressed as a transform of the geometry rather than of a stored frame. */
function GeometrySection({
  api,
  layer,
}: {
  readonly api: WorkspaceApi;
  readonly layer: PathLayer;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const frame = layer.frame;

  function apply(next: { x?: number; y?: number; width?: number; height?: number }): void {
    const to = {
      x: next.x ?? frame.x,
      y: next.y ?? frame.y,
      width: next.width ?? frame.width,
      height: next.height ?? frame.height,
    };
    void api.run(transformPathLayerCommand(api.doc, layer.id, frame, { ...to, x: to.x, y: to.y }), {
      coalesceKey: 'vector:geometry',
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">Geometry</p>
      <div className="grid grid-cols-2 gap-2">
        {(['x', 'y', 'width', 'height'] as const).map((axis) => (
          <Field
            key={axis}
            label={axis === 'width' ? 'W' : axis === 'height' ? 'H' : axis.toUpperCase()}
          >
            <Input
              type="number"
              step={1}
              value={
                draft !== null && draft.startsWith(`${axis}:`)
                  ? draft.split(':')[1]
                  : String(round(frame[axis]))
              }
              data-testid={`vector-${axis}`}
              onChange={(event) => {
                setDraft(`${axis}:${event.target.value}`);
              }}
              onBlur={(event) => {
                setDraft(null);
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                apply({ [axis]: value });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </Field>
        ))}
      </div>
      <p className="text-2xs text-fg-subtle">
        Editing the box transforms the outline’s nodes, so the geometry and its bounds can never
        disagree. Rotation is not part of the document model, so it is not offered here.
      </p>
    </div>
  );
}

function NodeSection({
  api,
  layer,
  nodeSelection,
  onNodeSelectionChange,
}: {
  readonly api: WorkspaceApi;
  readonly layer: PathLayer;
  readonly nodeSelection: readonly NodeReference[];
  readonly onNodeSelectionChange: (nodes: readonly NodeReference[]) => void;
}) {
  const { toasts } = useForgeServices();
  const total = segmentTotal(layer.vector.path);
  const nodeCount = layer.vector.path.contours.reduce(
    (sum, contour) => sum + contour.nodes.length,
    0,
  );

  return (
    <div className="space-y-2">
      <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">Nodes</p>
      <p className="text-fg-muted forge-numeric text-2xs" data-testid="node-summary">
        {String(layer.vector.path.contours.length)} contour(s) · {String(nodeCount)} nodes ·{' '}
        {String(total)} segments
        {nodeSelection.length > 0 ? ` · ${String(nodeSelection.length)} selected` : ''}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={nodeSelection.length === 0}
          data-testid="node-smooth"
          onClick={() => {
            void api.run(setPathNodesKindCommand(api.doc, layer.id, nodeSelection, 'smooth'));
          }}
        >
          Make smooth
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={nodeSelection.length === 0}
          data-testid="node-corner"
          onClick={() => {
            void api.run(setPathNodesKindCommand(api.doc, layer.id, nodeSelection, 'corner'));
          }}
        >
          Make corner
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={nodeSelection.length === 0}
          data-testid="node-delete"
          className="col-span-2"
          onClick={() => {
            void api
              .run(deletePathNodesCommand(api.doc, layer.id, nodeSelection))
              .then((committed) => {
                if (committed) onNodeSelectionChange([]);
              });
          }}
        >
          Delete selected nodes
        </Button>
      </div>
      <p className="text-2xs text-fg-subtle">
        Use the node tool on the artboard, or press A. Clicking the outline adds a node where you
        click; deleting below three nodes opens a closed contour rather than leaving a shape that
        cannot be drawn.
      </p>
      {nodeSelection.length === 0 ? (
        <Button
          variant="link"
          size="sm"
          className="text-2xs"
          onClick={() => {
            toasts.info(
              'Node selection is not persisted',
              'Selection is transient interaction state: it is never written into the document or into undo history.',
            );
          }}
        >
          Why is nothing selected?
        </Button>
      ) : null}
    </div>
  );
}

function PaintSection({ api, layer }: { readonly api: WorkspaceApi; readonly layer: PathLayer }) {
  const style = layer.vector.style;
  const dash = style.dashArray.join(' ');
  const hasFill = style.fillPaint != null || style.fill !== null;
  const hasStroke = (style.strokePaint != null || style.stroke !== null) && style.strokeWidth > 0;

  return (
    <div className="space-y-3">
      <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">Fill and stroke</p>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Fill">
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              aria-label="Fill colour"
              data-testid="fill-colour"
              value={style.fill ?? DEFAULT_VECTOR_STYLE.fill ?? '#000000'}
              onChange={(event) => {
                void api.run(
                  setVectorStyleCommand(api.doc, [layer.id], { fill: event.target.value }),
                  { coalesceKey: 'vector:fill' },
                );
              }}
              className="border-line h-7 w-9 cursor-pointer rounded-sm border bg-transparent"
            />
            <Button
              variant="outline"
              size="sm"
              aria-pressed={!hasFill}
              data-testid="fill-none"
              onClick={() => {
                // Clearing only the colour would leave a gradient painting the shape, so this
                // removes both: "no fill" has to mean the shape shows no fill.
                void api.run(
                  setVectorStyleCommand(api.doc, [layer.id], { fill: null, fillPaint: null }),
                );
              }}
            >
              {hasFill ? 'Remove' : 'No fill'}
            </Button>
          </div>
        </Field>

        <Field label="Stroke">
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              aria-label="Stroke colour"
              data-testid="stroke-colour"
              value={style.stroke ?? '#000000'}
              onChange={(event) => {
                void api.run(
                  setVectorStyleCommand(api.doc, [layer.id], { stroke: event.target.value }),
                  { coalesceKey: 'vector:stroke' },
                );
              }}
              className="border-line h-7 w-9 cursor-pointer rounded-sm border bg-transparent"
            />
            <Button
              variant="outline"
              size="sm"
              aria-pressed={!hasStroke}
              data-testid="stroke-none"
              onClick={() => {
                void api.run(
                  setVectorStyleCommand(api.doc, [layer.id], { stroke: null, strokePaint: null }),
                );
              }}
            >
              {hasStroke ? 'Remove' : 'No stroke'}
            </Button>
          </div>
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <PaintControls
          slot="fill"
          paint={style.fillPaint ?? null}
          baseColour={style.fill ?? DEFAULT_VECTOR_STYLE.fill ?? '#000000'}
          onChange={(paint) => {
            void api.run(setVectorStyleCommand(api.doc, [layer.id], { fillPaint: paint }), {
              coalesceKey: 'vector:fill-paint',
            });
          }}
        />
        <PaintControls
          slot="stroke"
          paint={style.strokePaint ?? null}
          baseColour={style.stroke ?? '#000000'}
          onChange={(paint) => {
            void api.run(setVectorStyleCommand(api.doc, [layer.id], { strokePaint: paint }), {
              coalesceKey: 'vector:stroke-paint',
            });
          }}
        />
      </div>

      <Field label="Stroke width" hint="Document units">
        <Input
          type="number"
          min={0}
          max={2000}
          step={0.5}
          value={String(style.strokeWidth)}
          data-testid="stroke-width"
          onChange={(event) => {
            const value = Number(event.target.value);
            if (!Number.isFinite(value)) return;
            void api.run(setVectorStyleCommand(api.doc, [layer.id], { strokeWidth: value }), {
              coalesceKey: 'vector:stroke-width',
            });
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Fill rule">
          <Select
            value={style.fillRule}
            data-testid="fill-rule"
            onChange={(event) => {
              void api.run(
                setVectorStyleCommand(api.doc, [layer.id], {
                  fillRule: event.target.value === 'evenodd' ? 'evenodd' : 'nonzero',
                }),
              );
            }}
            options={FILL_RULES.map((rule) => ({ value: rule, label: FILL_RULE_LABELS[rule] }))}
          />
        </Field>
        <Field label="Layer opacity" hint={`${String(Math.round(layer.opacity * 100))}%`}>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(layer.opacity * 100)}
            aria-label="Layer opacity"
            data-testid="layer-opacity"
            className="accent-mint-400 w-full"
            onChange={(event) => {
              const opacity = Number(event.target.value) / 100;
              void api.run(setVectorStyleCommand(api.doc, [layer.id], { opacity }), {
                coalesceKey: 'vector:opacity',
              });
            }}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Line cap">
          <Select
            value={style.lineCap}
            data-testid="line-cap"
            onChange={(event) => {
              void api.run(
                setVectorStyleCommand(api.doc, [layer.id], {
                  lineCap: event.target.value as typeof style.lineCap,
                }),
              );
            }}
            options={STROKE_LINE_CAPS.map((cap) => ({ value: cap, label: CAP_LABELS[cap] }))}
          />
        </Field>
        <Field label="Line join">
          <Select
            value={style.lineJoin}
            data-testid="line-join"
            onChange={(event) => {
              void api.run(
                setVectorStyleCommand(api.doc, [layer.id], {
                  lineJoin: event.target.value as typeof style.lineJoin,
                }),
              );
            }}
            options={STROKE_LINE_JOINS.map((join) => ({ value: join, label: JOIN_LABELS[join] }))}
          />
        </Field>
      </div>

      <Field label="Dashes" hint="Space-separated lengths, or empty for a solid line">
        <Input
          defaultValue={dash}
          data-testid="dash-array"
          placeholder="e.g. 6 3"
          onBlur={(event) => {
            const parts = event.target.value
              .split(/[\s,]+/)
              .map((part) => Number(part))
              .filter((value) => Number.isFinite(value) && value >= 0)
              .slice(0, 16);
            void api.run(setVectorStyleCommand(api.doc, [layer.id], { dashArray: parts }));
          }}
        />
      </Field>

      <p
        className={cn(
          'text-2xs',
          stylePaintsSomething(style) ? 'text-fg-subtle' : 'text-amber-400',
        )}
        data-testid="paint-summary"
      >
        {stylePaintsSomething(style)
          ? 'Gradients and patterns are stored as paint geometry, so the artboard, the SVG export and a re-import describe the same picture. Blur and image filters are still not part of the document model.'
          : 'This shape has neither a fill nor a stroke, so it is invisible on the artboard and in an export.'}
      </p>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
