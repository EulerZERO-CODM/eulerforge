'use client';

import { ArrowDown, ArrowUp, Copy, Trash2 } from 'lucide-react';

import { findAttribution } from '../../core/documents/layer-operations';
import {
  FONT_STACKS_INFO,
  FONT_WEIGHTS,
  IMAGE_FIT_LABELS,
  IMAGE_FITS,
  TEXT_ALIGNMENTS,
  TEXT_ALIGNMENT_LABELS,
  isImageLayer,
  isRectLayer,
  isShapeLayer,
  isTextLayer,
  type EllipseLayer,
  type FontStackId,
  type FontWeight,
  type ImageFit,
  type ImageLayer,
  type Layer,
  type RectLayer,
  type TextLayer,
} from '../../core/documents/layer-types';
import {
  deleteLayersCommand,
  duplicateLayerCommand,
  reorderLayerCommand,
  renameLayerCommand,
  setImageSettingsCommand,
  setLayerFrameCommand,
  setLayerLockCommand,
  setLayerOpacityCommand,
  setLayerVisibilityCommand,
  setShapeSettingsCommand,
  setTextSettingsCommand,
} from '../../core/editor/commands';
import { selectedLayers, type Selection } from '../../core/editor/selection';
import type { Scene } from '../../core/documents/layer-types';
import type { ForgeDocument } from '../../core/documents/types';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { Field, Input, Select, SwitchField, Textarea } from '../ui/field';
import { InlineNote } from '../ui/states';
import { useDraftField } from './use-draft-field';
import type { WorkspaceApi } from './workspace-api';

export type SelectionInspectorProps = {
  readonly api: WorkspaceApi;
  readonly selection: Selection;
  readonly scene: Scene;
  readonly onSelectionChange: (selection: Selection) => void;
};

/**
 * Selection inspector.
 *
 * Edits the selected layer(s). Every control writes through a command, so the undo label describes
 * the change ("Set font size to 72px") and a rejected edit surfaces a message instead of silently
 * doing nothing. Numbers commit on blur or Enter so typing does not create an undo step per keystroke.
 */
export function SelectionInspector({
  api,
  selection,
  scene,
  onSelectionChange,
}: SelectionInspectorProps) {
  const layers = selectedLayers(scene, selection);

  if (layers.length === 0) {
    return (
      <section aria-labelledby="inspector-selection">
        <SectionHeader
          id="inspector-selection"
          title="Selection"
          hint="Select a layer on the artboard or in the layer list to edit it."
        />
        <p className="text-fg-muted text-xs">
          Nothing is selected. Click a layer, or use the layer list with the arrow keys and Enter.
        </p>
      </section>
    );
  }

  const primary = layers[0];
  if (!primary) return null;

  return (
    <section aria-labelledby="inspector-selection" className="space-y-5">
      <SectionHeader
        id="inspector-selection"
        title={
          layers.length === 1 ? 'Selected layer' : `Selected layers (${String(layers.length)})`
        }
        hint="Changes are undoable; every entry in the history list is named after the edit you made."
      />

      {layers.length > 1 ? (
        <InlineNote tone="info" title="Multiple layers selected">
          <p>
            Position, opacity, visibility and stacking apply to all selected layers. Type-specific
            settings apply when a single layer is selected.
          </p>
        </InlineNote>
      ) : null}

      {layers.length === 1 ? (
        <>
          <NameField api={api} layer={primary} />
          <FrameFields api={api} layer={primary} />
        </>
      ) : null}

      <OpacityField api={api} layers={layers} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          iconLeft={<ArrowUp aria-hidden />}
          onClick={() => {
            for (const layer of layers) {
              void api.run(reorderLayerCommand(api.doc, layer.id, 'forward'));
            }
          }}
        >
          Bring forward
        </Button>
        <Button
          variant="outline"
          size="sm"
          iconLeft={<ArrowDown aria-hidden />}
          onClick={() => {
            for (const layer of layers) {
              void api.run(reorderLayerCommand(api.doc, layer.id, 'backward'));
            }
          }}
        >
          Send backward
        </Button>
        <IconButton
          label={`Duplicate ${layers.length === 1 ? primary.name : 'selection'}`}
          onClick={() => {
            for (const layer of layers) void api.run(duplicateLayerCommand(api.doc, layer.id));
          }}
        >
          <Copy aria-hidden />
        </IconButton>
        <IconButton
          label={`Delete ${layers.length === 1 ? primary.name : 'selection'}`}
          onClick={() => {
            const ids = layers.map((layer) => layer.id);
            onSelectionChange(Object.freeze([]));
            void api.run(deleteLayersCommand(api.doc, ids));
          }}
        >
          <Trash2 aria-hidden />
        </IconButton>
      </div>

      <div className="space-y-3">
        {layers.map((layer) => (
          <SwitchField
            key={`visibility-${String(layer.id)}`}
            label={`“${layer.name}” visible`}
            description="Hidden layers stay in the document and are skipped when rendering."
            checked={layer.visible}
            onCheckedChange={(visible) => {
              void api.run(setLayerVisibilityCommand(api.doc, layer.id, visible));
            }}
          />
        ))}
        {layers.length === 1 ? (
          <SwitchField
            label="Lock this layer"
            description="A locked layer cannot be picked on the artboard; it still renders and exports."
            checked={primary.locked}
            onCheckedChange={(locked) => {
              void api.run(setLayerLockCommand(api.doc, primary.id, locked));
            }}
          />
        ) : null}
      </div>

      {layers.length === 1 && isTextLayer(primary) ? (
        <TextSection api={api} layer={primary} />
      ) : null}
      {layers.length === 1 && (isRectLayer(primary) || primary.type === 'ellipse') ? (
        <ShapeSection api={api} layer={primary} />
      ) : null}
      {layers.length === 1 && isImageLayer(primary) ? (
        <ImageSection api={api} doc={api.doc} layer={primary} />
      ) : null}
    </section>
  );
}

