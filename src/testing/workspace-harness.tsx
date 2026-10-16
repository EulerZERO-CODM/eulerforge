import { fireEvent, render, screen } from '@testing-library/react';
import { expect } from 'vitest';
import { useEffect, useMemo, useState } from 'react';

import { DocumentAside } from '../components/workspace/document-aside';
import { DocumentStage } from '../components/workspace/document-stage';
import { useSceneImages } from '../components/workspace/use-scene-images';
import type { WorkspaceApi } from '../components/workspace/workspace-api';
import { createDocument } from '../core/documents/factories';
import { DOCUMENTS_KEY } from '../core/persistence/document-repository';
import type { Rect } from '../core/documents/geometry';
import type { GuideSettings } from '../core/documents/types';
import type { Layer } from '../core/documents/layer-types';
import { EMPTY_SELECTION, type Selection } from '../core/editor/selection';
import type { Canvas, ForgeDocument } from '../core/documents/types';
import type { DocumentPatch, DocumentSession } from '../state/document-session';
import { ForgeProvider } from '../state/forge-provider';
import { createTestServices, type TestForgeServices } from './forge-services';
import { sceneOf, TEST_DOCUMENT_TYPE } from './layers';

/**
 * The editing experience wired to the real session, for tests that drive the workspace.
 *
 * Nothing here is stubbed: layers are created by pressing the toolbar, selected by clicking the
 * artboard or the layer list, moved with pointer events, and every one of those paths is checked
 * against the *persisted* document and the history labels a person would read. This is the closest
 * thing to a browser test that runs in this repository, and it is deliberately honest about what it
 * does not cover — jsdom has no rasteriser, so pixel output is verified separately in
 * `src/core/export/raster.test.ts` against a real Canvas 2D implementation.
 *
 * Shared by `workspace-editor.test.tsx` (what each action does) and `undo-redo.test.tsx` (that one
 * action is one undoable step). Helpers stay here so both suites measure the same thing the same
 * way — in particular `undoOnce`/`redoOnce`, which go through the buttons the user presses rather
 * than the session, and `historyLabels`, which reads the list the panel renders.
 */

export const documentId = 'doc-editor';

export const SQUARE_CANVAS: Canvas = {
  width: 1080,
  height: 1080,
  unit: 'px',
  dpi: 96,
  background: '#0f1115',
  transparent: false,
};

/** The other document shape a designer opens, so the maths cannot quietly assume a square. */
export const PORTRAIT_CANVAS: Canvas = { ...SQUARE_CANVAS, width: 900, height: 1600 };

export function makeDocument(
  scene = sceneOf(),
  canvas: Canvas = SQUARE_CANVAS,
): ReturnType<typeof createDocument> {
  return createDocument(
    {
      title: 'Editor fixture',
      studioId: 'design',
      documentTypeId: TEST_DOCUMENT_TYPE,
      canvas: { ...canvas },
      ...(scene.layers.length > 0 ? { scene } : {}),
    },
    { generateId: () => documentId },
  );
}

export function EditorHarness({
  services,
  session,
  snapping = true,
}: {
  readonly services: TestForgeServices;
  readonly session: DocumentSession;
  readonly snapping?: boolean;
}) {
  const [state, setState] = useState(() => session.getState());
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [snap, setSnap] = useState(snapping);
  const [guides, setGuides] = useState(true);

  useEffect(() => session.subscribe(() => setState(session.getState())), [session]);

  const images = useSceneImages(state.document.scene);
  const api = useMemo<WorkspaceApi>(
    () => ({
      doc: state.document,
      commit: async (label: string, patch: DocumentPatch, options) =>
        (await session.commit(label, patch, options)).ok,
      run: async (command, options) =>
        command.ok
          ? (await session.commit(command.value.label, command.value.patch, options)).ok
          : false,
      undo: () => {
        void session.undo();
      },
      redo: () => {
        void session.redo();
      },
    }),
    [session, state.document],
  );

  return (
    <ForgeProvider services={services}>
      <DocumentStage
        api={api}
        selection={selection}
        onSelectionChange={setSelection}
        images={images}
        snapping={snap}
        onSnappingChange={setSnap}
        showGuides={guides}
        onGuidesChange={setGuides}
      />
      <DocumentAside
        api={api}
        scene={state.document.scene}
        images={images}
        selection={selection}
        onSelectionChange={setSelection}
        history={state.history}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        onUndo={() => {
          void session.undo();
        }}
        onRedo={() => {
          void session.redo();
        }}
      />
    </ForgeProvider>
  );
}

export function persisted(services: TestForgeServices): ForgeDocument {
  const document = services.documents.getById(documentId);
  if (!document) throw new Error('the fixture document should be persisted');
  return document;
}

/**
 * The document as it sits in storage, read back through the repository's own envelope.
 *
 * Storage is the end of the chain the user cares about: a history step that is correct in the
 * session but never saved is not a saved edit. Reading the envelope back also proves the repository's
 * key and shape rather than a test-only assumption about them.
 */
export function savedDocument(services: TestForgeServices): ForgeDocument {
  const read = services.storage.get(DOCUMENTS_KEY);
  const raw = read.ok ? read.value : null;
  if (!raw) throw new Error('nothing has been saved to storage');
  const envelope = JSON.parse(raw) as { readonly documents: readonly ForgeDocument[] };
  const document = envelope.documents[0];
  if (!document) throw new Error('the saved envelope holds no document');
  return document;
}

export type MountedWorkspace = {
  readonly services: TestForgeServices;
  readonly session: DocumentSession;
};

