'use client';

import { useState } from 'react';

import type { PhotoPoint, PhotoPayload } from '../../core/documents/payload';
import { setPhotoEngineCommand } from '../../core/photo/commands';
import { PhotoExportPanel } from './photo-export-panel';
import { PhotoImportPanel } from './photo-import-panel';
import { PhotoStage } from './photo-stage';
import { AdjustmentPanel } from './adjustment-panel';
import { MaskPanel } from './mask-panel';
import type { PhotoTool } from './photo-tools';
import { usePhotoCanvas } from './use-photo-preview';
import { HistoryPanel } from '../workspace/history-panel';
import type { WorkspaceApi } from '../workspace/workspace-api';

/** True for the document type Photo Studio owns. */
export function isPhotoDocument(documentTypeId: string): boolean {
  return documentTypeId === 'photo.image';
}

/**
 * The Photo Studio workspace.
 *
 * Same shell as the other studios: stage on the left, editing panels on the right, one shared
 * session underneath so undo, autosave and history labels behave exactly as they do in Design and
 * Illustration. Tool, brush size, hardness, the clone source and the "show original" comparison are
 * transient interaction state (ADR-0017): they configure the next edit and never reach the document,
 * the history or storage.
 */
export function PhotoWorkspace({
  api,
  payload,
  history,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  readonly api: WorkspaceApi;
  readonly payload: PhotoPayload;
  readonly history: readonly { readonly id: number; readonly label: string }[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}) {
  const [tool, setTool] = useState<PhotoTool>('view');
  const [radius, setRadius] = useState(0.08);
  const [hardness, setHardness] = useState(0.6);
  const [maskVisible, setMaskVisible] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);
  const [samplePoint, setSamplePoint] = useState<PhotoPoint | null>(null);

  const render = usePhotoCanvas({
    href: payload.source?.href ?? null,
    payload,
    showOriginal,
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-5">
        <PhotoStage
          api={api}
          payload={payload}
          render={render}
          tool={tool}
          radius={radius}
          hardness={hardness}
          maskVisible={maskVisible}
          onMaskVisibleChange={setMaskVisible}
          showOriginal={showOriginal}
          onShowOriginalChange={setShowOriginal}
          samplePoint={samplePoint}
          onSamplePointChange={setSamplePoint}
        />
        <PhotoImportPanel api={api} payload={payload} />
        <PhotoExportPanel api={api} payload={payload} />
      </div>

      <aside
        aria-label="Photo inspector"
        className="forge-scroll min-w-0 space-y-7 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:pr-1"
      >
        <AdjustmentPanel api={api} payload={payload} />
        <MaskPanel
          api={api}
          payload={payload}
          tool={tool}
          onToolChange={setTool}
          radius={radius}
          onRadiusChange={setRadius}
          hardness={hardness}
          onHardnessChange={setHardness}
          samplePoint={samplePoint}
          onSamplePointChange={setSamplePoint}
          maskVisible={maskVisible}
          onMaskVisibleChange={setMaskVisible}
        />
        <EnginePanel
          api={api}
          payload={payload}
          renderEngine={render.status === 'ready' ? render.engine : null}
        />
        <HistoryPanel
          labels={history}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      </aside>
    </div>
  );
}

/**
 * Renderer choice.
 *
 * `auto` is the default and the honest recommendation: it uses WebGL2 where the browser offers it
 * and the reference CPU renderer everywhere else. Choosing WebGL2 explicitly is allowed, and fails
 * with a stated reason if it is unavailable rather than quietly doing something else.
 */
function EnginePanel({
  api,
  payload,
  renderEngine,
}: {
  readonly api: WorkspaceApi;
  readonly payload: PhotoPayload;
  readonly renderEngine: 'webgl2' | 'canvas2d' | null;
}) {
  const options: readonly { readonly value: PhotoPayload['engine']; readonly label: string }[] = [
    { value: 'auto', label: 'Automatic' },
    { value: 'webgl2', label: 'GPU (WebGL2)' },
    { value: 'canvas2d', label: 'CPU (Canvas 2D)' },
  ];
  return (
    <section aria-labelledby="photo-engine-heading" className="space-y-2">
      <div>
        <h3
          id="photo-engine-heading"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Renderer
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs">
          Both renderers run the same formulas: the GPU path is one pass per adjustment, the CPU
          path is the reference they are checked against.
          {renderEngine
            ? ` Last preview: ${renderEngine === 'webgl2' ? 'WebGL2' : 'Canvas 2D'}.`
            : ''}
        </p>
      </div>
      <div role="group" aria-label="Renderer" className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={payload.engine === option.value}
            onClick={() => {
              void api.run(setPhotoEngineCommand(api.doc, option.value));
            }}
            className={
              payload.engine === option.value
                ? 'border-accent bg-accent/10 text-fg rounded-sm border px-2.5 py-1 text-xs'
                : 'border-line text-fg-muted hover:border-line-strong rounded-sm border px-2.5 py-1 text-xs'
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
