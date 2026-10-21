'use client';

/**
 * A shared project, read-only, in the browser.
 *
 * It fetches the snapshot from `/api/shared/:token`, shows what the document contains, and offers the
 * project file as a download — the same `.forge.json` the app imports. It never offers an edit button:
 * a share link is a read capability, and a control that promised editing would be a lie until the
 * collaboration model exists.
 */

import { useEffect, useState } from 'react';

import { downloadBytes } from '../../lib/browser/download';
import { migrateDocument } from '../../core/documents/migrations';
import type { ForgeDocument } from '../../core/documents/types';
import { projectFileName, serialiseProjectFile } from '../../core/export/project-file';
import { PageHeader } from '../ui/section';
import { Button } from '../ui/button';
import { Panel } from '../ui/section';
import { InlineNote } from '../ui/states';

export function SharedDocumentView({ token }: { readonly token: string }) {
  const [document, setDocument] = useState<ForgeDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const state = { cancelled: false };
    void (async () => {
      try {
        const response = await fetch(`/api/shared/${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const parsed = (await response.json()) as unknown;
        if (state.cancelled) return;
        if (!response.ok) {
          const message =
            typeof parsed === 'object' &&
            parsed !== null &&
            typeof (parsed as { error?: { message?: unknown } }).error?.message === 'string'
              ? String((parsed as { error: { message: string } }).error.message)
              : 'That share link could not be opened.';
          setError(message);
          return;
        }
        const raw =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as { document?: unknown }).document
            : undefined;
        const migrated = migrateDocument(raw);
        if (!migrated.ok) {
          setError(migrated.error.message);
          return;
        }
        setDocument(migrated.value);
      } catch {
        if (!state.cancelled) setError('The server could not be reached.');
      } finally {
        if (!state.cancelled) setLoading(false);
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, [token]);

  if (loading) {
    return <p className="text-fg-subtle text-sm">Opening the shared project…</p>;
  }
  if (error || !document) {
    return (
      <InlineNote tone="warning" title="This link does not open">
        <p>{error ?? 'That share link could not be opened.'}</p>
        <p className="text-fg-subtle mt-1 text-xs">
          Links expire, and the owner can revoke one at any time. Ask for a new link if this one was
          meant to work.
        </p>
      </InlineNote>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={document.title}
        lead="A read-only snapshot shared from Euler's Forge. It is not a live document: edits after it was shared are not included."
      />
      <Panel className="space-y-3">
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            ['Studio', document.studioId],
            ['Document type', String(document.documentTypeId)],
            ['Canvas', `${String(document.canvas.width)} × ${String(document.canvas.height)} px`],
            ['Layers', String(document.scene.layers.length)],
            ['Saved', new Date(document.updatedAt).toLocaleString()],
            ['Revision', String(document.revision)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
                {label}
              </dt>
              <dd className="text-fg-mono text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const text = serialiseProjectFile(document);
            const bytes = new TextEncoder().encode(text);
            const delivered = downloadBytes(bytes, projectFileName(document), 'application/json');
            if (!delivered) setError('The browser refused the download.');
          }}
        >
          Download the project file
        </Button>
        <p className="text-fg-subtle text-xs">
          Opening that file imports it locally; this page never edits the shared copy.
        </p>
      </Panel>
    </div>
  );
}