function SectionHeader({
  id,
  title,
  hint,
}: {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
}) {
  return (
    <div className="border-line-subtle mb-3 border-b pb-2">
      <h3 id={id} className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
        {title}
      </h3>
      <p className="text-fg-subtle mt-0.5 text-xs">{hint}</p>
    </div>
  );
}

function NameField({ api, layer }: { readonly api: WorkspaceApi; readonly layer: Layer }) {
  const name = useDraftField({
    value: layer.name,
    onCommit: (value) => {
      if (value.trim().length === 0) return 'A layer needs a name.';
      void api.run(renameLayerCommand(api.doc, layer.id, value));
      return null;
    },
  });

  return (
    <Field label="Layer name" hint="Names appear in the layer list and in undo labels.">
      <Input
        value={name.draft}
        invalid={name.error !== null}
        onChange={(event) => {
          name.setDraft(event.target.value);
        }}
        onBlur={name.onBlur}
        onKeyDown={name.onKeyDown}
      />
      {name.error ? <p className="text-2xs text-rose-400">{name.error}</p> : null}
    </Field>
  );
}

function FrameFields({ api, layer }: { readonly api: WorkspaceApi; readonly layer: Layer }) {
  const { frame } = layer;
  const commitFrame = (patch: Partial<typeof frame>, label: string): void => {
    void api.run(setLayerFrameCommand(api.doc, layer.id, { ...frame, ...patch }, label));
  };
  void commitFrame;

  const x = useDraftField({
    value: String(Math.round(frame.x)),
    onCommit: (raw) => {
      if (!isFiniteNumber(raw)) return 'X must be a number.';
      commitFrame({ x: Number(raw) }, `Move “${layer.name}” to x ${raw}`);
      return null;
    },
  });
  const y = useDraftField({
    value: String(Math.round(frame.y)),
    onCommit: (raw) => {
      if (!isFiniteNumber(raw)) return 'Y must be a number.';
      commitFrame({ y: Number(raw) }, `Move “${layer.name}” to y ${raw}`);
      return null;
    },
  });
  const width = useDraftField({
    value: String(Math.round(frame.width)),
    onCommit: (raw) => {
      const value = Number(raw);
      if (!isFiniteNumber(raw) || value < 1) return 'Width must be at least 1px.';
      commitFrame({ width: value }, `Set “${layer.name}” width to ${raw}px`);
      return null;
    },
  });
  const height = useDraftField({
    value: String(Math.round(frame.height)),
    onCommit: (raw) => {
      const value = Number(raw);
      if (!isFiniteNumber(raw) || value < 1) return 'Height must be at least 1px.';
      commitFrame({ height: value }, `Set “${layer.name}” height to ${raw}px`);
      return null;
    },
  });

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="X" labelSuffix="px">
        <Input
          value={x.draft}
          invalid={x.error !== null}
          onChange={(e) => x.setDraft(e.target.value)}
          onBlur={x.onBlur}
          onKeyDown={x.onKeyDown}
          inputMode="numeric"
        />
      </Field>
      <Field label="Y" labelSuffix="px">
        <Input
          value={y.draft}
          invalid={y.error !== null}
          onChange={(e) => y.setDraft(e.target.value)}
          onBlur={y.onBlur}
          onKeyDown={y.onKeyDown}
          inputMode="numeric"
        />
      </Field>
      <Field label="Width" labelSuffix="px">
        <Input
          value={width.draft}
          invalid={width.error !== null}
          onChange={(e) => width.setDraft(e.target.value)}
          onBlur={width.onBlur}
          onKeyDown={width.onKeyDown}
          inputMode="numeric"
        />
      </Field>
      <Field label="Height" labelSuffix="px">
        <Input
          value={height.draft}
          invalid={height.error !== null}
          onChange={(e) => height.setDraft(e.target.value)}
          onBlur={height.onBlur}
          onKeyDown={height.onKeyDown}
          inputMode="numeric"
        />
      </Field>
    </div>
  );
}

