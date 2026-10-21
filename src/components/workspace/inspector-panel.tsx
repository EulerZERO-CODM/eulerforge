'use client';

import { Info, Plus, Trash2, Wand2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { SAMPLE_ASSETS } from '../../core/assets/data';
import { DEFAULT_GUIDES } from '../../core/documents/factories';
import { aspectRatioLabel, megapixelLabel } from '../../core/documents/geometry';
import { CANVAS_PRESETS, getCanvasPreset } from '../../core/documents/presets';
import {
  CANVAS_PRESET_CATEGORY_LABELS,
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  MAX_DOCUMENT_TAGS,
  MAX_NOTES_LENGTH,
  MAX_TAG_LENGTH,
  type Canvas,
  type DocumentStatus,
  type GuideSettings,
} from '../../core/documents/types';
import {
  LENGTH_UNITS,
  LENGTH_UNIT_LABELS,
  formatLength,
  toPixels,
} from '../../core/documents/units';
import { validateCanvas, validateGuides, validateTitle } from '../../core/documents/validation';
import { applyPaletteCommand } from '../../core/editor/commands';
import { Button } from '../ui/button';
import { SwatchRow } from '../ui/controls';
import { Field, Input, Select, SwitchField, Textarea } from '../ui/field';
import { DataList } from '../ui/section';
import { InlineNote } from '../ui/states';
import { useDraftField } from './use-draft-field';
import type { WorkspaceApi } from './workspace-api';

/**
 * Document inspector.
 *
 * Four sections, each of which changes the real document model through `commit`:
 *   Canvas  — size, unit, resolution, background, transparency
 *   Guides  — safe margin, bleed, grid, centre lines
 *   Palette — working colours, including applying a bundled sample palette
 *   Details — title, summary, status, tags, notes
 *
 * Text fields commit on blur or Enter so typing one word does not create twelve undo steps, and an
 * invalid value is refused with an inline message instead of being silently dropped.
 */
export function InspectorPanel({ api }: { readonly api: WorkspaceApi }) {
  const { canvas } = api.doc;
  const preset = CANVAS_PRESETS.find(
    (candidate) =>
      candidate.size.width === canvas.width &&
      candidate.size.height === canvas.height &&
      candidate.unit === canvas.unit,
  );

  return (
    <div className="space-y-7">
      <CanvasSection api={api} presetId={preset ? preset.id : 'custom'} />
      <GuidesSection api={api} />
      <PaletteSection api={api} />
      <DetailsSection api={api} />
    </div>
  );
}

function SectionHeader({ title, hint }: { readonly title: string; readonly hint: string }) {
  return (
    <div className="border-line-subtle mb-3 border-b pb-2">
      <h3 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">{title}</h3>
      <p className="text-fg-subtle mt-0.5 text-xs">{hint}</p>
    </div>
  );
}

function CanvasSection({
  api,
  presetId,
}: {
  readonly api: WorkspaceApi;
  readonly presetId: string;
}) {
  const { canvas } = api.doc;
  /** Identity of the current visit to the background colour picker, so one visit is one undo step. */
  const backgroundPicker = useRef(0);

  const commitCanvas = (patch: Partial<Canvas>, label: string): string | null => {
    const next: Canvas = { ...canvas, ...patch };
    const issue = validateCanvas(next)[0];
    if (issue) return issue.message;
    void api.commit(label, { canvas: next });
    return null;
  };

  const width = useDraftField({
    value: String(canvas.width),
    onCommit: (raw) =>
      commitCanvas(
        { width: Number(raw) },
        `Resize canvas to ${String(Math.round(Number(raw)))} × ${String(canvas.height)} px`,
      ),
  });
  const height = useDraftField({
    value: String(canvas.height),
    onCommit: (raw) =>
      commitCanvas(
        { height: Number(raw) },
        `Resize canvas to ${String(canvas.width)} × ${String(Math.round(Number(raw)))} px`,
      ),
  });
  const dpi = useDraftField({
    value: String(canvas.dpi),
    onCommit: (raw) => commitCanvas({ dpi: Number(raw) }, `Set resolution to ${raw} dpi`),
  });

  return (
    <section aria-labelledby="inspector-canvas">
      <div id="inspector-canvas">
        <SectionHeader
          title="Canvas"
          hint="Everything downstream — guides, export checks and platform fit — derives from these values."
        />
      </div>

      <div className="space-y-4">
        <Field
          label="Preset"
          hint="A preset sets size, unit, resolution and background in one undoable step."
        >
          <Select
            value={presetId}
            onChange={(event) => {
              const next = getCanvasPreset(event.target.value);
              if (!next) return;
              void api.commit(`Apply ${next.label} preset`, {
                canvas: {
                  ...canvas,
                  width: next.size.width,
                  height: next.size.height,
                  unit: next.unit,
                  dpi: next.dpi,
                  background: next.background,
                },
              });
            }}
            options={[
              { value: 'custom', label: 'Custom size' },
              ...CANVAS_PRESETS.map((candidate) => ({
                value: candidate.id,
                label: `${candidate.label} — ${CANVAS_PRESET_CATEGORY_LABELS[candidate.category]}`,
              })),
            ]}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Width" error={width.error}>
            <Input
              inputMode="numeric"
              value={width.draft}
              suffix={canvas.unit}
              invalid={Boolean(width.error)}
              onChange={(event) => {
                width.setDraft(event.target.value);
              }}
              onBlur={width.onBlur}
              onKeyDown={width.onKeyDown}
            />
          </Field>
          <Field label="Height" error={height.error}>
            <Input
              inputMode="numeric"
              value={height.draft}
              suffix={canvas.unit}
              invalid={Boolean(height.error)}
              onChange={(event) => {
                height.setDraft(event.target.value);
              }}
              onBlur={height.onBlur}
              onKeyDown={height.onKeyDown}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit" hint="Re-expresses the same canvas in another unit.">
            <Select
              value={canvas.unit}
              options={LENGTH_UNITS.map((unit) => ({
                value: unit,
                label: LENGTH_UNIT_LABELS[unit],
              }))}
              onChange={(event) => {
                void api.commit(`Switch units to ${event.target.value}`, {
                  canvas: { ...canvas, unit: event.target.value as Canvas['unit'] },
                });
              }}
            />
          </Field>
          <Field label="Resolution" error={dpi.error}>
            <Input
              inputMode="numeric"
              value={dpi.draft}
              suffix="dpi"
              invalid={Boolean(dpi.error)}
              onChange={(event) => {
                dpi.setDraft(event.target.value);
              }}
              onBlur={dpi.onBlur}
              onKeyDown={dpi.onKeyDown}
            />
          </Field>
        </div>

        <Field label="Background">
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Background colour"
              value={canvas.transparent ? '#000000' : canvas.background}
              disabled={canvas.transparent}
              onFocus={() => {
                backgroundPicker.current += 1;
              }}
              onBlur={() => {
                // Closing the picker ends the session: one visit, one history entry.
                backgroundPicker.current += 1;
              }}
              onChange={(event) => {
                void api.commit(
                  'Change background colour',
                  { canvas: { ...canvas, background: event.target.value } },
                  { coalesceKey: `color:canvas-background:${String(backgroundPicker.current)}` },
                );
              }}
              className="border-line-strong bg-ink-950 h-9 w-12 cursor-pointer rounded-sm border p-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Input
              aria-label="Background hex value"
              value={canvas.background}
              disabled={canvas.transparent}
              readOnly
              className="forge-numeric"
            />
          </div>
        </Field>

        <SwitchField
          label="Transparent background"
          description="For artwork placed over something else. Not every format can store alpha, and the export checks will say so."
          checked={canvas.transparent}
          onCheckedChange={(checked) => {
            void api.commit(checked ? 'Make background transparent' : 'Add background colour', {
              canvas: { ...canvas, transparent: checked },
            });
          }}
        />

        <DataList
          className="pt-1"
          items={[
            { label: 'Aspect ratio', value: aspectRatioLabel(canvas), mono: true },
            { label: 'Density', value: megapixelLabel(canvas), mono: true },
            {
              label: 'Safe area',
              value: `${String(Math.round(canvas.width - toPixels(api.doc.guides.safeMarginMm, 'mm', canvas.dpi) * 2))} × ${String(Math.round(canvas.height - toPixels(api.doc.guides.safeMarginMm, 'mm', canvas.dpi) * 2))} px`,
              mono: true,
            },
          ]}
        />
      </div>
    </section>
  );
}

function GuidesSection({ api }: { readonly api: WorkspaceApi }) {
  const { guides, canvas } = api.doc;

  const commitGuides = (patch: Partial<GuideSettings>, label: string): string | null => {
    const next: GuideSettings = { ...guides, ...patch };
    const issue = validateGuides(next)[0];
    if (issue) return issue.message;
    void api.commit(label, { guides: next });
    return null;
  };

  const numberField = (
    label: string,
    value: number,
    range: readonly [number, number],
    apply: (next: number, label: string) => string | null,
    unitLabel: string,
  ) => (
    <NumberField
      label={label}
      suffix="mm"
      value={value}
      onCommit={(next) => {
        if (next < range[0] || next > range[1]) {
          return `${label} must be between ${String(range[0])} and ${String(range[1])} mm.`;
        }
        return apply(next, `${label} set to ${String(next)} mm`);
      }}
      hint={unitLabel}
    />
  );

  return (
    <section aria-labelledby="inspector-guides">
      <div id="inspector-guides">
        <SectionHeader
          title="Guides"
          hint="Overlays only — guides never appear in an exported file, but they decide whether content survives trimming."
        />
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {numberField(
            'Safe margin',
            guides.safeMarginMm,
            [0, 100],
            (next, label) => commitGuides({ safeMarginMm: next }, label),
            'Inset from every edge',
          )}
          {numberField(
            'Bleed',
            guides.bleedMm,
            [0, 50],
            (next, label) => commitGuides({ bleedMm: next }, label),
            'Artwork beyond the trim',
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {numberField(
            'Grid spacing',
            guides.gridMm,
            [1, 100],
            (next, label) => commitGuides({ gridMm: next }, label),
            'Evenly spaced lines',
          )}
          <div className="pt-1">
            <SwitchField
              label="Grid"
              checked={guides.showGrid}
              onCheckedChange={(checked) => {
                commitGuides({ showGrid: checked }, checked ? 'Show grid' : 'Hide grid');
              }}
            />
          </div>
        </div>

        <SwitchField
          label="Centre lines"
          checked={guides.showCentreLines}
          onCheckedChange={(checked) => {
            commitGuides(
              { showCentreLines: checked },
              checked ? 'Show centre lines' : 'Hide centre lines',
            );
          }}
        />

        <InlineNote tone="neutral" icon={<Info aria-hidden />}>
          <p>
            Safe area is{' '}
            <span className="forge-numeric text-fg">
              {formatLength(
                toPixels(guides.safeMarginMm, 'mm', canvas.dpi),
                canvas.unit,
                canvas.dpi,
              )}
            </span>{' '}
            inside every edge
            {guides.bleedMm > 0
              ? `, with ${String(guides.bleedMm)} mm of bleed for trimming.`
              : '. No bleed is set, which is correct for screen-only work.'}
          </p>
        </InlineNote>

        <Button
          variant="outline"
          size="sm"
          fullWidth
          iconLeft={<Wand2 aria-hidden />}
          onClick={() => {
            void api.commit('Apply print-ready guide defaults', {
              guides: { ...DEFAULT_GUIDES, safeMarginMm: 12, bleedMm: 3, showGrid: true },
            });
          }}
        >
          Apply print-ready defaults (3 mm bleed, 12 mm margin)
        </Button>
      </div>
    </section>
  );
}

function PaletteSection({ api }: { readonly api: WorkspaceApi }) {
  const [draftColor, setDraftColor] = useState('#2b5fd9');
  const { palette } = api.doc;
  const samplePalettes = SAMPLE_ASSETS.filter((asset) => asset.kind === 'palette').slice(0, 3);

  return (
    <section aria-labelledby="inspector-palette">
      <div id="inspector-palette">
        <SectionHeader
          title="Palette"
          hint="Colour decisions travel with the document, so a studio or export step can reuse them later."
        />
      </div>

      <div className="space-y-4">
        {palette.length > 0 ? (
          <ul className="space-y-2">
            {palette.map((color) => (
              <li key={color} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="border-line-strong size-6 rounded-xs border"
                  style={{ backgroundColor: color }}
                />
                <span className="forge-numeric text-fg-muted flex-1 text-sm">{color}</span>
                <Button
                  variant="quiet"
                  size="sm"
                  aria-label={`Remove ${color} from the palette`}
                  onClick={() => {
                    void api.commit('Remove palette colour', {
                      palette: palette.filter((existing) => existing !== color),
                    });
                  }}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-muted text-sm">
            No palette yet. Add colours below, or start from a bundled sample palette.
          </p>
        )}

        <div className="flex items-end gap-2">
          <Field label="Add colour" className="flex-1">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Colour to add"
                value={draftColor}
                onChange={(event) => {
                  setDraftColor(event.target.value);
                }}
                className="border-line-strong bg-ink-950 h-9 w-12 cursor-pointer rounded-sm border p-1"
              />
              <Input
                value={draftColor}
                aria-label="Colour hex value"
                className="forge-numeric"
                onChange={(event) => {
                  setDraftColor(event.target.value);
                }}
              />
            </div>
          </Field>
          <Button
            variant="secondary"
            iconLeft={<Plus aria-hidden />}
            disabled={palette.length >= 12 || !/^#[0-9a-fA-F]{6}$/.test(draftColor)}
            onClick={() => {
              if (palette.includes(draftColor)) return;
              void api.commit(`Add ${draftColor} to palette`, {
                palette: [...palette, draftColor],
              });
            }}
          >
            Add
          </Button>
        </div>
        {palette.length >= 12 ? (
          <p className="text-xs text-amber-400">A document carries at most 12 palette colours.</p>
        ) : null}

        <div className="border-line-subtle space-y-2 border-t pt-3">
          <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
            Sample palettes
          </p>
          {samplePalettes.map((asset) => {
            const colors = asset.preview.kind === 'swatch' ? asset.preview.colors : [];
            return (
              <div key={asset.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-fg truncate text-sm">{asset.name}</p>
                  <SwatchRow colors={colors} size="sm" className="mt-1" />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // The command normalises, bounds and labels the palette; the same one the
                    // catalogue's palette records would use.
                    void api.run(applyPaletteCommand(colors, asset.name));
                  }}
                >
                  Use
                </Button>
              </div>
            );
          })}
          <p className="text-2xs text-fg-subtle">
            Placeholder colours from the sample catalogue, not a licensed brand kit.
          </p>
        </div>
      </div>
    </section>
  );
}

function DetailsSection({ api }: { readonly api: WorkspaceApi }) {
  const { doc } = api;

  const title = useDraftField({
    value: doc.title,
    onCommit: (raw) => {
      const issue = validateTitle(raw)[0];
      if (issue) return issue.message;
      void api.commit('Rename project', { title: raw.trim() });
      return null;
    },
  });

  const summary = useDraftField({
    value: doc.summary,
    onCommit: (raw) => {
      void api.commit('Update summary', { summary: raw.slice(0, 400) });
      return null;
    },
  });

  const notes = useDraftField({
    value: doc.metadata.notes,
    onCommit: (raw) => {
      void api.commit('Update notes', {
        metadata: { ...doc.metadata, notes: raw.slice(0, MAX_NOTES_LENGTH) },
      });
      return null;
    },
  });

  const tags = useDraftField({
    value: doc.metadata.tags.join(', '),
    onCommit: (raw) => {
      const parsed = raw
        .split(',')
        .map((tag) => tag.trim().slice(0, MAX_TAG_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_DOCUMENT_TAGS);
      void api.commit('Update tags', { metadata: { ...doc.metadata, tags: parsed } });
      return null;
    },
  });

  return (
    <section aria-labelledby="inspector-details">
      <div id="inspector-details">
        <SectionHeader
          title="Project details"
          hint="What this project is called, and what state it is in."
        />
      </div>

      <div className="space-y-4">
        <Field label="Name" error={title.error}>
          <Input
            value={title.draft}
            invalid={Boolean(title.error)}
            onChange={(event) => {
              title.setDraft(event.target.value);
            }}
            onBlur={title.onBlur}
            onKeyDown={title.onKeyDown}
          />
        </Field>

        <Field label="Summary" error={summary.error} hint="One line describing the intended use.">
          <Textarea
            value={summary.draft}
            onChange={(event) => {
              summary.setDraft(event.target.value);
            }}
            onBlur={summary.onBlur}
            onKeyDown={summary.onKeyDown}
            placeholder="e.g. Launch announcement for the September release"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select
              value={doc.status}
              options={DOCUMENT_STATUSES.map((status) => ({
                value: status,
                label: DOCUMENT_STATUS_LABELS[status],
              }))}
              onChange={(event) => {
                void api.commit('Change project status', {
                  status: event.target.value as DocumentStatus,
                });
              }}
            />
          </Field>
          <Field label="Revision" hint="Increases with every saved change.">
            <Input readOnly value={String(doc.revision)} className="forge-numeric" />
          </Field>
        </div>

        <Field
          label="Tags"
          error={tags.error}
          hint={`Comma separated, maximum ${String(MAX_DOCUMENT_TAGS)} of ${String(MAX_TAG_LENGTH)} characters.`}
        >
          <Input
            value={tags.draft}
            onChange={(event) => {
              tags.setDraft(event.target.value);
            }}
            onBlur={tags.onBlur}
            onKeyDown={tags.onKeyDown}
            placeholder="social, launch, q3"
          />
        </Field>

        <Field
          label="Notes"
          error={notes.error}
          hint="Anything a future you should know about this file."
        >
          <Textarea
            value={notes.draft}
            onChange={(event) => {
              notes.setDraft(event.target.value);
            }}
            onBlur={notes.onBlur}
            placeholder="Context, decisions, who it is for…"
          />
        </Field>

        <DataList
          items={[
            { label: 'Document type', value: doc.documentTypeId, mono: true },
            { label: 'Schema version', value: `v${String(doc.schemaVersion)}`, mono: true },
            { label: 'Created', value: new Date(doc.createdAt).toLocaleDateString() },
            { label: 'Updated', value: new Date(doc.updatedAt).toLocaleDateString() },
          ]}
        />
      </div>
    </section>
  );
}

function NumberField({
  label,
  suffix,
  value,
  onCommit,
  hint,
}: {
  readonly label: string;
  readonly suffix?: string;
  readonly value: number;
  readonly onCommit: (value: number) => string | null;
  readonly hint?: string;
}) {
  const field = useDraftField({
    value: String(value),
    onCommit: (raw) => {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return 'Enter a number.';
      return onCommit(parsed);
    },
  });

  return (
    <Field label={label} hint={hint} error={field.error}>
      <Input
        inputMode="decimal"
        value={field.draft}
        {...(suffix === undefined ? {} : { suffix })}
        invalid={Boolean(field.error)}
        onChange={(event) => {
          field.setDraft(event.target.value);
        }}
        onBlur={field.onBlur}
        onKeyDown={field.onKeyDown}
      />
    </Field>
  );
}
