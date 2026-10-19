'use client';

import type { Scene } from '../../core/documents/layer-types';
import type { ReactNode } from 'react';
import type { ReorderTarget } from '../../core/documents/layer-operations';
import {
  deleteLayersCommand,
  duplicateLayersCommand,
  renameLayerCommand,
  reorderLayersCommand,
  setLayerLockCommand,
  setLayerVisibilityCommand,
} from '../../core/editor/commands';
import { isSelected, type Selection } from '../../core/editor/selection';
import { InterchangePanel } from '../illustration/interchange-panel';
import { ExportPanel } from './export-panel';
import { HistoryPanel } from './history-panel';
import { InspectorPanel } from './inspector-panel';
import { LayerTree } from './layer-tree';
import { SelectionInspector } from './selection-inspector';
import type { SceneImages } from './use-scene-images';
import type { WorkspaceApi } from './workspace-api';

/**
 * The workspace side rail.
 *
 * Extracted from `WorkspaceView` so the panels can be rendered and driven together against a real
 * document session without the router or the artboard. It owns no state: layers, selection and the
 * document all read and write through the same `WorkspaceApi` and `selection` value, which is what
 * keeps undo, persistence and the save indicator in agreement.
 */
export function DocumentAside({
  api,
  scene,
  images,
  selection,
  onSelectionChange,
  history,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  assistant,
}: {
  readonly api: WorkspaceApi;
  readonly scene: Scene;
  readonly images: SceneImages;
  readonly selection: Selection;
  readonly onSelectionChange: (selection: Selection) => void;
  readonly history: readonly { readonly id: number; readonly label: string }[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** An optional panel at the top of the inspector, used for the assistant. */
  readonly assistant?: ReactNode;
}) {
  return (
    <aside
      aria-label="Document inspector"
      className="forge-scroll min-w-0 space-y-7 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:pr-1"
    >
      {assistant}
      <LayerTree
        scene={scene}
        selection={selection}
        onSelectionChange={onSelectionChange}
        onReorder={(id, target: ReorderTarget) => {
          // The row acts on the selection it belongs to: reordering a row that is part of a
          // multi-layer selection moves the whole block, matching the inspector's buttons.
          const ids = isSelected(selection, id) && selection.length > 1 ? selection : [id];
          void api.run(reorderLayersCommand(api.doc, ids, target));
        }}
        onRename={(id, name) => {
          void api.run(renameLayerCommand(api.doc, id, name));
        }}
        onToggleVisibility={(id, visible) => {
          void api.run(setLayerVisibilityCommand(api.doc, id, visible));
        }}
        onToggleLock={(id, locked) => {
          void api.run(setLayerLockCommand(api.doc, id, locked));
        }}
        onDuplicate={(id) => {
          const ids = isSelected(selection, id) && selection.length > 1 ? selection : [id];
          void api.run(duplicateLayersCommand(api.doc, ids));
        }}
        onDelete={(id) => {
          onSelectionChange(Object.freeze([]));
          void api.run(deleteLayersCommand(api.doc, [id]));
        }}
      />

      <div className="border-line border-t pt-4">
        <SelectionInspector
          api={api}
          selection={selection}
          scene={scene}
          onSelectionChange={onSelectionChange}
        />
      </div>

      <div className="border-line border-t pt-4">
        <InspectorPanel api={api} />
      </div>

      <div className="border-line border-t pt-4">
        <ExportPanel api={api} images={images} />
      </div>

      <div className="border-line border-t pt-4">
        <InterchangePanel api={api} direction="to-vector" selectedIds={selection.map(String)} />
      </div>

      <div className="border-line border-t pt-4">
        <HistoryPanel
          labels={history}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      </div>
    </aside>
  );
}
