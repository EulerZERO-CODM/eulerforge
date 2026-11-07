'use client';

import { ArrowRightLeft, Image as ImageIcon, Film } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { handoffTargets, toMotionDocument, toPhotoDocument } from '../../core/handoff';
import type { HandoffTarget } from '../../core/handoff';
import type { ForgeDocument } from '../../core/documents/types';
import { rasteriseArtboardForPhoto } from '../../lib/browser/handoff';
import { useForgeServices } from '../../state/forge-provider';
import type { Result } from '../../core/result';
import type { ForgeDocument as Document } from '../../core/documents/types';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { InlineNote } from '../ui/states';
import { cn } from '../../lib/cn';

/**
 * Carrying a project into another studio.
 *
 * This is the control that makes "one shell, many studios" a workflow instead of a menu. The
 * dialog is deliberately explicit about the trade it is offering: each destination lists what
 * arrives and what does not, because "continue in Photo Studio" would hide the fact that a layer
 * stack is about to become pixels.
 *
 * A handoff always creates a new project and leaves the current one untouched — the copy on the
 * button is "Create", not "Move", and the dialog says so in one line.
 */
export function HandoffPanel({
  source,
  resolveImage,
}: {
  readonly source: ForgeDocument;
  /** Resolves placed graphics so the rendered artboard is the same picture the export makes. */
  readonly resolveImage: Parameters<typeof rasteriseArtboardForPhoto>[1];
}) {
  const router = useRouter();
  const { documents, toasts } = useForgeServices();
  const targets = handoffTargets(source);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<HandoffTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; detail: string | null } | null>(null);

  if (targets.length === 0) return null;

  const chosen = selected ?? targets[0] ?? null;

  async function carry(target: HandoffTarget): Promise<void> {
    setBusy(true);
    setError(null);

    // The browser step runs first, and only for the raster target: Motion takes the scene directly.
    let input: Parameters<typeof documents.create>[0];
    if (target.operation === 'raster') {
      const rendered = await rasteriseArtboardForPhoto(source, resolveImage);
      if (!rendered.ok) {
        setBusy(false);
        setError({ message: rendered.error.message, detail: rendered.error.detail ?? null });
        return;
      }
      input = toPhotoDocument(source, rendered.value, { at: new Date().toISOString() });
    } else {
      input = toMotionDocument(source, { at: new Date().toISOString() });
    }

    const created: Result<Document> = await documents.create(input);
    setBusy(false);

    if (!created.ok) {
      setError({ message: created.error.message, detail: created.error.detail ?? null });
      toasts.error('The work could not be carried over', created.error.message);
      return;
    }

    toasts.success(
      `Carried into ${target.studioId === 'motion' ? 'Motion' : 'Photo'} Studio`,
      target.operation === 'raster'
        ? `“${created.value.title}” holds the artboard as pixels. The original project is unchanged.`
        : `“${created.value.title}” holds a copy of every layer. The original project is unchanged.`,
    );
    setOpen(false);
    router.push(`/workspace/${created.value.id}`);
  }

  return (
    <>
      <Button
        variant="outline"
        size="md"
        iconLeft={<ArrowRightLeft aria-hidden />}
        onClick={() => {
          setOpen(true);
        }}
      >
        Carry onward
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          size="lg"
          title="Carry this work into another studio"
          description={`A new project is created and “${source.title}” stays exactly as it is. Choose what the next step needs.`}
          footer={
            <>
              <Button
                variant="quiet"
                onClick={() => {
                  setOpen(false);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={busy}
                loadingLabel="Carrying the work over"
                disabled={chosen === null}
                onClick={() => {
                  if (chosen) void carry(chosen);
                }}
              >
                {chosen ? targetAction(chosen) : 'Carry onward'}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {targets.map((target) => {
              const active = chosen?.id === target.id;
              return (
                <button
                  key={target.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSelected(target);
                  }}
                  className={cn(
                    'w-full rounded-md border p-4 text-left transition-colors',
                    active
                      ? 'border-accent bg-ink-900'
                      : 'border-line bg-surface-raised/50 hover:border-line-strong',
                  )}
                >
                  <span className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="border-line text-fg-muted mt-0.5 grid size-8 shrink-0 place-items-center rounded-sm border"
                    >
                      {target.id === 'motion' ? (
                        <Film className="size-4" />
                      ) : (
                        <ImageIcon className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-fg block text-base font-medium">{target.action}</span>
                      <span className="text-fg-muted mt-0.5 block text-sm">{target.reason}</span>
                      <span className="mt-3 grid gap-2 sm:grid-cols-2">
                        <span className="block">
                          <span className="text-2xs text-mint-400 block font-medium tracking-wide uppercase">
                            What arrives
                          </span>
                          <span className="text-fg-muted mt-1 block space-y-1 text-xs">
                            {target.carries.map((line) => (
                              <span key={line} className="block">
                                {line}
                              </span>
                            ))}
                          </span>
                        </span>
                        <span className="block">
                          <span className="text-2xs text-fg-subtle block font-medium tracking-wide uppercase">
                            What does not
                          </span>
                          <span className="text-fg-subtle mt-1 block space-y-1 text-xs">
                            {target.loses.map((line) => (
                              <span key={line} className="block">
                                {line}
                              </span>
                            ))}
                          </span>
                        </span>
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}

            {error ? (
              <InlineNote tone="warning" title="The work was not carried over">
                <p>
                  {error.message}
                  {error.detail ? ` ${error.detail}` : ''}
                </p>
              </InlineNote>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function targetAction(target: HandoffTarget): string {
  return target.id === 'motion' ? 'Create the motion project' : 'Create the photo project';
}
