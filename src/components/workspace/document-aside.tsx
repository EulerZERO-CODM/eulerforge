'use client';

import { ExportPanel } from './export-panel';
import { HistoryPanel } from './history-panel';
import { InspectorPanel } from './inspector-panel';
import type { WorkspaceApi } from './workspace-api';

/**
 * The workspace side rail.
 *
 * Extracted from `WorkspaceView` so the three panels can be rendered and driven together against a
 * real document session without the router or the document stage. It owns no state: every panel
 * reads and writes through the same `WorkspaceApi`, which is what keeps undo, persistence and the
 * save indicator in agreement.
 */
export function DocumentAside({
  api,
  history,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  readonly api: WorkspaceApi;
  readonly history: readonly { readonly id: number; readonly label: string }[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}) {
  return (
    <aside
      aria-label="Document inspector"
      className="forge-scroll min-w-0 space-y-7 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:pr-1"
    >
      <InspectorPanel api={api} />
      <div className="border-line border-t pt-4">
        <ExportPanel api={api} />
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
