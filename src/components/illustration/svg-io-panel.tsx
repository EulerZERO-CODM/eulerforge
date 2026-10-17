'use client';

import { useRef, useState } from 'react';

import { svgExportPayload } from '../../core/export/svg-export';
import { buildIconSet } from '../../core/svg/icon-set';
import { parseSvg } from '../../core/svg/parse';
import { isPathLayer } from '../../core/documents/layer-types';
import { importArtworkCommand } from '../../core/editor/vector-commands';
import { downloadBytes, downloadText } from '../../lib/browser/download';
import { useForgeServices } from '../../state/forge-provider';
import { Button } from '../ui/button';
import { Checkbox, Field, Input } from '../ui/field';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ImportReport = {
  readonly names: readonly string[];
  readonly notes: readonly string[];
};

/**
 * SVG and icon-set panel.
 *
 * Three real actions: import a file (or pasted markup), export the artboard as SVG, and export the
 * selected shapes as an icon set. Every one of them reports what it did in the terms the user cares
 * about — layers that arrived, layers that could not be carried, bytes written — and none of them
 * claims success when the browser refused the download.
 */
export function SvgIoPanel({ api }: { readonly api: WorkspaceApi }) {
  const { toasts } = useForgeServices();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pasted, setPasted] = useState('');
  const [allowPartial, setAllowPartial] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [iconName, setIconName] = useState('Icon set');
  const [iconBox, setIconBox] = useState(true);
  const [iconReport, setIconReport] = useState<string | null>(null);

  const selectedPaths = api.doc.scene.layers.filter((layer) => isPathLayer(layer) && layer.visible);
  const exportPreview = svgExportPayload(api.doc, { allowPartial });

  async function importSource(source: string, origin: string): Promise<void> {
    const parsed = parseSvg(source);
    if (!parsed.ok) {
      setImportReport(null);
      toasts.error(
        `${origin} could not be imported`,
        parsed.error.detail
          ? `${parsed.error.message} ${parsed.error.detail}`
          : parsed.error.message,
      );
      return;
    }
    const command = importArtworkCommand(api.doc, parsed.value.artwork, {
      namePrefix: origin === 'The file' ? '' : `${origin}: `,
    });
    if (!command.ok) {
      toasts.error(`${origin} had nothing to import`, command.error.message);
      return;
    }
    const committed = await api.run(command);
    if (!committed) return;
    setImportReport({
      names: command.value.layerNames,
      // The importer's own notes: what it had to approximate and what it could not carry.
      notes: parsed.value.issues.map((issue) => issue.message),
    });
    toasts.success(
      `${String(parsed.value.artwork.shapes.length)} shape(s) imported`,
      `From ${origin.toLowerCase()} as editable paths.`,
    );
  }

  return (
    <section aria-labelledby="svg-io-heading" className="space-y-4">
      <div>
        <h3
          id="svg-io-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          SVG and icons
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          Import artwork as editable paths, export the artboard as SVG, or package the selected
          shapes as an icon set.
        </p>
      </div>

      <div className="space-y-2">
        <Field label="Import SVG">
          <input
            ref={fileRef}
            type="file"
            accept=".svg,image/svg+xml"
            aria-label="Import an SVG file"
            data-testid="svg-file-input"
            className="text-fg-muted file:bg-surface-raised file:text-fg block w-full text-xs file:mr-2 file:rounded-sm file:border-0 file:px-2 file:py-1"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => importSource(text, 'The file'));
              event.target.value = '';
            }}
          />
        </Field>
        <Field
          label="…or paste SVG markup"
          hint="Scripts, event handlers and external references are refused, not ignored."
        >
          <textarea
            value={pasted}
            data-testid="svg-paste"
            onChange={(event) => {
              setPasted(event.target.value);
            }}
            rows={3}
            className="forge-scroll border-line bg-ink-950 text-fg-muted w-full rounded-sm border px-2 py-1 text-xs"
          />
        </Field>
        <Button
          variant="outline"
          size="sm"
          fullWidth
          disabled={pasted.trim().length === 0}
          data-testid="svg-import-paste"
          onClick={() => {
            void importSource(pasted, 'The pasted markup');
          }}
        >
          Import pasted markup
        </Button>

        {importReport ? (
          <InlineNote tone="tip" title={`${String(importReport.names.length)} layer(s) imported`}>
            <p className="forge-numeric text-2xs">{importReport.names.join(', ')}</p>
            {importReport.notes.length > 0 ? (
              <ul className="text-2xs mt-1 list-disc space-y-0.5 pl-4">
                {importReport.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </InlineNote>
        ) : null}
      </div>

      <div className="border-line-subtle space-y-2 border-t pt-3">
        <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">Export SVG</p>
        {exportPreview.ok ? (
          <p className="text-fg-muted forge-numeric text-2xs" data-testid="svg-export-summary">
            {exportPreview.value.fileName} · {formatBytes(exportPreview.value.bytes)} ·{' '}
            {String(exportPreview.value.contents.length)} characters
          </p>
        ) : (
          <p className="text-2xs text-amber-400" data-testid="svg-export-blocked">
            {exportPreview.error.message}
            {exportPreview.error.detail ? ` ${exportPreview.error.detail}` : ''}
          </p>
        )}
        <Checkbox
          label="Export anyway, leaving out what SVG cannot represent"
          checked={allowPartial}
          data-testid="svg-allow-partial"
          onChange={(event) => {
            setAllowPartial(event.target.checked);
          }}
        />
        <Button
          variant="primary"
          size="sm"
          fullWidth
          disabled={!exportPreview.ok}
          data-testid="svg-export"
          onClick={() => {
            if (!exportPreview.ok) return;
            const payload = exportPreview.value;
            const started = downloadText(payload.contents, payload.fileName, payload.mimeType);
            if (!started) {
              toasts.warning(
                'The download could not start',
                'This environment cannot save files, so nothing was written.',
              );
              return;
            }
            toasts.success(
              'SVG exported',
              payload.unsupported.length > 0
                ? `${payload.fileName} — ${formatBytes(payload.bytes)}. ${String(payload.unsupported.length)} layer(s) could not be represented and were left out.`
                : `${payload.fileName} — ${formatBytes(payload.bytes)}.`,
            );
          }}
        >
          Download SVG
        </Button>
      </div>

      <div className="border-line-subtle space-y-2 border-t pt-3">
        <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">Icon set</p>
        <Field label="Set name">
          <Input
            value={iconName}
            data-testid="icon-set-name"
            onChange={(event) => {
              setIconName(event.target.value);
            }}
          />
        </Field>
        <Checkbox
          label="Fit every icon to the artboard box"
          checked={iconBox}
          data-testid="icon-set-box"
          onChange={(event) => {
            setIconBox(event.target.checked);
          }}
        />
        <p className="text-2xs text-fg-subtle">
          {selectedPaths.length === 0
            ? 'Draw or import at least one vector shape: each visible path becomes one icon.'
            : `${String(selectedPaths.length)} visible vector layer(s) will be written as icons, each into its own file, plus a sprite and a manifest in one download.`}
        </p>
        <Button
          variant="outline"
          size="sm"
          fullWidth
          disabled={selectedPaths.length === 0}
          data-testid="icon-set-export"
          onClick={() => {
            const box = iconBox
              ? {
                  minX: 0,
                  minY: 0,
                  maxX: api.doc.canvas.width,
                  maxY: api.doc.canvas.height,
                }
              : undefined;
            const built = buildIconSet(api.doc.scene.layers, {
              setName: iconName,
              ...(box ? { box } : {}),
            });
            if (!built.ok) {
              toasts.warning('The icon set was not built', built.error.message);
              return;
            }
            const set = built.value;
            const started = downloadBytes(set.archive, set.archiveFileName, 'application/zip');
            if (!started) {
              toasts.warning('The download could not start', 'This environment cannot save files.');
              return;
            }
            setIconReport(
              `${set.archiveFileName} — ${String(set.entries.length)} icon file(s), ${formatBytes(set.archive.length)} zipped. Inside: ${set.entries.map((entry) => entry.fileName).join(', ')}, icons.svg, icons.json.`,
            );
            toasts.success('Icon set exported', `${String(set.entries.length)} icons in one zip.`);
          }}
        >
          Download icon set (.zip)
        </Button>
        {iconReport ? (
          <p className="text-fg-muted forge-numeric text-2xs" data-testid="icon-set-report">
            {iconReport}
          </p>
        ) : null}
      </div>
    </section>
  );
}
