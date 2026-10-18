'use client';

import { useState } from 'react';

import type { Scene } from '../../core/documents/layer-types';
import { isPathLayer } from '../../core/documents/layer-types';
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
import type { NodeReference } from '../../core/vector/pick';
import { ExportPanel } from '../workspace/export-panel';
import { HistoryPanel } from '../workspace/history-panel';
import { InspectorPanel } from '../workspace/inspector-panel';
import { LayerTree } from '../workspace/layer-tree';
import { SelectionInspector } from '../workspace/selection-inspector';
import type { SceneImages } from '../workspace/use-scene-images';
import type { WorkspaceApi } from '../workspace/workspace-api';
import { InterchangePanel } from './interchange-panel';
import { SvgIoPanel } from './svg-io-panel';
import { VectorInspector } from './vector-inspector';
import { VectorStage } from './vector-stage';
import { VECTOR_TOOL_INFO, toolForKey, type VectorTool } from './vector-tools';

/**
 * The Illustration Studio's workspace surface.
 *
 * Composed from the same parts as the design workspace — the layer tree, the selection inspector,
 * the document inspector, the export panel and the history panel are the *same components*, so a
 * behaviour fixed in one studio is fixed in both — with the vector stage and the vector inspector
 * replacing the raster artboard. Tool and node selection live here because they are transient
 * interaction state: they are never written into the document and never enter undo history
 * (ADR-0017), exactly like the design workspace's selection and snapping toggles.
 */
export function IllustrationWorkspace({
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
}) {
  const [tool, setTool] = useState<VectorTool>('select');
  const [nodeSelection, setNodeSelection] = useState<readonly NodeReference[]>([]);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<string | null>(null);

  const visiblePaths = scene.layers.filter((layer) => layer.visible && isPathLayer(layer));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-5">
        <VectorStage
          api={api}
          selection={selection}
          onSelectionChange={onSelectionChange}
          nodeSelection={nodeSelection}
          onNodeSelectionChange={setNodeSelection}
          tool={tool}
          onToolChange={setTool}
          images={images}
          zoom={zoom}
          onZoomChange={setZoom}
          onStatusChange={setStatus}
        />

        <div
          aria-live="polite"
          data-testid="vector-status"
          className="border-line-subtle text-2xs text-fg-subtle rounded-sm border px-3 py-2"
        >
          {status ??
            `${VECTOR_TOOL_INFO[tool].label} tool — ${VECTOR_TOOL_INFO[tool].hint} ${String(
              visiblePaths.length,
            )} visible vector layer(s).`}
        </div>

        <SvgIoPanel api={api} selection={selection} />

        <InterchangePanel api={api} direction="to-design" selectedIds={selection.map(String)} />
      </div>

      <aside
        aria-label="Illustration inspector"
        className="forge-scroll min-w-0 space-y-7 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:pr-1"
      >
        <LayerTree
          scene={scene}
          selection={selection}
          onSelectionChange={(next) => {
            onSelectionChange(next);
            // A node selection belongs to one shape; changing the layer selection cannot keep it.
            setNodeSelection([]);
          }}
          onReorder={(id, target: ReorderTarget) => {
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
            setNodeSelection([]);
            void api.run(deleteLayersCommand(api.doc, [id]));
          }}
        />

        <div className="border-line border-t pt-4">
          <VectorInspector
            api={api}
            selection={selection}
            nodeSelection={nodeSelection}
            onNodeSelectionChange={setNodeSelection}
            onSelectionChange={onSelectionChange}
          />
        </div>

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
          <HistoryPanel
            labels={history}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={onUndo}
            onRedo={onRedo}
          />
        </div>
      </aside>
    </div>
  );
}

/** True when a document is a vector artboard, which is what selects this surface. */
export function isVectorDocument(documentTypeId: string): boolean {
  return documentTypeId === 'illustration.artboard';
}

export { toolForKey };
