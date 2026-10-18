'use client';

import { ImagePlus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  MAX_PHOTO_HREF_LENGTH,
  MAX_PHOTO_WORKING_EDGE,
  type PhotoPayload,
} from '../../core/documents/payload';
import { setPhotoSourceCommand } from '../../core/photo/commands';
import { preparePhoto } from '../../lib/browser/photo-engine';
import { Button } from '../ui/button';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';

/**
 * Importing a photograph.
 *
 * The file input is the primary path — the drop zone is a convenience on top of it, never the only
 * way in. Imports are decoded, scaled to the documented working-copy limit and embedded in the
 * document, so a project reopened later does not depend on the original file still being on disk.
 */
export function PhotoImportPanel({
  api,
  payload,
}: {
  readonly api: WorkspaceApi;
  readonly payload: PhotoPayload;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; detail: string | null } | null>(null);
  const [dropping, setDropping] = useState(false);

  async function importFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    setReport(null);
    const prepared = await preparePhoto(file);
    if (!prepared.ok) {
      setBusy(false);
      setError({ message: prepared.error.message, detail: prepared.error.detail ?? null });
      return;
    }
    const applied = await api.run(
      setPhotoSourceCommand(api.doc, prepared.value.source, {
        resetEdits: payload.source !== null,
      }),
    );
    setBusy(false);
    if (!applied) return;
    const source = prepared.value.source;
    const downscaled = prepared.value.downscaledFrom;
    setReport(
      downscaled
        ? `“${source.name}” imported and scaled from ${downscaled.width} × ${downscaled.height} to ${source.width} × ${source.height} (long-edge limit ${MAX_PHOTO_WORKING_EDGE}).`
        : `“${source.name}” imported at ${source.width} × ${source.height}.`,
    );
  }

  return (
    <section aria-labelledby="photo-import-heading" className="space-y-3">
      <div>
        <h3
          id="photo-import-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Photograph
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          PNG, JPEG or WebP. The working copy is embedded in the project (limit{' '}
          {MAX_PHOTO_WORKING_EDGE} px on the long edge,{' '}
          {Math.round(MAX_PHOTO_HREF_LENGTH / 1_000_000)} MB encoded).
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Import a photo file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset immediately so choosing the same file twice fires `change` again.
          event.target.value = '';
          if (file) void importFile(file);
        }}
      />

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => {
          setDropping(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          const file = event.dataTransfer.files[0];
          if (file) void importFile(file);
        }}
        className={
          dropping
            ? 'border-accent rounded-md border border-dashed p-3'
            : 'border-line-subtle rounded-md border border-dashed p-3'
        }
      >
        <p className="text-fg-muted flex items-center gap-2 text-sm">
          <ImagePlus aria-hidden className="size-4" />
          {payload.source
            ? `Current: “${payload.source.name}” — ${payload.source.width} × ${payload.source.height}`
            : 'No photograph imported yet.'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            loadingLabel="Importing"
            iconLeft={<Upload aria-hidden />}
            onClick={() => {
              inputRef.current?.click();
            }}
          >
            {payload.source ? 'Replace photo' : 'Import photo'}
          </Button>
          <span className="text-fg-subtle text-2xs">or drop a file on this panel</span>
        </div>
      </div>

      {report ? (
        <p role="status" data-testid="photo-import-report" className="text-fg-muted text-xs">
          {report}
        </p>
      ) : null}

      {error ? (
        <InlineNote tone="danger" title="That file could not be imported">
          <p>{error.message}</p>
          {error.detail ? <p className="text-2xs">{error.detail}</p> : null}
        </InlineNote>
      ) : null}
    </section>
  );
}