function OpacityField({
  api,
  layers,
}: {
  readonly api: WorkspaceApi;
  readonly layers: readonly Layer[];
}) {
  const primary = layers[0];
  if (!primary) return null;
  const percent = Math.round(primary.opacity * 100);

  return (
    <Field label="Opacity" labelSuffix={`${String(percent)}%`}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label="Layer opacity"
        className="accent-accent w-full"
        onChange={(event) => {
          const next = Number(event.target.value) / 100;
          for (const layer of layers) {
            void api.run(setLayerOpacityCommand(api.doc, layer.id, next));
          }
        }}
      />
    </Field>
  );
}

function ColourField({
  label,
  value,
  hint,
  onChange,
  allowNone = false,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly hint?: string;
  readonly onChange: (value: string | null) => void;
  readonly allowNone?: boolean;
}) {
  const text = useDraftField({
    value: value ?? '',
    onCommit: (raw) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        if (!allowNone) return 'Enter a colour as #rrggbb, or choose None.';
        onChange(null);
        return null;
      }
      if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) return 'Colours are six hex digits, like #ff8a3d.';
      onChange(trimmed.startsWith('#') ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`);
      return null;
    },
  });

  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      labelSuffix={
        allowNone ? (
          <button
            type="button"
            className="text-fg-subtle hover:text-fg underline decoration-1 underline-offset-2"
            onClick={() => {
              onChange(null);
            }}
          >
            None
          </button>
        ) : null
      }
    >
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={value ?? '#000000'}
          onChange={(event) => {
            onChange(event.target.value.toLowerCase());
          }}
          className="border-line h-8 w-10 cursor-pointer rounded-sm border bg-transparent"
        />
        <Input
          value={text.draft}
          invalid={text.error !== null}
          placeholder={allowNone ? 'none' : '#rrggbb'}
          onChange={(event) => {
            text.setDraft(event.target.value);
          }}
          onBlur={text.onBlur}
          onKeyDown={text.onKeyDown}
        />
      </div>
    </Field>
  );
}

/**
 * Text settings.
 *
 * The guard and the fields are separate components on purpose: a component that returns early *before*
 * calling hooks changes its hook order when the selected layer's type changes, which React rejects.
 */
function TextSection({ api, layer }: { readonly api: WorkspaceApi; readonly layer: Layer }) {
  if (!isTextLayer(layer)) return null;
  return <TextFields api={api} layer={layer} />;
}

function TextFields({ api, layer }: { readonly api: WorkspaceApi; readonly layer: TextLayer }) {
  const text = layer.text;

  const content = useDraftField({
    value: text.content,
    onCommit: (value) => {
      void api.run(setTextSettingsCommand(api.doc, layer.id, { content: value }));
      return null;
    },
  });

  const fontSize = useDraftField({
    value: String(text.fontSize),
    onCommit: (raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 4 || value > 800)
        return 'Font size must be between 4 and 800px.';
      void api.run(setTextSettingsCommand(api.doc, layer.id, { fontSize: value }));
      return null;
    },
  });

  const lineHeight = useDraftField({
    value: String(text.lineHeight),
    onCommit: (raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0.5 || value > 4)
        return 'Line height must be between 0.5 and 4.';
      void api.run(setTextSettingsCommand(api.doc, layer.id, { lineHeight: value }));
      return null;
    },
  });

  const letterSpacing = useDraftField({
    value: String(text.letterSpacing),
    onCommit: (raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < -50 || value > 200)
        return 'Letter spacing must be between -50 and 200px.';
      void api.run(setTextSettingsCommand(api.doc, layer.id, { letterSpacing: value }));
      return null;
    },
  });

  return (
    <div className="border-line space-y-4 border-t pt-4">
      <h4 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">Text</h4>

      <Field label="Content" hint="Text wraps inside the layer box; explicit line breaks are kept.">
        <Textarea
          rows={3}
          value={content.draft}
          invalid={content.error !== null}
          onChange={(event) => {
            content.setDraft(event.target.value);
          }}
          onBlur={content.onBlur}
          onKeyDown={content.onKeyDown}
        />
      </Field>

      <Field
        label="Typeface"
        hint="System font stacks only: nothing is downloaded, so text renders the same offline."
      >
        <Select
          value={text.fontStackId}
          options={(Object.keys(FONT_STACKS_INFO) as FontStackId[]).map((id) => ({
            value: id,
            label: FONT_STACKS_INFO[id].label,
          }))}
          onChange={(event) => {
            void api.run(
              setTextSettingsCommand(api.doc, layer.id, {
                fontStackId: event.target.value as FontStackId,
              }),
            );
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Size" labelSuffix="px">
          <Input
            value={fontSize.draft}
            invalid={fontSize.error !== null}
            onChange={(e) => fontSize.setDraft(e.target.value)}
            onBlur={fontSize.onBlur}
            onKeyDown={fontSize.onKeyDown}
            inputMode="numeric"
          />
        </Field>
        <Field label="Weight">
          <Select
            value={String(text.fontWeight)}
            options={FONT_WEIGHTS.map((weight) => ({
              value: String(weight),
              label: String(weight),
            }))}
            onChange={(event) => {
              void api.run(
                setTextSettingsCommand(api.doc, layer.id, {
                  fontWeight: Number(event.target.value) as FontWeight,
                }),
              );
            }}
          />
        </Field>
        <Field label="Line height" labelSuffix="×">
          <Input
            value={lineHeight.draft}
            invalid={lineHeight.error !== null}
            onChange={(e) => lineHeight.setDraft(e.target.value)}
            onBlur={lineHeight.onBlur}
            onKeyDown={lineHeight.onKeyDown}
            inputMode="decimal"
          />
        </Field>
        <Field label="Letter spacing" labelSuffix="px">
          <Input
            value={letterSpacing.draft}
            invalid={letterSpacing.error !== null}
            onChange={(e) => letterSpacing.setDraft(e.target.value)}
            onBlur={letterSpacing.onBlur}
            onKeyDown={letterSpacing.onKeyDown}
            inputMode="numeric"
          />
        </Field>
      </div>

      <Field label="Alignment">
        <div className="flex gap-1" role="group" aria-label="Text alignment">
          {TEXT_ALIGNMENTS.map((align) => (
            <Button
              key={align}
              variant={text.align === align ? 'primary' : 'outline'}
              size="sm"
              aria-pressed={text.align === align}
              onClick={() => {
                void api.run(setTextSettingsCommand(api.doc, layer.id, { align }));
              }}
            >
              {TEXT_ALIGNMENT_LABELS[align]}
            </Button>
          ))}
        </div>
      </Field>

      <ColourField
        label="Text colour"
        value={text.color}
        onChange={(color) => {
          if (!color) return;
          void api.run(setTextSettingsCommand(api.doc, layer.id, { color }));
        }}
      />
    </div>
  );
}

function ShapeSection({ api, layer }: { readonly api: WorkspaceApi; readonly layer: Layer }) {
  if (!isShapeLayer(layer)) return null;
  return <ShapeFields api={api} layer={layer} />;
}

function ShapeFields({
  api,
  layer,
}: {
  readonly api: WorkspaceApi;
  readonly layer: RectLayer | EllipseLayer;
}) {
  const shape = layer.shape;

  const strokeWidth = useDraftField({
    value: String(shape.strokeWidth),
    onCommit: (raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 200)
        return 'Stroke width must be between 0 and 200px.';
      void api.run(setShapeSettingsCommand(api.doc, layer.id, { strokeWidth: value }));
      return null;
    },
  });

  const cornerRadius = useDraftField({
    value: String(shape.cornerRadius),
    onCommit: (raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return 'Corner radius cannot be negative.';
      void api.run(setShapeSettingsCommand(api.doc, layer.id, { cornerRadius: value }));
      return null;
    },
  });

  return (
    <div className="border-line space-y-4 border-t pt-4">
      <h4 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
        {isRectLayer(layer) ? 'Rectangle' : 'Ellipse'}
      </h4>

      <ColourField
        label="Fill"
        value={shape.fill}
        allowNone
        onChange={(fill) => {
          void api.run(setShapeSettingsCommand(api.doc, layer.id, { fill }));
        }}
      />
      <ColourField
        label="Stroke"
        value={shape.stroke}
        allowNone
        onChange={(stroke) => {
          void api.run(setShapeSettingsCommand(api.doc, layer.id, { stroke }));
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Stroke width" labelSuffix="px">
          <Input
            value={strokeWidth.draft}
            invalid={strokeWidth.error !== null}
            onChange={(e) => strokeWidth.setDraft(e.target.value)}
            onBlur={strokeWidth.onBlur}
            onKeyDown={strokeWidth.onKeyDown}
            inputMode="numeric"
          />
        </Field>
        {isRectLayer(layer) ? (
          <Field label="Corner radius" labelSuffix="px" hint="Clamped to half the shorter side.">
            <Input
              value={cornerRadius.draft}
              invalid={cornerRadius.error !== null}
              onChange={(e) => cornerRadius.setDraft(e.target.value)}
              onBlur={cornerRadius.onBlur}
              onKeyDown={cornerRadius.onKeyDown}
              inputMode="numeric"
            />
          </Field>
        ) : null}
      </div>
    </div>
  );
}

function ImageSection({
  api,
  doc,
  layer,
}: {
  readonly api: WorkspaceApi;
  readonly doc: ForgeDocument;
  readonly layer: Layer;
}) {
  if (!isImageLayer(layer)) return null;
  return <ImageFields api={api} doc={doc} layer={layer} />;
}

function ImageFields({
  api,
  doc,
  layer,
}: {
  readonly api: WorkspaceApi;
  readonly doc: ForgeDocument;
  readonly layer: ImageLayer;
}) {
  const attribution = layer.image.assetId
    ? findAttribution(doc.attribution, layer.image.assetId)
    : undefined;

  return (
    <div className="border-line space-y-4 border-t pt-4">
      <h4 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">Graphic</h4>

      <Field
        label="Source"
        hint="Files ship with this repository; nothing is fetched from the internet."
      >
        <Input value={layer.image.href} readOnly />
      </Field>

      <Field label="Fit">
        <Select
          value={layer.image.fit}
          options={IMAGE_FITS.map((fit) => ({ value: fit, label: IMAGE_FIT_LABELS[fit] }))}
          onChange={(event) => {
            void api.run(
              setImageSettingsCommand(api.doc, layer.id, {
                fit: event.target.value as ImageFit,
              }),
            );
          }}
        />
      </Field>

      <ColourField
        label="Tint"
        value={layer.image.tint}
        allowNone
        hint="Tint composites over the graphic's opaque pixels, so transparent areas stay transparent."
        onChange={(tint) => {
          void api.run(setImageSettingsCommand(api.doc, layer.id, { tint }));
        }}
      />

      {attribution ? (
        <div className="border-line-subtle bg-surface-raised/40 space-y-1 rounded-sm border px-3 py-2">
          <p className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
            Attribution recorded
          </p>
          <p className="text-fg text-xs">{attribution.assetName}</p>
          <p className="text-fg-muted text-2xs">
            {attribution.licenseName} · {attribution.author} · via {attribution.source}
          </p>
          <p className="text-fg-muted text-2xs">
            {attribution.attributionRequired
              ? 'Credit is required when this is published.'
              : 'No credit required by the licence.'}
            {attribution.commercialUse ? ' Commercial use allowed.' : ' Non-commercial use only.'}
          </p>
          {attribution.verified ? null : (
            <p className="text-2xs text-amber-300">
              Provenance for this record has not been verified.
            </p>
          )}
        </div>
      ) : (
        <p className="text-fg-subtle text-2xs">
          This graphic is not from the catalogue, so there is no licence record for it.
        </p>
      )}
    </div>
  );
}

/** True when a raw input is a usable number. */
function isFiniteNumber(raw: string): boolean {
  return raw.trim().length > 0 && Number.isFinite(Number(raw));
}
