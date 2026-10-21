'use client';

import { Database, Info, RotateCcw, Settings2, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { CANVAS_PRESETS } from '../../core/documents/presets';
import { DEFAULT_GUIDES } from '../../core/documents/factories';
import { CURRENT_SCHEMA_VERSION } from '../../core/documents/migrations';
import { EXPORT_FORMATS } from '../../core/export/formats';
import { LENGTH_UNITS, LENGTH_UNIT_LABELS } from '../../core/documents/units';
import { PREFERENCE_FIELDS } from '../../core/preferences/types';
import { studioRegistry } from '../../core/studios';
import { env } from '../../config/env';
import { formatBytes, pluralise } from '../../lib/format';
import { useForgeServices } from '../../state/forge-provider';
import {
  useDocuments,
  useLearningProgress,
  usePreferences,
  useStorageStatus,
} from '../../state/hooks';
import { isVolatile } from '../../state/storage-status';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/dialog';
import { Field, Input, Select, SwitchField } from '../ui/field';
import { DataList, Panel, SectionHeading } from '../ui/section';
import { InlineNote } from '../ui/states';
import { StatusDot } from '../ui/controls';

/** Keeps a number inside the range the preferences schema accepts. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Settings.
 *
 * Three real sections — document defaults, catalogue behaviour, and local data management — plus an
 * explicit "not available" section for accounts, plans and collaboration. Diagnostics show the
 * validated environment and the actual storage footprint so nothing has to be taken on trust.
 */
export function SettingsView() {
  const { documents, preferences, learning, toasts } = useForgeServices();
  const storageStatus = useStorageStatus();
  const volatile = isVolatile(storageStatus);
  const preferenceState = usePreferences();
  const library = useDocuments();
  useLearningProgress();

  const [health, setHealth] = useState<{ count: number; skipped: number; bytes: number } | null>(
    null,
  );
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    void documents.health().then((result) => {
      if (result.ok) setHealth(result.value);
    });
  }, [documents, library.documents]);

  const prefs = preferenceState.preferences;
  const section = (id: string) => PREFERENCE_FIELDS.filter((field) => field.section === id);

  return (
    <div className="space-y-8">
      <Panel className="space-y-4 p-4">
        <SectionHeading
          title="Document defaults"
          description="Applied when a new project is created. Existing projects are never changed by these settings."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={section('documents')[0]?.label ?? 'Default unit'}
            hint={section('documents')[0]?.description}
          >
            <Select
              value={prefs.defaultUnit}
              onChange={(event) => {
                preferences.update({ defaultUnit: event.target.value as typeof prefs.defaultUnit });
              }}
              options={LENGTH_UNITS.map((unit) => ({
                value: unit,
                label: LENGTH_UNIT_LABELS[unit],
              }))}
            />
          </Field>

          <Field
            label={section('documents')[2]?.label ?? 'Preferred studio'}
            hint={section('documents')[2]?.description}
          >
            <Select
              value={prefs.preferredStudioId}
              onChange={(event) => {
                preferences.update({ preferredStudioId: event.target.value });
              }}
              options={studioRegistry
                .list()
                .filter((studio) => studio.availability === 'available')
                .map((studio) => ({ value: studio.id, label: studio.name }))}
            />
          </Field>

          <Field
            label={section('documents')[3]?.label ?? 'Default export format'}
            hint={section('documents')[3]?.description}
          >
            <Select
              value={prefs.defaultExportFormatId}
              onChange={(event) => {
                preferences.update({ defaultExportFormatId: event.target.value });
              }}
              options={EXPORT_FORMATS.map((format) => ({
                value: format.id,
                label: `${format.label}${format.status === 'planned' ? ' — planned' : ''}`,
              }))}
            />
          </Field>

          <Field
            label="Default preset (informational)"
            hint="Presets are chosen in the creation flow."
          >
            <Select
              value={CANVAS_PRESETS[0]?.id}
              disabled
              options={CANVAS_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Default safe margin">
            <Input
              type="number"
              min={0}
              max={100}
              suffix="mm"
              value={prefs.defaultGuides.safeMarginMm}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                preferences.update({
                  defaultGuides: {
                    ...prefs.defaultGuides,
                    // Clamped, because the value has to satisfy the preferences schema: an
                    // out-of-range number would otherwise be rejected by the repository and the
                    // field would silently keep showing a value that was never saved.
                    safeMarginMm: clamp(next, 0, 100),
                  },
                });
              }}
            />
          </Field>
          <Field label="Default bleed">
            <Input
              type="number"
              min={0}
              max={50}
              suffix="mm"
              value={prefs.defaultGuides.bleedMm}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                preferences.update({
                  defaultGuides: { ...prefs.defaultGuides, bleedMm: clamp(next, 0, 50) },
                });
              }}
            />
          </Field>
          <Field label="Default grid spacing">
            <Input
              type="number"
              min={1}
              max={100}
              suffix="mm"
              value={prefs.defaultGuides.gridMm}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                preferences.update({
                  defaultGuides: { ...prefs.defaultGuides, gridMm: clamp(next, 1, 100) },
                });
              }}
            />
          </Field>
        </div>

        <Button
          variant="outline"
          size="sm"
          iconLeft={<RotateCcw aria-hidden />}
          onClick={() => {
            preferences.update({ defaultGuides: { ...DEFAULT_GUIDES } });
            toasts.info('Guide defaults restored', 'New projects will use the standard values.');
          }}
        >
          Restore standard guide defaults
        </Button>
      </Panel>

      <Panel className="space-y-4 p-4">
        <SectionHeading
          title="Catalogue and discovery"
          description="How the asset catalogue and studio listings behave on this device."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Catalogue page size" hint="Records loaded per page.">
            <Input
              type="number"
              value={prefs.cataloguePageSize}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) {
                  preferences.update({
                    cataloguePageSize: Math.min(48, Math.max(4, Math.round(next))),
                  });
                }
              }}
            />
          </Field>
          <div className="pt-1">
            <SwitchField
              label="Hide studios that are not available yet"
              description="Studio discovery then shows only what can be opened today. Planned studios stay reachable by direct link."
              checked={prefs.hideUpcomingStudios}
              onCheckedChange={(checked) => {
                preferences.update({ hideUpcomingStudios: checked });
              }}
            />
          </div>
        </div>
      </Panel>

      <Panel className="space-y-4 p-4">
        <SectionHeading
          title="Accessibility"
          description="Interface motion and the platform's current accessibility position."
        />
        <Field
          label="Motion"
          hint="Reduces or allows interface animation, overriding the system setting."
        >
          <Select
            value={prefs.motion}
            onChange={(event) => {
              preferences.update({ motion: event.target.value as typeof prefs.motion });
            }}
            options={[
              { value: 'system', label: 'Follow my system setting' },
              { value: 'reduce', label: 'Always reduce motion' },
              { value: 'allow', label: 'Always allow motion' },
            ]}
          />
        </Field>
        <InlineNote tone="neutral" icon={<Info aria-hidden />}>
          <p>
            All interactive controls are keyboard reachable, focus is always visible, and colour is
            never the only signal for state. A full audit with assistive technology is a Phase 2
            task on the roadmap.
          </p>
        </InlineNote>
      </Panel>

      <Panel className="space-y-4 p-4">
        <SectionHeading
          title="Local data"
          description="Everything Euler's Forge stores lives in this browser, on this device."
          actions={<Database aria-hidden className="text-fg-subtle size-4" />}
        />

        {volatile ? (
          <InlineNote
            tone="danger"
            icon={<ShieldAlert aria-hidden />}
            title="Storage is not available, so nothing is being written"
          >
            <p>{storageStatus.notice}</p>
            {storageStatus.detail ? (
              <p className="forge-numeric text-2xs">
                Reported by this browser: {storageStatus.detail}
              </p>
            ) : null}
          </InlineNote>
        ) : null}

        <DataList
          columns={2}
          items={[
            { label: 'Storage mode', value: storageStatus.label },
            {
              label: 'Stored projects',
              value: pluralise(health?.count ?? library.documents.length, 'project'),
            },
            {
              label: 'Unreadable records',
              value: String(health?.skipped ?? library.skipped.length),
            },
            { label: 'Approximate footprint', value: formatBytes(health?.bytes ?? 0) },
            { label: 'Schema version', value: `v${String(CURRENT_SCHEMA_VERSION)}`, mono: true },
          ]}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void documents.load().then(() => {
                void documents.health().then((result) => {
                  if (result.ok) setHealth(result.value);
                });
              });
              toasts.info('Library reloaded', 'Storage was read again from this browser.');
            }}
          >
            Reload from storage
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const reset = preferences.reset();
              toasts[reset ? 'success' : 'error'](
                reset ? 'Preferences reset' : 'Preferences could not be reset',
                reset ? 'Default document settings restored.' : 'Local storage refused the write.',
              );
            }}
          >
            Reset preferences
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              learning.reset();
              toasts.info(
                'Learning progress cleared',
                'Lesson completions and exercise steps were removed.',
              );
            }}
          >
            Clear learning progress
          </Button>
          <Button
            variant="danger"
            size="sm"
            iconLeft={<Trash2 aria-hidden />}
            onClick={() => {
              setConfirmClearOpen(true);
            }}
          >
            Clear all local data
          </Button>
        </div>

        <InlineNote
          tone="warning"
          icon={<ShieldAlert aria-hidden />}
          title="There is no cloud copy"
        >
          <p>
            Deleting local data removes every project in this browser immediately. Nothing is
            uploaded, so nothing can be restored. Export project files for work you want to keep.
          </p>
        </InlineNote>
      </Panel>

      <Panel className="space-y-4 p-4">
        <SectionHeading
          title="Not available yet"
          description="Listed so the interface never pretends these exist."
        />
        <ul className="text-fg-muted space-y-2 text-sm">
          <li className="border-line-subtle flex items-center justify-between gap-3 border-b pb-2">
            <span>Accounts and sign-in</span>
            <StatusDot tone="idle" label="planned" />
          </li>
          <li className="border-line-subtle flex items-center justify-between gap-3 border-b pb-2">
            <span>Cloud sync across devices</span>
            <StatusDot tone="idle" label="planned" />
          </li>
          <li className="border-line-subtle flex items-center justify-between gap-3 border-b pb-2">
            <span>Sharing, teams and comments</span>
            <StatusDot tone="idle" label="planned" />
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Billing and plans</span>
            <StatusDot tone="idle" label="not planned for now" />
          </li>
        </ul>
      </Panel>

      <Panel className="space-y-4 p-4">
        <SectionHeading
          title="Diagnostics"
          description="The validated runtime configuration for this build."
          actions={<Settings2 aria-hidden className="text-fg-subtle size-4" />}
        />
        <DataList
          columns={2}
          items={[
            { label: 'Environment', value: env.environment },
            { label: 'Site URL', value: env.siteUrl },
            { label: 'Catalogue source', value: env.catalogSource },
            { label: 'Telemetry', value: env.telemetry },
            { label: 'App version', value: '0.1.0' },
            { label: 'Preferences loaded', value: preferenceState.loaded ? 'yes' : 'no' },
          ]}
        />
        {preferenceState.notice ? (
          <InlineNote tone="warning" title="Preferences notice">
            <p>{preferenceState.notice}</p>
          </InlineNote>
        ) : null}
        <p className="text-fg-subtle inline-flex items-center gap-1.5 text-xs">
          <Sparkles aria-hidden className="size-3.5" />
          Environment variables are validated at startup; an invalid value stops the app with a
          readable error rather than silently falling back.
        </p>
      </Panel>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Delete every locally stored project?"
        description="This cannot be undone and there is no cloud backup. Records the app could not read are removed too, and your preferences and learning progress are reset separately below."
        confirmLabel="Delete every project"
        onConfirm={() => {
          void documents.clearAll().then((result) => {
            if (!result.ok) {
              toasts.error('Local data could not be cleared', result.error.message);
              return;
            }
            learning.reset();
            setHealth({ count: 0, skipped: 0, bytes: 0 });
            toasts.success(
              'Local data cleared',
              `${pluralise(result.value, 'project')} removed from this browser.`,
            );
          });
        }}
      >
        <p className="text-fg-muted text-sm">
          Preferences and learning progress can be reset separately above if you want to keep them.
        </p>
      </ConfirmDialog>
    </div>
  );
}
