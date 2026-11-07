'use client';

import { useState } from 'react';
import Link from 'next/link';

import { brand } from '../../core/types/brand';
import {
  INTERCHANGE_LIMITATIONS,
  layersToDesign,
  layersToVector,
} from '../../core/documents/interchange';
import { DEFAULT_GUIDES } from '../../core/documents/factories';
import type { Canvas } from '../../core/documents/types';
import { cn } from '../../lib/cn';
import { useForgeServices } from '../../state/forge-provider';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/field';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';

export type InterchangeDirection = 'to-vector' | 'to-design';

const DIRECTION_LABELS: Record<
  InterchangeDirection,
  { readonly title: string; readonly action: string; readonly target: string }
> = {
  'to-vector': {
    title: 'Send artwork to the Illustration Studio',
    action: 'Create a vector artboard',
    target: 'Illustration Studio',
  },
  'to-design': {
    title: 'Send artwork to the Design Studio',
    action: 'Create a design canvas',
    target: 'Design Studio',
  },
};

/**
 * Studio-to-studio exchange.
 *
 * The two studios share one layer model and one renderer, so "interchange" is a deliberate retyping
 * of layers rather than a file conversion, and it happens entirely in core code that is tested
 * without a browser (`documents/interchange.ts`). What this panel adds is the honest part: it names
 * the layers that cannot make the trip, quotes the model's limitations, and creates the sibling
 * document only when the conversion actually succeeded.
 *
 * The new document is created with its layers in one step, so there is no window in which an empty
 * project exists with a pending edit behind it.
 */
export function InterchangePanel({
  api,
  direction,
  selectedIds,
}: {
  readonly api: WorkspaceApi;
  readonly direction: InterchangeDirection;
  /** Layers to send. Empty means "everything visible". */
  readonly selectedIds: readonly string[];
}) {
  const { documents, toasts } = useForgeServices();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(`${api.doc.title} — ${DIRECTION_LABELS[direction].target}`);
  const [created, setCreated] = useState<{ readonly id: string; readonly title: string } | null>(
    null,
  );

  const chosen =
    selectedIds.length > 0
      ? api.doc.scene.layers.filter((layer) => selectedIds.includes(String(layer.id)))
      : api.doc.scene.layers.filter((layer) => layer.visible);
  const conversion = direction === 'to-vector' ? layersToVector(chosen) : layersToDesign(chosen);
  const labels = DIRECTION_LABELS[direction];

  async function create(): Promise<void> {
    if (!conversion.ok) return;
    setBusy(true);
    const targetCanvas: Canvas =
      direction === 'to-vector'
        ? {
            width: Math.round(api.doc.canvas.width),
            height: Math.round(api.doc.canvas.height),
            unit: 'px',
            dpi: 96,
            background: '#0f1115',
            transparent: true,
          }
        : api.doc.canvas;

    const result = await documents.create({
      title: title.trim() || api.doc.title,
      summary: `Created from “${api.doc.title}” with the ${labels.target} interchange.`,
      studioId: direction === 'to-vector' ? 'illustration' : 'design',
      documentTypeId: brand<'DocumentTypeId'>(
        direction === 'to-vector' ? 'illustration.artboard' : 'design.canvas',
      ),
      canvas: targetCanvas,
      guides: DEFAULT_GUIDES,
      palette: [...api.doc.palette],
      tags: [...api.doc.metadata.tags],
      scene: { layers: [...conversion.value.layers] },
    });
    setBusy(false);

    if (!result.ok) {
      toasts.error('The document could not be created', result.error.message);
      return;
    }
    setCreated({ id: result.value.id, title: result.value.title });
    toasts.success('Artwork sent', `“${result.value.title}” is ready in the ${labels.target}.`);
  }

  return (
    <section aria-labelledby="interchange-heading" className="space-y-3">
      <div>
        <h3
          id="interchange-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Interchange
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">{labels.title}</p>
      </div>

      <p className="text-2xs text-fg-subtle">
        {selectedIds.length > 0
          ? `${String(chosen.length)} selected layer(s) will be converted.`
          : `Everything visible (${String(chosen.length)} layer(s)) will be converted.`}
      </p>

      {conversion.ok ? (
        <>
          <ul className="text-2xs space-y-0.5" data-testid="interchange-carried">
            {conversion.value.converted.map((name) => (
              <li key={name} className="text-fg-muted">
                ✓ {name}
              </li>
            ))}
          </ul>
          {conversion.value.skipped.length > 0 ? (
            <InlineNote tone="warning" title="These layers cannot make the trip">
              <ul className="space-y-0.5" data-testid="interchange-skipped">
                {conversion.value.skipped.map((entry) => (
                  <li key={String(entry.layerId)}>
                    <span className="text-fg">“{entry.layerName}”</span> — {entry.reason}
                  </li>
                ))}
              </ul>
            </InlineNote>
          ) : null}
          <Field label="New document name">
            <Input
              value={title}
              data-testid="interchange-title"
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </Field>
          <Button
            variant="outline"
            size="sm"
            fullWidth
            disabled={busy}
            data-testid="interchange-create"
            onClick={() => {
              void create();
            }}
          >
            {busy ? 'Creating…' : labels.action}
          </Button>
        </>
      ) : (
        <InlineNote tone="warning" title="Nothing can be converted">
          <p data-testid="interchange-refused">{conversion.error.message}</p>
          {conversion.error.detail ? <p className="text-2xs">{conversion.error.detail}</p> : null}
        </InlineNote>
      )}

      {created ? (
        <InlineNote tone="tip" title="Created">
          <p data-testid="interchange-created">
            “{created.title}” now exists in the {labels.target}.
          </p>
          <Link
            className="text-fg text-2xs underline decoration-1 underline-offset-2"
            href={`/workspace/${created.id}`}
          >
            Open it →
          </Link>
        </InlineNote>
      ) : null}

      <details className="text-2xs">
        <summary className={cn('text-fg-subtle cursor-pointer')}>
          What the model cannot carry
        </summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {INTERCHANGE_LIMITATIONS.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
