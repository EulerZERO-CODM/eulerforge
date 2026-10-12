import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useMemo, useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DocumentAside } from './document-aside';
import { DocumentStage } from './document-stage';
import { useSceneImages } from './use-scene-images';
import type { WorkspaceApi } from './workspace-api';
import { createDocument } from '../../core/documents/factories';
import { createRect, type Rect } from '../../core/documents/geometry';
import type { Layer } from '../../core/documents/layer-types';
import { EMPTY_SELECTION, type Selection } from '../../core/editor/selection';
import type { ForgeDocument } from '../../core/documents/types';
import type { DocumentPatch, DocumentSession } from '../../state/document-session';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { rectLayer, sceneOf, stackOf, textLayer, TEST_DOCUMENT_TYPE } from '../../testing/layers';

/**
 * The editing experience, end to end through the real session.
 *
 * Nothing here is stubbed: layers are created by pressing the toolbar, selected by clicking the
 * artboard or the layer list, moved with pointer events, and every one of those paths is checked
 * against the *persisted* document and the history labels a person would read. This is the closest
 * thing to a browser test that runs in this repository, and it is deliberately honest about what it
 * does not cover — jsdom has no rasteriser, so pixel output is verified separately in
 * `src/core/export/raster.test.ts` against a real Canvas 2D implementation.
 */

const documentId = 'doc-editor';

function makeDocument(scene = sceneOf()): ReturnType<typeof createDocument> {
  return createDocument(
    {
      title: 'Editor fixture',
      studioId: 'design',
      documentTypeId: TEST_DOCUMENT_TYPE,
      canvas: {
        width: 1080,
        height: 1080,
        unit: 'px',
        dpi: 96,
        background: '#0f1115',
        transparent: false,
      },
      ...(scene.layers.length > 0 ? { scene } : {}),
    },
    { generateId: () => documentId },
  );
}

function EditorHarness({
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
      commit: async (label: string, patch: DocumentPatch) =>
        (await session.commit(label, patch)).ok,
      run: async (command) =>
        command.ok ? (await session.commit(command.value.label, command.value.patch)).ok : false,
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
      <ul data-testid="history">
        {state.history.map((entry) => (
          <li key={entry.id}>{entry.label}</li>
        ))}
      </ul>
    </ForgeProvider>
  );
}

function persisted(services: TestForgeServices): ForgeDocument {
  const document = services.documents.getById(documentId);
  if (!document) throw new Error('the fixture document should be persisted');
  return document;
}

async function mount(
  scene?: ReturnType<typeof sceneOf>,
  options: { readonly snapping?: boolean } = {},
): Promise<{ services: TestForgeServices; session: DocumentSession }> {
  const services = createTestServices({ generateId: () => documentId });
  const created = makeDocument(scene);
  if (!created.ok) throw new Error(`fixture document is invalid: ${created.error.message}`);
  const stored = await services.documents.create({
    title: created.value.title,
    studioId: created.value.studioId,
    documentTypeId: created.value.documentTypeId,
    canvas: created.value.canvas,
    ...(scene ? { scene } : {}),
  });
  if (!stored.ok) throw new Error(`the fixture could not be created: ${stored.error.message}`);

  const session = services.documents.session(documentId);
  if (!session) throw new Error('a session should exist for the fixture');
  const snapping = options.snapping ?? true;
  render(<EditorHarness services={services} session={session} snapping={snapping} />);
  await screen.findByRole('complementary', { name: /document inspector/i });
  return { services, session };
}

/** The row's name is a button; pressing it is what selects the layer. */
function selectRow(name: string): HTMLElement {
  const row = screen.getAllByRole('option').find((option) => option.textContent?.startsWith(name));
  if (!row) throw new Error(`there is no layer row named ${name}`);
  return within(row).getByRole('button', { name: new RegExp(`^${name}`) });
}

function historyLabels(): string[] {
  return [...screen.getByTestId('history').querySelectorAll('li')].map(
    (item) => item.textContent ?? '',
  );
}

/** Drags on the artboard surface. jsdom has no layout, so client coordinates map 1:1 to document
 * pixels at zoom 1 — the same maths `toDocumentPoint` applies in a browser. */