/**
 * Opens the workspace on a fixture document.
 *
 * `palette` and `guides` exist because a few rows are about document-level state that has to be
 * *already there* before the control under test means anything: there is no "remove the last palette
 * colour" without a palette, and no "hide the grid" while the grid is already hidden.
 */
export async function mount(
  scene?: ReturnType<typeof sceneOf>,
  options: {
    readonly snapping?: boolean;
    readonly canvas?: Canvas;
    readonly palette?: readonly string[];
    readonly guides?: Partial<GuideSettings>;
  } = {},
): Promise<MountedWorkspace> {
  const services = createTestServices({ generateId: () => documentId });
  const created = makeDocument(scene, options.canvas ?? SQUARE_CANVAS);
  if (!created.ok) throw new Error(`fixture document is invalid: ${created.error.message}`);
  const stored = await services.documents.create({
    title: created.value.title,
    studioId: created.value.studioId,
    documentTypeId: created.value.documentTypeId,
    canvas: created.value.canvas,
    ...(scene ? { scene } : {}),
    ...(options.palette ? { palette: options.palette } : {}),
    ...(options.guides ? { guides: options.guides } : {}),
  });
  if (!stored.ok) throw new Error(`the fixture could not be created: ${stored.error.message}`);

  const session = services.documents.session(documentId);
  if (!session) throw new Error('a session should exist for the fixture');
  const snapping = options.snapping ?? true;
  render(<EditorHarness services={services} session={session} snapping={snapping} />);
  await screen.findByRole('complementary', { name: /document inspector/i });
  return { services, session };
}

export function layerRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid^="layer-row-"]')];
}

/** The name button of a row, found by the layer's visible name (fixtures use "Panel" for lyr-a). */
export function selectRow(name: string): HTMLElement {
  const row = layerRows().find((candidate) => candidate.textContent?.startsWith(name));
  if (!row) throw new Error(`there is no layer row named ${name}`);
  const button = row.querySelector<HTMLElement>('[data-testid^="layer-name-"]');
  if (!button) throw new Error(`the row for ${name} has no name button`);
  return button;
}

/**
 * Selected rows are marked with `aria-current` on the row's name button.
 *
 * The list is a list of buttons rather than a listbox, because each row also contains its own Hide,
 * Lock, Rename, Move, Duplicate and Delete buttons and an `option` may not contain controls.
 */
export function expectSelected(id: string, selected = true): void {
  const button = screen.getByTestId(`layer-name-${id}`);
  if (selected) expect(button).toHaveAttribute('aria-current', 'true');
  else expect(button).not.toHaveAttribute('aria-current', 'true');
}

/**
 * The labels the *product* history panel shows, oldest first.
 *
 * Read from the rendered panel rather than from the session state, so a suite cannot pass while the
 * list a person reads says something else. The panel prints a step number next to each label, which
 * is dropped here.
 */
export function historyLabels(): string[] {
  return panelHistory().map((item) => item.label);
}

/** One row of the history panel: the step number the panel printed, and the label beside it. */
export type HistoryRow = { readonly step: number; readonly label: string };

export function panelHistory(): HistoryRow[] {
  const section = screen.getByRole('region', { name: /history/i });
  return [...section.querySelectorAll('li')]
    .map((item) => {
      const [step, label] = [...item.querySelectorAll('span')];
      return {
        step: Number(step?.textContent ?? '0'),
        label: label?.textContent ?? '',
      };
    })
    .reverse();
}

/** The panel's two operations, as the buttons the user presses. */
export function undoButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Undo' });
}

export function redoButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Redo' });
}

export type PointerOptions = {
  /** Held modifier, as a real pointer event would carry it. */
  readonly modifier?: 'shift' | 'meta' | 'ctrl';
  readonly pointerId?: number;
  readonly target?: HTMLElement;
};

function modifiersOf(options: PointerOptions): Record<string, boolean> {
  return {
    shiftKey: options.modifier === 'shift',
    metaKey: options.modifier === 'meta',
    ctrlKey: options.modifier === 'ctrl',
  };
}

/** Drags on the artboard surface. jsdom has no layout, so client coordinates map 1:1 to document
 * pixels at zoom 1 — the same maths `toDocumentPoint` applies in a browser. */
export function dragOnArtboard(
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: PointerOptions = {},
): void {
  const surface = options.target ?? screen.getByTestId('artboard-surface');
  const pointerId = options.pointerId ?? 1;
  const keys = modifiersOf(options);

  fireEvent.pointerDown(surface, {
    clientX: from.x,
    clientY: from.y,
    pointerId,
    button: 0,
    ...keys,
  });
  fireEvent.pointerMove(surface, { clientX: to.x, clientY: to.y, pointerId, ...keys });
  fireEvent.pointerUp(surface, { clientX: to.x, clientY: to.y, pointerId, ...keys });
}

/** A press and release in one place: a click, as opposed to a drag. */
export function clickOnArtboard(
  point: { x: number; y: number },
  options: PointerOptions = {},
): void {
  dragOnArtboard(point, point, options);
}

/** Document revision, which must not change when only the selection changes. */
export function revision(services: TestForgeServices): number {
  return persisted(services).revision;
}

export function layerFrame(services: TestForgeServices, id: string): Rect {
  const layer = persisted(services).scene.layers.find((candidate) => String(candidate.id) === id);
  if (!layer) throw new Error(`layer ${id} should be in the document`);
  return layer.frame;
}

export function layer(services: TestForgeServices, id: string): Layer {
  const found = persisted(services).scene.layers.find((candidate) => String(candidate.id) === id);
  if (!found) throw new Error(`layer ${id} should be in the document`);
  return found;
}
