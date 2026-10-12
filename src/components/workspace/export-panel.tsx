'use client';

import { Check, CircleAlert, Download, Info, XCircle } from 'lucide-react';
import { useState } from 'react';

import { buildExportChecklist, type CheckStatus } from '../../core/export/checklist';
import { EXPORT_FORMATS, PROJECT_FILE_FORMAT_ID, getExportFormat } from '../../core/export/formats';
import { downloadProjectFile, serialiseProjectFile } from '../../core/export/project-file';
import { cn } from '../../lib/cn';
import { useForgeServices } from '../../state/forge-provider';
import { Button } from '../ui/button';
import { Field, Select } from '../ui/field';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from './workspace-api';

const STATUS_ICONS: Record<CheckStatus, typeof Check> = {
  pass: Check,
  warning: CircleAlert,
  blocked: XCircle,
};

const STATUS_COLORS: Record<CheckStatus, string> = {
  pass: 'text-mint-400',
  warning: 'text-amber-400',
  blocked: 'text-rose-400',
};

/**
 * Export panel.
 *
 * Runs the real readiness checks for the selected format, then offers only what actually works:
 * downloading the `.forge.json` project file. Planned formats stay selectable so a user can see
 * what each will require, and the panel states plainly that they produce no file yet.
 */
export function ExportPanel({ api }: { readonly api: WorkspaceApi }) {
  const { toasts } = useForgeServices();
  const [formatId, setFormatId] = useState<string>(PROJECT_FILE_FORMAT_ID);
  const checklist = buildExportChecklist(api.doc, formatId);
  const selected = getExportFormat(formatId);

  return (
    <section aria-labelledby="export-panel-heading" className="space-y-4">
      <div id="export-panel-heading">
        <h3 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">Export</h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          Checks are evaluated against the selected format, because requirements genuinely differ.
        </p>
      </div>

      <Field label="Format">
        <Select
          value={formatId}
          onChange={(event) => {
            setFormatId(event.target.value);
          }}
          options={EXPORT_FORMATS.map((format) => ({
            value: format.id,
            label: `${format.label} (.${format.extension})${format.status === 'planned' ? ' — planned' : ''}`,
          }))}
        />
      </Field>

      {selected ? (
        <InlineNote
          tone={selected.status === 'available' ? 'tip' : 'neutral'}
          icon={<Info aria-hidden />}
        >
          <p>{selected.notes}</p>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <Capability label="Transparency" value={selected.capabilities.transparency} />
            <Capability label="Animation" value={selected.capabilities.animation} />
            <Capability label="Print ready" value={selected.capabilities.printReady} />
            <Capability label="Lossy" value={selected.capabilities.lossy} />
          </dl>
        </InlineNote>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
            Readiness checks
          </p>
          <p
            className={cn(
              'text-2xs font-medium',
              checklist.ready ? 'text-mint-400' : 'text-rose-400',
            )}
          >
            {checklist.summary}
          </p>
        </div>

        <ul className="space-y-2">
          {checklist.checks.map((entry) => {
            const Icon = STATUS_ICONS[entry.status];
            return (
              <li
                key={entry.id}
                className="border-line-subtle bg-ink-950/60 flex gap-2.5 rounded-sm border px-2.5 py-2"
              >
                <Icon
                  aria-hidden
                  className={cn('mt-0.5 size-3.5 shrink-0', STATUS_COLORS[entry.status])}
                />
                <div className="min-w-0">
                  <p className="text-fg text-sm">{entry.label}</p>
                  <p className="text-fg-muted text-xs">{entry.detail}</p>
                  {entry.remedy ? (
                    <p className="text-fg-subtle mt-0.5 text-xs">→ {entry.remedy}</p>
                  ) : null}
                  <span className="sr-only">Status: {entry.status}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-line-subtle flex flex-col gap-2 border-t pt-3">
        <Button
          variant="primary"
          fullWidth
          iconLeft={<Download aria-hidden />}
          disabled={formatId !== PROJECT_FILE_FORMAT_ID}
          onClick={() => {
            downloadProjectFile(api.doc);
            toasts.success(
              'Project file downloaded',
              'It contains the document definition, not a rendered image.',
            );
          }}
        >
          {formatId === PROJECT_FILE_FORMAT_ID
            ? 'Download project file'
            : 'Download unavailable for this format'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          fullWidth
          onClick={() => {
            void navigator.clipboard
              .writeText(serialiseProjectFile(api.doc))
              .then(() => {
                toasts.success(
                  'Document definition copied',
                  'Paste it anywhere to inspect the model.',
                );
              })
              .catch(() => {
                toasts.warning(
                  'Copying was blocked',
                  'Your browser refused clipboard access. Use the download instead.',
                );
              });
          }}
        >
          Copy document definition as JSON
        </Button>

        {formatId !== PROJECT_FILE_FORMAT_ID ? (
          <p className="text-2xs text-fg-subtle">
            {selected?.label} export needs a renderer that is not built yet. The project file is the
            only format this build can produce — the roadmap tracks the rest.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Capability({ label, value }: { readonly label: string; readonly value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={value ? 'text-mint-400' : 'text-fg-subtle'}>{value ? 'yes' : 'no'}</dd>
    </div>
  );
}
