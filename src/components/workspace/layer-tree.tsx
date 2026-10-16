'use client';

import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useRef, useState } from 'react';

import type { Layer, Scene } from '../../core/documents/layer-types';
import { LAYER_TYPE_LABELS } from '../../core/documents/layer-types';
import { layersTopFirst } from '../../core/documents/scene-geometry';
import type { ReorderTarget } from '../../core/documents/layer-operations';
import { cn } from '../../lib/cn';
import { IconButton } from '../ui/icon-button';
import {
  isSelected,
  selectOnly,
  toggleSelection,
  type Selection,
} from '../../core/editor/selection';

export type LayerTreeProps = {
  readonly scene: Scene;
  readonly selection: Selection;
  readonly onSelectionChange: (selection: Selection) => void;
  readonly onReorder: (id: string, target: ReorderTarget) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onToggleVisibility: (id: string, visible: boolean) => void;
  readonly onToggleLock: (id: string, locked: boolean) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onDelete: (id: string) => void;
};

/**
 * Layer panel.
 *
 * Lists the scene top-first — the order layers are painted in reverse, which is how every design tool
 * presents a stack — and gives every operation a button, so nothing depends on dragging.
 *
 * The markup is a list of buttons rather than a `listbox` with `option`s, because each row also holds
 * its own Hide, Lock, Rename, Move, Duplicate and Delete buttons: a listbox option may not contain
 * interactive children, and claiming the role would misdescribe what a screen reader should expect.
 * Navigation follows the standard composite-widget pattern instead: one tab stop for the whole list
 * (roving `tabIndex`), ArrowUp/ArrowDown move between layers *and select them*, Home/End jump to the
 * ends, and Enter/Space activate the focused row through the button's own native behaviour.
 */