function dragOnArtboard(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const surface = screen.getByTestId('artboard-surface');
  fireEvent.pointerDown(surface, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
  fireEvent.pointerMove(surface, { clientX: to.x, clientY: to.y, pointerId: 1 });
  fireEvent.pointerUp(surface, { clientX: to.x, clientY: to.y, pointerId: 1 });
}

function layerFrame(services: TestForgeServices, id: string): Rect {
  const layer = persisted(services).scene.layers.find((candidate) => String(candidate.id) === id);
  if (!layer) throw new Error(`layer ${id} should be in the document`);
  return layer.frame;
}

function layer(services: TestForgeServices, id: string): Layer {
  const found = persisted(services).scene.layers.find((candidate) => String(candidate.id) === id);
  if (!found) throw new Error(`layer ${id} should be in the document`);
  return found;
}

describe('adding layers from the toolbar', () => {
  it('adds a text layer as a single labelled commit', async () => {
    const { services } = await mount();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Text' }));

    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(1);
    });
    expect(historyLabels()).toEqual(['Add text layer']);
    expect(persisted(services).scene.layers[0]?.type).toBe('text');
    // The artboard's accessible name counts what is really in the document.
    expect(screen.getByRole('img', { name: /1 layers/i })).toBeInTheDocument();
  });

  it('adds a rectangle and an ellipse, each with its own history step', async () => {
    const { services } = await mount();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rectangle' }));
    await waitFor(() => {
      expect(historyLabels()).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: 'Ellipse' }));
    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(2);
    });

    expect(historyLabels()).toEqual(['Add rectangle layer', 'Add ellipse layer']);
  });

  it('places a catalogue graphic with a click and records its attribution', async () => {
    const { services } = await mount();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Graphic' }));
    const placeButtons = await screen.findAllByRole('button', { name: /place on canvas/i });
    await user.click(placeButtons[0] as HTMLElement);

    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(1);
    });
    const placed = persisted(services).scene.layers[0];
    expect(placed?.type).toBe('image');
    expect(historyLabels()).toEqual([
      expect.stringMatching(/^Place graphic “/) as unknown as string,
    ]);
    expect(placed?.type === 'image' ? placed.image.assetId : null).not.toBeNull();
  });
});

describe('selecting and editing through the interface', () => {
  it('selects a layer from the list and renames it through the inspector', async () => {
    const { services } = await mount(sceneOf(rectLayer('lyr-a', { name: 'Panel' })));
    const user = userEvent.setup();

    await user.click(selectRow('Panel'));
    expect(screen.getByTestId('layer-row-lyr-a')).toHaveAttribute('aria-selected', 'true');

    const nameField = screen.getByLabelText('Layer name');
    await user.clear(nameField);
    await user.type(nameField, 'Hero panel');
    await user.tab();

    await waitFor(() => {
      expect(layer(services, 'lyr-a').name).toBe('Hero panel');
    });
    expect(historyLabels()).toEqual(['Rename layer to “Hero panel”']);
  });

  it('hides, duplicates and deletes from the layer list, one commit each', async () => {
    const { services } = await mount(sceneOf(rectLayer('lyr-a', { name: 'Panel' })));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Hide “Panel”' }));
    await waitFor(() => {
      expect(layer(services, 'lyr-a').visible).toBe(false);
    });

    await user.click(screen.getByRole('button', { name: 'Duplicate “Panel”' }));
    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(2);
    });

    const copy = persisted(services).scene.layers.find((entry) => String(entry.id) !== 'lyr-a');
    expect(copy?.name).toBe('Panel copy');

    await user.click(screen.getByRole('button', { name: 'Delete “Panel copy”' }));
    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(1);
    });

    expect(historyLabels()).toEqual(['Hide “Panel”', 'Duplicate “Panel”', 'Delete “Panel copy”']);
  });

  it('reorders the stack and keeps the top of the list painting on top', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Bottom' }), rectLayer('lyr-b', { name: 'Top' })),
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Send “Top” backward' }));

    await waitFor(() => {
      expect(persisted(services).scene.layers.map((entry) => String(entry.id))).toEqual([
        'lyr-b',
        'lyr-a',
      ]);
    });
    expect(historyLabels()).toEqual(['Send backward: “Top”']);
  });

  it('operates the layer list from the keyboard', async () => {
    await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Bottom' }), rectLayer('lyr-b', { name: 'Top' })),
    );
    const list = screen.getByRole('listbox', { name: 'Layer stack' });

    list.focus();
    // The list is top-first, so the first ArrowDown lands on the top-most layer.
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(screen.getByTestId('layer-row-lyr-b')).toHaveAttribute('aria-selected', 'true');
    });

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(screen.getByTestId('layer-row-lyr-a')).toHaveAttribute('aria-selected', 'true');
    });

    fireEvent.keyDown(list, { key: 'Home' });
    await waitFor(() => {
      expect(screen.getByTestId('layer-row-lyr-b')).toHaveAttribute('aria-selected', 'true');
    });

    fireEvent.keyDown(list, { key: 'End' });
    await waitFor(() => {
      expect(screen.getByTestId('layer-row-lyr-a')).toHaveAttribute('aria-selected', 'true');
    });
  });
});

