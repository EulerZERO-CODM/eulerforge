'use client';

import { Redo2, Undo2 } from 'lucide-react';

import { DEFAULT_HISTORY_LIMIT } from '../../core/history/history';
import { isVolatile, type ForgeStorageStatus } from '../../state/storage-status';
import { formatRelative } from '../../lib/format';
import { Button } from '../ui/button';
import { Kbd } from '../ui/kbd';
import { InlineNote } from '../ui/states';

/**
 * History panel.
 *
 * A read-only view over the session's undo stack: it shows the labels recorded by each commit and
 * offers the two operations that are actually supported (step back, step forward). There is no
 * branching or named snapshot yet, and the panel says so rather than implying it.
 */
export function HistoryPanel({
  labels,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  readonly labels: readonly { readonly id: number; readonly label: string }[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}) {
  return (
    <section aria-labelledby="history-panel-heading" className="space-y-4">
      <div id="history-panel-heading">
        <h3 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">History</h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          Every document change is a labelled step, applied and reversible in order.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!canUndo}
          onClick={onUndo}
          iconLeft={<Undo2 aria-hidden />}
        >
          Undo
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canRedo}
          onClick={onRedo}
          iconLeft={<Redo2 aria-hidden />}
        >
          Redo
        </Button>
        <span className="text-2xs text-fg-subtle ml-auto inline-flex items-center gap-1.5">
          <Kbd>⌘Z</Kbd>
          <Kbd>⇧⌘Z</Kbd>
        </span>
      </div>

      {labels.length === 0 ? (
        <p className="text-fg-muted text-sm">
          No changes yet. Edit the canvas, guides, palette or details and each change appears here.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {[...labels].reverse().map((entry, index) => (
            <li
              key={entry.id}
              className="border-line-subtle bg-ink-950/50 flex items-start gap-2.5 rounded-sm border px-2.5 py-2"
            >
              <span className="forge-numeric text-2xs text-fg-subtle mt-0.5 w-5 text-right">
                {labels.length - index}
              </span>
              <span className="text-fg min-w-0 flex-1 text-sm">{entry.label}</span>
            </li>
          ))}
        </ol>
      )}

      <InlineNote tone="neutral">
        <p>
          Up to {String(DEFAULT_HISTORY_LIMIT)} steps are kept for the open document, in memory and
          for this session only. Closing the workspace clears the stack.
        </p>
      </InlineNote>
    </section>
  );
}

/**
 * Compact save-state indicator for the workspace header.
 *
 * Takes the storage durability with it, because "saved" is only true when the write survives a
 * reload. With a volatile backend the indicator says the document is held in memory instead — it
 * never claims a durable save it cannot deliver (ADR-0006).
 */
export function SaveState({
  dirty,
  saving,
  savedAt,
  error,
  storage,
}: {
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly savedAt: string | null;
  readonly error: string | null;
  readonly storage: ForgeStorageStatus;
}) {
  const volatile = isVolatile(storage);

  if (!storage.determined) {
    // Server rendering: storage has not been inspected yet, so claim nothing.
    return (
      <span className="text-2xs text-fg-subtle inline-flex items-center gap-1.5" role="status">
        <span aria-hidden className="bg-ink-500 size-1.5 rounded-full" />
        Checking storage…
      </span>
    );
  }

  if (error) {
    return (
      <span className="text-2xs inline-flex items-center gap-1.5 text-rose-400" role="status">
        <span aria-hidden className="size-1.5 rounded-full bg-rose-400" />
        Not saved: {error}
      </span>
    );
  }
  if (saving) {
    return (
      <span className="text-2xs text-fg-subtle inline-flex items-center gap-1.5" role="status">
        <span aria-hidden className="bg-arc-400 size-1.5 animate-pulse rounded-full" />
        {volatile ? 'Holding in memory…' : 'Saving…'}
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="text-2xs inline-flex items-center gap-1.5 text-amber-400" role="status">
        <span aria-hidden className="size-1.5 rounded-full bg-amber-400" />
        {volatile ? 'Unsaved changes — memory only' : 'Unsaved changes'}
      </span>
    );
  }
  if (volatile) {
    return (
      <span className="text-2xs inline-flex items-center gap-1.5 text-amber-400" role="status">
        <span aria-hidden className="size-1.5 rounded-full bg-amber-400" />
        In memory only — reloading loses this
      </span>
    );
  }
  return (
    <span className="text-2xs text-fg-subtle inline-flex items-center gap-1.5" role="status">
      <span aria-hidden className="bg-mint-400 size-1.5 rounded-full" />
      {savedAt ? `Saved ${formatRelative(savedAt)}` : 'Saved in this browser'}
    </span>
  );
}