export function LayerTree({
  scene,
  selection,
  onSelectionChange,
  onReorder,
  onRename,
  onToggleVisibility,
  onToggleLock,
  onDuplicate,
  onDelete,
}: LayerTreeProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const rows = layersTopFirst(scene);
  const selectedRow = rows.find((layer) => isSelected(selection, layer.id));
  const activeRow = selectedRow ?? rows[0];

  /** Moves the roving tab stop and the selection to a row, and puts focus there. */
  function focusRow(index: number): void {
    const row = rows[Math.min(rows.length - 1, Math.max(0, index))];
    if (!row) return;
    onSelectionChange(selectOnly(row.id));
    buttons.current.get(String(row.id))?.focus();
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLElement>, index: number): void {
    const from = selectedRow ? rows.findIndex((layer) => layer.id === selectedRow.id) : index;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusRow(from + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusRow(from - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusRow(rows.length - 1);
    }
  }

  /** Z-order index (bottom-up) for a layer id, which is what the reorder commands take. */
  const indexOf = (id: string): number =>
    scene.layers.findIndex((layer) => String(layer.id) === id);

  return (
    <section aria-labelledby="layer-panel-heading" className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3
          id="layer-panel-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Layers ({rows.length})
        </h3>
        <p className="text-2xs text-fg-subtle">Top of the list paints on top</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-fg-muted border-line-subtle rounded-sm border border-dashed px-3 py-4 text-xs">
          No layers yet. Use the toolbar above the artboard to add text, a rectangle, an ellipse or
          a graphic from the catalogue.
        </p>
      ) : (
        <ul
          aria-label="Layer stack"
          className="forge-scroll border-line max-h-72 min-h-0 overflow-y-auto rounded-sm border"
        >
          {rows.map((layer, rowIndex) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              selected={isSelected(selection, layer.id)}
              // One tab stop for the list: the selected row, or the top row when nothing is selected.
              tabbable={String(activeRow?.id ?? '') === String(layer.id)}
              buttonRef={(element) => {
                if (element) buttons.current.set(String(layer.id), element);
                else buttons.current.delete(String(layer.id));
              }}
              onRowKeyDown={(event) => {
                handleRowKeyDown(event, rowIndex);
              }}
              renaming={renaming === String(layer.id)}
              onSelect={(additive) => {
                onSelectionChange(
                  additive ? toggleSelection(selection, layer.id) : selectOnly(layer.id),
                );
              }}
              onStartRename={() => {
                setRenaming(String(layer.id));
              }}
              onFinishRename={(name) => {
                setRenaming(null);
                if (name.trim().length > 0) onRename(String(layer.id), name);
              }}
              onReorder={(target) => {
                onReorder(String(layer.id), target);
              }}
              canMoveUp={rowIndex > 0}
              canMoveDown={rowIndex < rows.length - 1}
              zIndex={indexOf(String(layer.id))}
              onToggleVisibility={() => {
                onToggleVisibility(String(layer.id), !layer.visible);
              }}
              onToggleLock={() => {
                onToggleLock(String(layer.id), !layer.locked);
              }}
              onDuplicate={() => {
                onDuplicate(String(layer.id));
              }}
              onDelete={() => {
                onDelete(String(layer.id));
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LayerRow({
  layer,
  selected,
  tabbable,
  buttonRef,
  onRowKeyDown,
  renaming,
  onSelect,
  onStartRename,
  onFinishRename,
  onReorder,
  canMoveUp,
  canMoveDown,
  zIndex,
  onToggleVisibility,
  onToggleLock,
  onDuplicate,
  onDelete,
}: {
  readonly layer: Layer;
  readonly selected: boolean;
  /** Whether this row holds the list's single tab stop (roving tabindex). */
  readonly tabbable: boolean;
  readonly buttonRef: (element: HTMLButtonElement | null) => void;
  readonly onRowKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  readonly renaming: boolean;
  readonly onSelect: (additive: boolean) => void;
  readonly onStartRename: () => void;
  readonly onFinishRename: (name: string) => void;
  readonly onReorder: (target: ReorderTarget) => void;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly zIndex: number;
  readonly onToggleVisibility: () => void;
  readonly onToggleLock: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
}) {
  const [draft, setDraft] = useState(layer.name);

  return (
    <li
      id={`layer-row-${String(layer.id)}`}
      data-testid={`layer-row-${String(layer.id)}`}
      className={cn(
        'border-line-subtle flex items-center gap-1.5 border-b px-2 py-1.5 last:border-b-0',
        selected ? 'bg-accent/10' : 'bg-transparent',
      )}
    >
      <IconButton
        label={layer.visible ? `Hide “${layer.name}”` : `Show “${layer.name}”`}
        size="sm"
        variant="quiet"
        aria-pressed={!layer.visible}
        onClick={onToggleVisibility}
      >
        {layer.visible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
      </IconButton>

      <IconButton
        label={layer.locked ? `Unlock “${layer.name}”` : `Lock “${layer.name}”`}
        size="sm"
        variant="quiet"
        aria-pressed={layer.locked}
        onClick={onToggleLock}
      >
        {layer.locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
      </IconButton>

      {renaming ? (
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            onFinishRename(draft);
          }}
        >
          <input
            autoFocus
            aria-label={`Rename “${layer.name}”`}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onBlur={() => {
              onFinishRename(draft);
            }}
            className="border-line bg-ink-950 text-fg w-full rounded-sm border px-1.5 py-0.5 text-xs"
          />
        </form>
      ) : (
        <button
          type="button"
          ref={buttonRef}
          data-testid={`layer-name-${String(layer.id)}`}
          tabIndex={tabbable ? 0 : -1}
          aria-current={selected ? 'true' : undefined}
          className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-focus)]"
          onClick={(event) => {
            onSelect(event.metaKey || event.ctrlKey || event.shiftKey);
          }}
          onKeyDown={onRowKeyDown}
          onDoubleClick={onStartRename}
        >
          <span className="text-fg block truncate text-xs">
            {layer.name}
            {selected ? <span className="sr-only"> (selected)</span> : null}
          </span>
          <span className="text-fg-subtle forge-numeric text-2xs block">
            {LAYER_TYPE_LABELS[layer.type]} · {String(layer.opacity * 100)}% · z{String(zIndex + 1)}
            {layer.locked ? ' · locked' : ''}
          </span>
        </button>
      )}

      <IconButton
        label={`Rename “${layer.name}”`}
        size="sm"
        variant="quiet"
        onClick={onStartRename}
      >
        <Pencil aria-hidden />
      </IconButton>
      <IconButton
        label={`Bring “${layer.name}” forward`}
        size="sm"
        variant="quiet"
        disabled={!canMoveUp}
        onClick={() => {
          onReorder('forward');
        }}
      >
        <ArrowUp aria-hidden />
      </IconButton>
      <IconButton
        label={`Send “${layer.name}” backward`}
        size="sm"
        variant="quiet"
        disabled={!canMoveDown}
        onClick={() => {
          onReorder('backward');
        }}
      >
        <ArrowDown aria-hidden />
      </IconButton>
      <IconButton
        label={`Bring “${layer.name}” to front`}
        size="sm"
        variant="quiet"
        disabled={!canMoveUp}
        onClick={() => {
          onReorder('front');
        }}
      >
        <ChevronsUp aria-hidden />
      </IconButton>
      <IconButton
        label={`Send “${layer.name}” to back`}
        size="sm"
        variant="quiet"
        disabled={!canMoveDown}
        onClick={() => {
          onReorder('back');
        }}
      >
        <ChevronsDown aria-hidden />
      </IconButton>
      <IconButton
        label={`Duplicate “${layer.name}”`}
        size="sm"
        variant="quiet"
        onClick={onDuplicate}
      >
        <Copy aria-hidden />
      </IconButton>
      <IconButton label={`Delete “${layer.name}”`} size="sm" variant="quiet" onClick={onDelete}>
        <Trash2 aria-hidden />
      </IconButton>
    </li>
  );
}