describe('direct manipulation on the artboard', () => {
  it('moves a layer with a pointer drag and commits exactly once, on release', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 200 })),
      {
        snapping: false,
      },
    );
    const surface = screen.getByTestId('artboard-surface');

    fireEvent.pointerDown(surface, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(surface, { clientX: 240, clientY: 160, pointerId: 1 });
    // Mid-drag: the preview is transient and nothing has been written yet.
    expect(historyLabels()).toEqual([]);
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 200, 200));

    fireEvent.pointerUp(surface, { clientX: 240, clientY: 160, pointerId: 1 });

    await waitFor(() => {
      expect(layerFrame(services, 'lyr-a')).toEqual(createRect(140, 60, 200, 200));
    });
    expect(historyLabels()).toEqual(['Move “Panel”']);
  });

  it('drops a cancelled gesture without leaving a half-commit behind', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 200 })),
      {
        snapping: false,
      },
    );
    const surface = screen.getByTestId('artboard-surface');

    fireEvent.pointerDown(surface, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(surface, { clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.keyDown(surface, { key: 'Escape' });
    fireEvent.pointerUp(surface, { clientX: 400, clientY: 400, pointerId: 1 });

    expect(historyLabels()).toEqual([]);
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 200, 200));
  });

  it('resizes through a visible handle, which is labelled and focusable', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 200 })),
      {
        snapping: false,
      },
    );

    // Select the layer first: handles only exist for a selection.
    dragOnArtboard({ x: 200, y: 200 }, { x: 200, y: 200 });
    const handle = screen.getByRole('button', { name: 'Resize bottom right' });
    expect(handle).toBeInTheDocument();

    fireEvent.pointerDown(handle, { clientX: 300, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 350, clientY: 330, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 350, clientY: 330, pointerId: 1 });

    await waitFor(() => {
      expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 250, 230));
    });
    expect(historyLabels()).toEqual(['Resize “Panel”']);
  });

  it('selects several layers with a marquee over empty space', async () => {
    await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 100, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 300, y: 300, width: 100, height: 100 }),
      ),
      { snapping: false },
    );

    dragOnArtboard({ x: 40, y: 40 }, { x: 500, y: 500 });

    await waitFor(() => {
      expect(screen.getByTestId('layer-row-lyr-a')).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByTestId('layer-row-lyr-b')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('a thirty-layer document', () => {
  it('mounts, reports every layer and paints into a single canvas element', async () => {
    const { services } = await mount(stackOf(30));

    expect(screen.getByRole('img', { name: /30 layers/i })).toBeInTheDocument();
    expect(screen.getAllByTestId('document-canvas')).toHaveLength(1);
    expect(
      within(screen.getByRole('listbox', { name: 'Layer stack' })).getAllByRole('option'),
    ).toHaveLength(30);
    // Loading a document is not an edit: history starts empty.
    expect(historyLabels()).toEqual([]);
    expect(persisted(services).scene.layers).toHaveLength(30);
  });

  it('selects the whole stack with a marquee and moves it in one commit', async () => {
    const { services } = await mount(stackOf(30), { snapping: false });
    const before = persisted(services).scene.layers.map((entry) => entry.frame.x);

    // Every stack layer sits inside the top-left 320x280 region, so a marquee over it selects all 30.
    dragOnArtboard({ x: 350, y: 350 }, { x: 10, y: 10 });
    await waitFor(() => {
      expect(screen.getByTestId('layer-row-lyr-stack-0')).toHaveAttribute('aria-selected', 'true');
    });
    expect(historyLabels()).toEqual([]);

    // Dragging one of the selected layers moves the whole selection.
    dragOnArtboard({ x: 250, y: 200 }, { x: 300, y: 230 });

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Move 30 layers']);
    });

    const after = persisted(services).scene.layers.map((entry) => entry.frame.x);
    const deltas = new Set(after.map((value, index) => value - (before[index] ?? 0)));
    // One snapped delta for the whole selection: the stack keeps its internal spacing.
    expect(deltas.size).toBe(1);
  });
});

describe('text layers', () => {
  it('edits content and typography through the inspector', async () => {
    const { services } = await mount(sceneOf(textLayer('lyr-t', { name: 'Headline' })));
    const user = userEvent.setup();

    await user.click(selectRow('Headline'));
    const content = screen.getByRole('textbox', { name: /content/i });
    await user.clear(content);
    await user.type(content, 'Launch night');
    await user.tab();

    await waitFor(() => {
      const stored = layer(services, 'lyr-t');
      expect(stored.type === 'text' ? stored.text.content : '').toBe('Launch night');
    });

    const size = screen.getByLabelText(/^size/i);
    await user.clear(size);
    await user.type(size, '96');
    await user.tab();

    await waitFor(() => {
      const stored = layer(services, 'lyr-t');
      expect(stored.type === 'text' ? stored.text.fontSize : 0).toBe(96);
    });

    expect(historyLabels()).toEqual([
      'Edit text in “Headline”',
      'Set “Headline” font size to 96px',
    ]);
  });

  it('refuses an out-of-range size and says so instead of saving it', async () => {
    await mount(sceneOf(textLayer('lyr-t', { name: 'Headline' })));
    const user = userEvent.setup();

    await user.click(selectRow('Headline'));
    const size = screen.getByLabelText(/^size/i);
    await user.clear(size);
    await user.type(size, '9000');
    await user.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(/4 and 800/i);
    expect(historyLabels()).toEqual([]);
  });
});
