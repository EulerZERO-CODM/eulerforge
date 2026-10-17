'use client';

import { ArrowLeft, ArrowRight, Check, CircleAlert, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { SAMPLE_ASSETS } from '../../core/assets/data';
import { DEFAULT_GUIDES } from '../../core/documents/factories';
import { aspectRatioLabel, megapixelLabel } from '../../core/documents/geometry';
import { CANVAS_PRESETS, getCanvasPreset } from '../../core/documents/presets';
import { getDocumentType } from '../../core/documents/document-types';
import { getLayoutStarter } from '../../core/documents/starters';
import {
  CANVAS_PRESET_CATEGORY_LABELS,
  type Canvas,
  type CanvasPresetCategory,
  type GuideSettings,
} from '../../core/documents/types';
import {
  documentTypesForStudio,
  ILLUSTRATION_ARTBOARD_ID,
} from '../../core/documents/document-types';
import { LENGTH_UNITS, LENGTH_UNIT_LABELS, formatLength } from '../../core/documents/units';
import { validateCanvas, validateGuides, validateTitle } from '../../core/documents/validation';
import { studioRegistry } from '../../core/studios';
import { cn } from '../../lib/cn';
import { useForgeServices } from '../../state/forge-provider';
import { useCreationDefaults } from '../../state/hooks';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { SegmentedControl, SwatchRow } from '../ui/controls';
import { Field, Input, Select, SwitchField, Textarea } from '../ui/field';
import { DataList, Panel } from '../ui/section';
import { InlineNote } from '../ui/states';
import { AvailabilityBadge } from '../studios/availability';
import { StudioGlyph } from '../studios/studio-icon';
import { DocumentPreview } from '../documents/document-preview';

type StepId = 'studio' | 'canvas' | 'details' | 'review';

const STEPS: readonly { readonly id: StepId; readonly label: string; readonly hint: string }[] = [
  { id: 'studio', label: 'Studio', hint: 'Which discipline this project belongs to' },
  { id: 'canvas', label: 'Size', hint: 'The canvas the document is built on' },
  { id: 'details', label: 'Details', hint: 'Name, guides and working palette' },
  { id: 'review', label: 'Review', hint: 'Confirm what will be created' },
];

/**
 * Project creation flow.
 *
 * Four real steps that end in a validated document persisted to local storage. Nothing is created
 * until the review step is confirmed, the canvas and name are validated with the same rules the
 * store enforces, and the flow can be entered with a preselected preset (`?preset=`) so starter
 * actions land somewhere meaningful.
 */
export function CreationFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { documents, toasts, preferences } = useForgeServices();
  const defaults = useCreationDefaults();

  const requestedPreset = searchParams.get('preset');
  const layoutStarter = getLayoutStarter(searchParams.get('starter'));
  // A starter documents its own canvas, so it wins over a bare `?preset=`; an explicit `?preset=`
  // still wins over the starter so a shared link can override the arrangement's default size.
  const initialPreset = requestedPreset
    ? getCanvasPreset(requestedPreset)
    : layoutStarter
      ? getCanvasPreset(layoutStarter.presetId)
      : undefined;

  const [step, setStep] = useState<StepId>('studio');
  const [studioId, setStudioId] = useState<string>(
    searchParams.get('studio') ?? defaults.preferredStudioId,
  );
  const [presetId, setPresetId] = useState<string | null>(initialPreset ? initialPreset.id : null);
  const [category, setCategory] = useState<CanvasPresetCategory>(
    initialPreset?.category ?? 'social',
  );
  const [canvas, setCanvas] = useState<Canvas>(
    initialPreset
      ? {
          width: initialPreset.size.width,
          height: initialPreset.size.height,
          unit: initialPreset.unit,
          dpi: initialPreset.dpi,
          background: initialPreset.background,
          transparent: false,
        }
      : {
          width: 1080,
          height: 1350,
          unit: 'px',
          dpi: 96,
          background: '#0f1115',
          transparent: false,
        },
  );
  const [guides, setGuides] = useState<GuideSettings>(
    layoutStarter ? layoutStarter.guides : preferences.getState().preferences.defaultGuides,
  );
  const [title, setTitle] = useState(
    layoutStarter
      ? layoutStarter.titleSuggestion
      : initialPreset
        ? `${initialPreset.label} project`
        : '',
  );
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState('');
  const [paletteId, setPaletteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const studios = studioRegistry.list();
  const paletteAssets = useMemo(
    () =>
      SAMPLE_ASSETS.filter((asset) => asset.kind === 'palette' && asset.preview.kind === 'swatch'),
    [],
  );
  const selectedPalette = paletteAssets.find((asset) => (asset.id as string) === paletteId);
  const paletteColors =
    selectedPalette && selectedPalette.preview.kind === 'swatch'
      ? selectedPalette.preview.colors
      : [];

  const canvasIssues = validateCanvas(canvas);
  const guideIssues = validateGuides(guides);
  const titleIssues = validateTitle(title);
  const canContinueFromCanvas = canvasIssues.length === 0;
  const canSubmit =
    canvasIssues.length === 0 && guideIssues.length === 0 && titleIssues.length === 0;

  const stepIndex = STEPS.findIndex((candidate) => candidate.id === step);

  // The studio decides the document type. A studio whose only type is still planned cannot create
  // anything, so the flow refuses instead of silently writing a design canvas.
  const availableTypes = documentTypesForStudio(studioId).filter(
    (type) => type.availability === 'available',
  );
  const documentType = availableTypes[0];

  async function handleCreate() {
    setSubmitError(null);
    if (!documentType) {
      setSubmitError(`${studioRegistry.require(studioId).name} has no document type yet.`);
      return;
    }
    setSubmitting(true);
    const result = await documents.create({
      title,
      summary: summary.trim(),
      studioId,
      documentTypeId: documentType.id,
      canvas,
      guides,
      palette: paletteColors,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12),
    });
    setSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error.message);
      toasts.error('The project could not be created', result.error.message);
      return;
    }

    toasts.success('Project created', `“${result.value.title}” is saved in this browser.`);
    router.push(`/workspace/${result.value.id}`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <ol
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          aria-label="Creation steps"
        >
          {STEPS.map((candidate, index) => {
            const state = index === stepIndex ? 'current' : index < stepIndex ? 'done' : 'upcoming';
            return (
              <li key={candidate.id} className="inline-flex items-center gap-2">
                <button
                  type="button"
                  aria-current={state === 'current' ? 'step' : undefined}
                  onClick={() => {
                    // Only allow going back to steps already visited.
                    if (index <= stepIndex) setStep(candidate.id);
                  }}
                  disabled={index > stepIndex}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-sm px-2 py-1 transition-colors',
                    state === 'current' && 'bg-ink-850 text-fg',
                    state === 'done' && 'text-mint-400 hover:bg-ink-900',
                    state === 'upcoming' && 'text-fg-subtle',
                    index <= stepIndex && 'cursor-pointer',
                  )}
                >
                  {state === 'done' ? (
                    <Check aria-hidden className="size-3.5" />
                  ) : (
                    <span className="forge-numeric">{index + 1}</span>
                  )}
                  {candidate.label}
                </button>
                {index < STEPS.length - 1 ? (
                  <span aria-hidden className="text-fg-subtle">
                    /
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>

        {layoutStarter ? (
          <InlineNote tone="info" title={`Layout starter: ${layoutStarter.label}`}>
            <p>
              {layoutStarter.description} Its canvas and guides are already selected below — change
              anything you like. The starter arranges guides; you place the artwork.
            </p>
          </InlineNote>
        ) : null}

        {step === 'studio' ? (
          <section aria-labelledby="step-studio" className="space-y-3">
            <h2 id="step-studio" className="text-fg text-lg font-semibold">
              Choose a studio
            </h2>
            <p className="text-fg-muted text-sm">
              A studio decides which tools and export formats the project will use. The studios with
              a working editor can create documents; the others are visible so you can see what is
              coming.
            </p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {studios.map((studio) => {
                const selectable = studio.availability === 'available';
                const selected = studioId === (studio.id as string);
                return (
                  <li key={studio.id}>
                    <button
                      type="button"
                      disabled={!selectable}
                      aria-pressed={selected}
                      onClick={() => {
                        setStudioId(studio.id);
                      }}
                      className={cn(
                        'flex h-full w-full items-start gap-3 rounded-md border p-3.5 text-left transition-colors',
                        selected ? 'border-accent bg-ink-900' : 'border-line bg-surface-raised/50',
                        selectable ? 'hover:border-line-strong' : 'cursor-not-allowed opacity-70',
                      )}
                    >
                      <StudioGlyph name={studio.icon} accent={studio.accent} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-fg text-base font-medium">{studio.name}</span>
                          <AvailabilityBadge availability={studio.availability} />
                        </span>
                        <span className="text-fg-muted mt-1 block text-sm">{studio.tagline}</span>
                        {!selectable ? (
                          <span className="text-fg-subtle mt-2 block text-xs">
                            {studio.maturityNote}
                          </span>
                        ) : (
                          <span className="text-fg-subtle mt-2 block text-xs">
                            {studio.documentTypes
                              .map((id) => getDocumentType(id)?.label)
                              .filter((label): label is string => label !== undefined)
                              .join(', ')}
                            .
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {step === 'canvas' ? (
          <section aria-labelledby="step-canvas" className="space-y-4">
            <div>
              <h2 id="step-canvas" className="text-fg text-lg font-semibold">
                Choose a size
              </h2>
              <p className="text-fg-muted mt-0.5 text-sm">
                Start from a preset or type exact dimensions. Either way you can change it later —
                every change is undoable.
              </p>
            </div>

            <SegmentedControl
              label="Preset category"
              value={category}
              onChange={(next) => {
                setCategory(next);
              }}
              options={(['social', 'video', 'web', 'presentation', 'print'] as const).map(
                (value) => ({
                  value,
                  label: CANVAS_PRESET_CATEGORY_LABELS[value],
                  count: CANVAS_PRESETS.filter((preset) => preset.category === value).length,
                }),
              )}
            />

            <ul className="grid gap-2 sm:grid-cols-2">
              {CANVAS_PRESETS.filter((preset) => preset.category === category).map((preset) => {
                const selected = presetId === (preset.id as string);
                return (
                  <li key={preset.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setPresetId(preset.id);
                        setCanvas({
                          width: preset.size.width,
                          height: preset.size.height,
                          unit: preset.unit,
                          dpi: preset.dpi,
                          background: preset.background,
                          transparent: false,
                        });
                        if (!title.trim()) setTitle(`${preset.label} project`);
                      }}
                      className={cn(
                        'w-full rounded-md border p-3 text-left transition-colors',
                        selected
                          ? 'border-accent bg-ink-900'
                          : 'border-line bg-surface-raised/50 hover:border-line-strong',
                      )}
                    >
                      <span className="text-fg block text-base font-medium">{preset.label}</span>
                      <span className="text-fg-muted mt-0.5 block text-xs">
                        {preset.description}
                      </span>
                      <span className="forge-numeric text-2xs text-fg-subtle mt-1.5 block">
                        {preset.size.width} × {preset.size.height} {preset.unit} ·{' '}
                        {aspectRatioLabel(preset.size)} · {preset.dpi} dpi
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <Panel className="p-4">
              <h3 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
                Custom dimensions
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Width" error={fieldError(canvasIssues, 'canvas')}>
                  <Input
                    type="number"
                    value={canvas.width}
                    suffix={canvas.unit}
                    onChange={(event) => {
                      setPresetId(null);
                      setCanvas({ ...canvas, width: Number(event.target.value) });
                    }}
                  />
                </Field>
                <Field label="Height">
                  <Input
                    type="number"
                    value={canvas.height}
                    suffix={canvas.unit}
                    onChange={(event) => {
                      setPresetId(null);
                      setCanvas({ ...canvas, height: Number(event.target.value) });
                    }}
                  />
                </Field>
                <Field label="Unit">
                  <Select
                    value={canvas.unit}
                    options={LENGTH_UNITS.map((unit) => ({
                      value: unit,
                      label: LENGTH_UNIT_LABELS[unit],
                    }))}
                    onChange={(event) => {
                      setPresetId(null);
                      setCanvas({ ...canvas, unit: event.target.value as Canvas['unit'] });
                    }}
                  />
                </Field>
                <Field label="DPI" error={fieldError(canvasIssues, 'dpi')}>
                  <Input
                    type="number"
                    value={canvas.dpi}
                    suffix="dpi"
                    onChange={(event) => {
                      setCanvas({ ...canvas, dpi: Number(event.target.value) });
                    }}
                  />
                </Field>
              </div>
            </Panel>
          </section>
        ) : null}

        {step === 'details' ? (
          <section aria-labelledby="step-details" className="space-y-5">
            <div>
              <h2 id="step-details" className="text-fg text-lg font-semibold">
                Name it and set it up
              </h2>
              <p className="text-fg-muted mt-0.5 text-sm">
                These are real document settings, not preferences: they are saved with the project.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Project name"
                error={fieldError(titleIssues, 'title')}
                hint="Required. You can rename it later."
              >
                <Input
                  value={title}
                  invalid={titleIssues.length > 0}
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                  placeholder="September launch post"
                />
              </Field>
              <Field label="Tags" hint="Optional, comma separated.">
                <Input
                  value={tags}
                  onChange={(event) => {
                    setTags(event.target.value);
                  }}
                  placeholder="social, launch"
                />
              </Field>
            </div>

            <Field label="Summary" hint="Optional, one line about the intended use.">
              <Textarea
                value={summary}
                onChange={(event) => {
                  setSummary(event.target.value);
                }}
                placeholder="Announcement graphic for the September release"
              />
            </Field>

            <Panel className="space-y-4 p-4">
              <h3 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
                Guides
              </h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Safe margin" error={fieldError(guideIssues, 'safeMarginMm')}>
                  <Input
                    type="number"
                    value={guides.safeMarginMm}
                    suffix="mm"
                    onChange={(event) => {
                      setGuides({ ...guides, safeMarginMm: Number(event.target.value) });
                    }}
                  />
                </Field>
                <Field label="Bleed" error={fieldError(guideIssues, 'bleedMm')}>
                  <Input
                    type="number"
                    value={guides.bleedMm}
                    suffix="mm"
                    onChange={(event) => {
                      setGuides({ ...guides, bleedMm: Number(event.target.value) });
                    }}
                  />
                </Field>
                <Field label="Grid spacing" error={fieldError(guideIssues, 'gridMm')}>
                  <Input
                    type="number"
                    value={guides.gridMm}
                    suffix="mm"
                    onChange={(event) => {
                      setGuides({ ...guides, gridMm: Number(event.target.value) });
                    }}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SwitchField
                  label="Show grid"
                  description="A visible measurement grid on the artboard."
                  checked={guides.showGrid}
                  onCheckedChange={(checked) => {
                    setGuides({ ...guides, showGrid: checked });
                  }}
                />
                <SwitchField
                  label="Centre lines"
                  checked={guides.showCentreLines}
                  onCheckedChange={(checked) => {
                    setGuides({ ...guides, showCentreLines: checked });
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setGuides({ ...DEFAULT_GUIDES, safeMarginMm: 12, bleedMm: 3, showGrid: true });
                }}
              >
                Print-ready defaults (3 mm bleed, 12 mm margin)
              </Button>
            </Panel>

            <Panel className="space-y-3 p-4">
              <h3 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
                Working palette (optional)
              </h3>
              <ul className="space-y-2">
                {paletteAssets.map((asset) => {
                  const colors = asset.preview.kind === 'swatch' ? asset.preview.colors : [];
                  const selected = paletteId === (asset.id as string);
                  return (
                    <li key={asset.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setPaletteId(selected ? null : asset.id);
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-sm border px-2.5 py-2 text-left transition-colors',
                          selected
                            ? 'border-accent bg-ink-900'
                            : 'border-line hover:border-line-strong',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="text-fg block text-sm">{asset.name}</span>
                          <span className="mt-1 block">
                            <SwatchRow colors={colors} size="sm" />
                          </span>
                        </span>
                        {selected ? <Badge tone="accent">Selected</Badge> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-2xs text-fg-subtle">
                Sample palettes from the bundled catalogue — clearly-labelled placeholder content,
                not a licensed brand kit.
              </p>
            </Panel>
          </section>
        ) : null}

        {step === 'review' ? (
          <section aria-labelledby="step-review" className="space-y-4">
            <div>
              <h2 id="step-review" className="text-fg text-lg font-semibold">
                Review and create
              </h2>
              <p className="text-fg-muted mt-0.5 text-sm">
                Creating writes a validated document to this browser’s local storage. Nothing is
                uploaded.
              </p>
            </div>

            <Panel className="p-4">
              <DataList
                columns={2}
                items={[
                  { label: 'Name', value: title.trim() || '—' },
                  { label: 'Studio', value: studioRegistry.require(studioId).name },
                  {
                    label: 'Document type',
                    value: documentType ? documentType.label : 'none available yet',
                  },
                  {
                    label: 'Canvas',
                    value: `${canvas.width} × ${canvas.height} ${canvas.unit}`,
                    mono: true,
                  },
                  { label: 'Aspect ratio', value: aspectRatioLabel(canvas), mono: true },
                  { label: 'Resolution', value: `${canvas.dpi} dpi`, mono: true },
                  { label: 'Density', value: megapixelLabel(canvas), mono: true },
                  {
                    label: 'Safe margin',
                    value: formatLength(guides.safeMarginMm, 'mm', canvas.dpi),
                    mono: true,
                  },
                  {
                    label: 'Bleed',
                    value: guides.bleedMm > 0 ? `${guides.bleedMm} mm` : 'none',
                    mono: true,
                  },
                  { label: 'Palette', value: selectedPalette ? selectedPalette.name : 'not set' },
                  { label: 'Tags', value: tags.trim() || 'none' },
                ]}
              />
            </Panel>

            {layoutStarter ? (
              <Panel className="space-y-3 p-4">
                <div>
                  <h3 className="text-fg text-sm font-semibold">
                    Starter layout: {layoutStarter.label}
                  </h3>
                  <p className="text-fg-muted mt-0.5 text-xs">{layoutStarter.description}</p>
                </div>
                <dl className="space-y-2">
                  {layoutStarter.regions.map((region) => (
                    <div key={region.label} className="border-line border-l pl-3">
                      <dt className="text-fg text-xs font-medium">{region.label}</dt>
                      <dd className="text-fg-muted text-xs">{region.guidance}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-2xs text-fg-subtle">
                  The starter sets the canvas and these guides. You draw into the regions yourself —
                  this build has no automatic layout engine.
                </p>
              </Panel>
            ) : null}

            {!canSubmit ? (
              <InlineNote
                tone="warning"
                icon={<CircleAlert aria-hidden />}
                title="Fix these before creating"
              >
                <ul className="list-disc space-y-1 pl-4">
                  {[...titleIssues, ...canvasIssues, ...guideIssues].map((issue) => (
                    <li key={`${issue.field}-${issue.message}`}>
                      {issue.field}: {issue.message}
                    </li>
                  ))}
                </ul>
              </InlineNote>
            ) : null}

            {submitError ? (
              <InlineNote tone="danger" title="Creation failed">
                <p>{submitError}</p>
              </InlineNote>
            ) : null}

            <InlineNote tone="tip" icon={<Sparkles aria-hidden />}>
              {documentType?.id === ILLUSTRATION_ARTBOARD_ID ? (
                <p>
                  After creating, the workspace opens a vector artboard: draw paths with the pen,
                  place shapes, edit nodes and Bezier handles, set real fills and strokes, combine
                  shapes with boolean operations, undo any edit, and import or export SVG — plus an
                  icon-set export for several objects at once.
                </p>
              ) : (
                <p>
                  After creating, the workspace lets you add text, rectangle and ellipse layers,
                  select, move and resize them, edit typography and shape settings, undo anything
                  you change, and export PNG, JPEG or the project file. Vector drawing lives in the
                  Illustration Studio.
                </p>
              )}
            </InlineNote>
          </section>
        ) : null}

        <div className="border-line flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button
            variant="quiet"
            iconLeft={<ArrowLeft aria-hidden />}
            disabled={stepIndex === 0}
            onClick={() => {
              const previous = STEPS[Math.max(0, stepIndex - 1)];
              if (previous) setStep(previous.id);
            }}
          >
            Back
          </Button>

          <div className="flex items-center gap-2">
            <Button asChild variant="quiet">
              <Link href="/">Cancel</Link>
            </Button>
            {step === 'review' ? (
              <Button
                variant="primary"
                loading={submitting}
                loadingLabel="Creating project"
                disabled={!canSubmit}
                onClick={() => {
                  void handleCreate();
                }}
                iconLeft={<Check aria-hidden />}
              >
                Create project
              </Button>
            ) : (
              <Button
                variant="primary"
                iconRight={<ArrowRight aria-hidden />}
                disabled={step === 'canvas' && !canContinueFromCanvas}
                onClick={() => {
                  const next = STEPS[Math.min(STEPS.length - 1, stepIndex + 1)];
                  if (next) setStep(next.id);
                }}
              >
                Continue
              </Button>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-[4.25rem] lg:self-start">
        <Panel className="p-4">
          <h2 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
            Live preview
          </h2>
          <div className="mt-3">
            <DocumentPreview canvas={canvas} guides={guides} sizing={{ kind: 'fluid' }} />
          </div>
          <p className="text-fg-subtle mt-3 text-xs">
            This preview renders the document specification — background, safe area, bleed and grid
            — from the values you have chosen.
          </p>
        </Panel>

        <Panel className="space-y-2 p-4">
          <h2 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
            What gets created
          </h2>
          <ul className="text-fg-muted space-y-1.5 text-xs">
            <li>• A schema-validated document record saved in this browser</li>
            <li>• Canvas, guides, palette, tags and metadata</li>
            <li>• A project file you can export at any time (.forge.json)</li>
          </ul>
          <p className="text-2xs text-fg-subtle">
            No account, no upload, no cross-device sync. Read{' '}
            <Link
              href="/learn/how-your-projects-are-stored"
              className="underline decoration-1 underline-offset-2"
            >
              how storage works
            </Link>
            .
          </p>
        </Panel>
      </aside>
    </div>
  );
}

function fieldError(
  issues: readonly { field: string; message: string }[],
  field: string,
): string | null {
  return issues.find((issue) => issue.field === field)?.message ?? null;
}
