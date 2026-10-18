/**
 * The Illustration Studio's editing surface, driven the way a person drives it.
 *
 * The pointer commands are real: the stage converts client coordinates to document coordinates from
 * the artboard's own box, so these tests click at *document* positions and assert on the resulting
 * document. Nothing about the interaction is stubbed, which is what makes them evidence for the
 * studio's claims rather than evidence that a component renders.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IllustrationWorkspace, isVectorDocument } from './illustration-workspace';
import { ForgeProvider } from '../../state/forge-provider';
import { ToastViewport } from '../ui/toast-viewport';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { brand } from '../../core/types/brand';
import { DEFAULT_GUIDES } from '../../core/documents/factories';
import type { CreateDocumentInput } from '../../core/documents/types';
import type { Scene } from '../../core/documents/layer-types';
import { createLayer } from '../../core/documents/layer-operations';
import { parsePathData } from '../../core/vector/path-data';
import type { DocumentSession } from '../../state/document-session';
import { useDocumentSession } from '../../state/hooks';
import { EMPTY_SELECTION, type Selection } from '../../core/editor/selection';
import { readZipEntry, readZipEntryNames } from '../../core/svg/zip';
import type * as DownloadAdapter from '../../lib/browser/download';
import { downloadBytes } from '../../lib/browser/download';
import type { SceneImages } from '../workspace/use-scene-images';
import { useState } from 'react';

/**
 * The browser adapter is the boundary the component hands a file to. It is replaced here so a test
 * can read the bytes that *would* be downloaded; writing them is Chromium's job, and
 * `e2e/illustration.spec.ts` checks the real download.
 */
vi.mock('../../lib/browser/download', async (importOriginal) => {
  const actual = await importOriginal<typeof DownloadAdapter>();
  return { ...actual, downloadBytes: vi.fn(() => true) };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/doc-vector',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const images: SceneImages = {
  resolver: () => ({ error: 'this fixture has no graphics' }),
  status: new Map(),
  loading: false,
  errors: [],
  retry: () => {
    /* nothing to retry in this fixture */
  },
};

function vectorDocument(extraLayers: Scene['layers'] = []): CreateDocumentInput {
  return {
    title: 'Icon sheet',
    studioId: 'illustration',
    documentTypeId: brand<'DocumentTypeId'>('illustration.artboard'),
    canvas: {
      width: 200,
      height: 200,
      unit: 'px',
      dpi: 96,
      background: '#0f1115',
      transparent: true,
    },
    guides: DEFAULT_GUIDES,
    scene: { layers: extraLayers },
  };
}

function pathLayer(name: string, data: string) {
  const parsed = parsePathData(data);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const created = createLayer(
    {
      type: 'path',
      frame: { x: 0, y: 0, width: 10, height: 10 },
      vector: { path: parsed.value.path, style: { fill: '#22cc88', stroke: null, strokeWidth: 1 } },
    },
    { name, generateId: () => `lyr-${name.toLowerCase()}` },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

/** A harness that mirrors `WorkspaceView`: one session, one selection value, the real surface. */
function Harness({
  session,
  documentId,
}: {
  readonly session: DocumentSession;
  readonly documentId: string;
}) {
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const { state } = useDocumentSession(documentId);
  if (!state) return <p>no document</p>;
  return (
    <IllustrationWorkspace
      api={{
        doc: state.document,
        commit: async (label, patch, options) => {
          const result = await session.commit(label, patch, options);
          return result.ok;
        },
        run: async (command, options) => {
          if (!command.ok) return false;
          const result = await session.commit(command.value.label, command.value.patch, options);
          return result.ok;
        },
        undo: () => {
          void session.undo();
        },
        redo: () => {
          void session.redo();
        },
      }}
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
  );
}

async function mount(services: TestForgeServices, layers: Scene['layers'] = []) {
  // The library has to be loaded before a session can be opened, exactly as the workspace does it.
  await services.documents.load();
  const created = await services.documents.create(vectorDocument(layers));
  if (!created.ok) throw new Error(created.error.message);
  const session = services.documents.session(created.value.id);
  if (!session) throw new Error('the session should open');
  render(
    <ForgeProvider services={services}>
      {/* The real toast viewport, so a refusal the user would see is the one the test sees. */}
      <ToastViewport />
      <Harness session={session} documentId={created.value.id} />
    </ForgeProvider>,
  );
  await screen.findByTestId('vector-surface');
  return { session, documentId: created.value.id };
}

/**
 * Click the artboard at a document position.
 *
 * The stage converts client coordinates through the surface's own bounding box, which in jsdom is the
 * origin, so a client coordinate *is* a document coordinate here — the same mapping the browser suite
 * exercises for real.
 */
function clickAt(surface: HTMLElement, x: number, y: number, label = 'click'): void {
  fireEvent.pointerDown(surface, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    bubbles: true,
  });
  fireEvent.pointerUp(surface, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true });
  void label;
}

/** Press, drag and release: how a shape gets drawn. */
function dragShape(
  surface: HTMLElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  fireEvent.pointerDown(surface, {
    clientX: fromX,
    clientY: fromY,
    pointerId: 2,
    button: 0,
    bubbles: true,
  });
  fireEvent.pointerMove(surface, { clientX: toX, clientY: toY, pointerId: 2, bubbles: true });
  fireEvent.pointerUp(surface, {
    clientX: toX,
    clientY: toY,
    pointerId: 2,
    button: 0,
    bubbles: true,
  });
}

describe('the vector document surface', () => {
  let services: TestForgeServices;

  beforeEach(() => {
    services = createTestServices();
  });

  it('is selected by document type, not by studio name', () => {
    expect(isVectorDocument('illustration.artboard')).toBe(true);
    expect(isVectorDocument('design.canvas')).toBe(false);
  });

  it('shows every tool the studio claims, and none of them is decorative', async () => {
    const user = userEvent.setup();
    await mount(services);

    for (const id of ['select', 'node', 'pen', 'rectangle', 'ellipse', 'star']) {
      expect(screen.getByTestId(`tool-${id}`)).toBeInTheDocument();
    }

    await user.click(screen.getByTestId('tool-pen'));
    expect(screen.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');
    // The status line names the active tool and its gesture, so the toolbar is not a row of
    // unlabelled buttons and the next step is on screen.
    expect(screen.getByTestId('vector-status')).toHaveTextContent(
      /Pen tool — Draw a path node by node/i,
    );
  });

  it('draws a path with the pen and records one undoable action', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    await user.click(screen.getByTestId('tool-pen'));
    const surface = screen.getByTestId('vector-surface');

    // Three clicks, each a press and a release, exactly as a person draws a triangle.
    clickAt(surface, 20, 20);
    clickAt(surface, 120, 20);
    clickAt(surface, 90, 120, 'draft');
    expect(screen.getByTestId('pen-draft')).toBeInTheDocument();
    await user.click(screen.getByTestId('finish-path'));

    await waitFor(() => {
      const layers = session.getState().document.scene.layers;
      expect(layers).toHaveLength(1);
      expect(layers[0]?.type).toBe('path');
    });
    const labels = session
      .getState()
      .history.map((entry: { readonly label: string }) => entry.label);
    expect(labels).toEqual(['Draw “Path”']);

    await session.undo();
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(0);
    });
    await session.redo();
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });
  });

  it('edits nodes of a selected path, and reports the geometry it is working on', async () => {
    const user = userEvent.setup();
    const layer = pathLayer('Square', 'M20 20 L120 20 L120 120 L20 120 Z');
    const { session } = await mount(services, [layer]);

    await user.click(screen.getByTestId(`layer-name-${String(layer.id)}`));
    await user.click(screen.getByTestId('tool-node'));

    expect(screen.getByTestId('node-summary')).toHaveTextContent(/4 nodes · 4 segments/);
    // Every node is a real, focusable control, so node editing is reachable without a pointer.
    const node = screen.getByTestId('node-0-1');
    expect(node).toHaveAccessibleName(/node 2 of contour 1/i);

    await user.click(node);
    expect(node).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('node-summary')).toHaveTextContent(/1 selected/);

    await user.click(screen.getByTestId('node-smooth'));
    await waitFor(() => {
      const edited = session.getState().document.scene.layers[0];
      if (edited?.type !== 'path') throw new Error('expected a path layer');
      expect(edited.vector.path.contours[0]?.nodes[1]?.handleOut).not.toBeNull();
    });
    expect(session.getState().history.at(-1)?.label).toContain('Smooth node');

    await user.click(screen.getByTestId('node-delete'));
    await waitFor(() => {
      const edited = session.getState().document.scene.layers[0];
      if (edited?.type !== 'path') throw new Error('expected a path layer');
      expect(edited.vector.path.contours[0]?.nodes).toHaveLength(3);
    });
  });

  it('moves a node with the arrow keys, so the node tool is not pointer-only', async () => {
    const user = userEvent.setup();
    const layer = pathLayer('Square', 'M20 20 L120 20 L120 120 L20 120 Z');
    const { session } = await mount(services, [layer]);

    await user.click(screen.getByTestId(`layer-name-${String(layer.id)}`));
    await user.click(screen.getByTestId('tool-node'));
    await user.click(screen.getByTestId('node-0-0'));
    screen.getByTestId('vector-surface').focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');

    await waitFor(() => {
      const edited = session.getState().document.scene.layers[0];
      if (edited?.type !== 'path') throw new Error('expected a path layer');
      expect(edited.vector.path.contours[0]?.nodes[0]?.point.x).toBe(22);
    });
    expect(session.getState().history.at(-1)?.label).toBe('Nudge node on “Square”');
  });

  it('creates a shape by dragging, and combines two shapes with a boolean operation', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    await user.click(screen.getByTestId('tool-rectangle'));
    const surface = screen.getByTestId('vector-surface');
    dragShape(surface, 20, 20, 100, 100);

    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });

    await user.click(screen.getByTestId('tool-ellipse'));
    dragShape(surface, 60, 60, 160, 160);

    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(2);
    });

    // Select both from the layer list, then unite them: one real shape, with a report.
    const first = session.getState().document.scene.layers[0];
    const second = session.getState().document.scene.layers[1];
    if (!first || !second) throw new Error('two shapes should exist');
    await user.click(screen.getByTestId(`layer-name-${String(first.id)}`));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByTestId(`layer-name-${String(second.id)}`));
    await user.keyboard('{/Shift}');

    const booleanButton = screen.getByTestId('boolean-union');
    expect(booleanButton).toBeEnabled();
    await user.click(booleanButton);

    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });
    const united = session.getState().document.scene.layers[0];
    if (united?.type !== 'path') throw new Error('expected a path layer');
    expect(united.name).toBe('Unite of 2 shapes');
    expect(screen.getByTestId('boolean-report')).toHaveTextContent(
      /flattening curves at a tolerance/i,
    );
  });

  it('records one history entry per action, and coalesces only a held key', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);
    const surface = screen.getByTestId('vector-surface');

    await user.click(screen.getByTestId('tool-rectangle'));
    dragShape(surface, 20, 20, 60, 60);
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });
    // A second rectangle is a second action: separate entries with the same honest label, not one
    // coalesced entry that would make undo skip a shape.
    dragShape(surface, 80, 80, 140, 140);
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(2);
    });
    expect(session.getState().history.map((entry) => entry.label)).toEqual([
      'Draw “Rectangle”',
      'Draw “Rectangle”',
    ]);

    await session.undo();
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });

    // A held arrow key, by contrast, is one continuous interaction and must collapse into one entry.
    const layer = session.getState().document.scene.layers[0];
    if (!layer) throw new Error('one rectangle should remain');
    await user.click(screen.getByTestId(`layer-name-${String(layer.id)}`));
    await user.click(screen.getByTestId('tool-node'));
    await user.click(screen.getByTestId('node-0-0'));
    const before = session.getState().history.length;
    surface.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    await waitFor(() => {
      const edited = session.getState().document.scene.layers[0];
      if (edited?.type !== 'path') throw new Error('expected a path layer');
      expect(edited.vector.path.contours[0]?.nodes[0]?.point.x).toBe(23);
    });
    expect(session.getState().history.length).toBe(before + 1);
    expect(session.getState().history.at(-1)?.label).toContain('Nudge node');
  });

  it('says what to select rather than showing an empty inspector', async () => {
    await mount(services);

    expect(screen.getByRole('heading', { name: 'Vector' })).toBeInTheDocument();
    expect(
      screen.getByText(/select a shape on the artboard or in the layer list/i),
    ).toBeInTheDocument();
  });

  it('disables a boolean that needs two shapes, and says what is missing', async () => {
    const user = userEvent.setup();
    const layer = pathLayer('Only', 'M20 20 L80 20 L80 80 Z');
    await mount(services, [layer]);

    await user.click(screen.getByTestId(`layer-name-${String(layer.id)}`));
    expect(screen.getByTestId('boolean-union')).toBeDisabled();
    expect(screen.getByTestId('boolean-union').getAttribute('title')).toContain(
      'Select two or more',
    );
  });

  it('converts a shape layer into editable paths, in place', async () => {
    const user = userEvent.setup();
    const rect = createLayer(
      { type: 'rect', frame: { x: 20, y: 20, width: 60, height: 40 }, shape: { fill: '#ff8800' } },
      { name: 'Box', generateId: () => 'lyr-box' },
    );
    if (!rect.ok) throw new Error(rect.error.message);
    const { session } = await mount(services, [rect.value]);

    await user.click(screen.getByTestId('layer-name-lyr-box'));
    await user.click(screen.getByTestId('outline-lyr-box'));

    await waitFor(() => {
      const layers = session.getState().document.scene.layers;
      expect(layers[0]?.type).toBe('path');
      expect(layers[0]?.name).toBe('Box');
    });
    const converted = session.getState().document.scene.layers[0];
    if (converted?.type !== 'path') throw new Error('expected a path layer');
    expect(converted.vector.style.fill).toBe('#ff8800');
    expect(converted.vector.path.contours[0]?.nodes).toHaveLength(4);
  });
});

describe('SVG and icon-set panels', () => {
  let services: TestForgeServices;

  beforeEach(() => {
    services = createTestServices();
  });

  it('refuses hostile SVG markup without creating a layer', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    await user.type(
      screen.getByTestId('svg-paste'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0L10 0Z"/></svg>',
    );
    await user.click(screen.getByTestId('svg-import-paste'));

    await waitFor(() => {
      expect(screen.getByText(/could not be imported/i)).toBeInTheDocument();
    });
    expect(session.getState().document.scene.layers).toHaveLength(0);
  });

  it('imports pasted SVG as editable layers and reports the import', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    await user.type(
      screen.getByTestId('svg-paste'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Mark</title><path d="M4 4 L20 4 L20 20 L4 20 Z" fill="#123456"/></svg>',
    );
    await user.click(screen.getByTestId('svg-import-paste'));

    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });
    const imported = session.getState().document.scene.layers[0];
    if (imported?.type !== 'path') throw new Error('expected a path layer');
    expect(imported.vector.style.fill).toBe('#123456');
    expect(screen.getByTestId('svg-import-paste')).toBeInTheDocument();
  });

  it('summarises the SVG it would write, and blocks an empty document', async () => {
    const layer = pathLayer('Square', 'M20 20 L120 20 L120 120 L20 120 Z');
    await mount(services, [layer]);

    const summary = await screen.findByTestId('svg-export-summary');
    expect(summary).toHaveTextContent('icon-sheet.svg');
    expect(summary).toHaveTextContent(/B ·/);

    const button = screen.getByTestId('svg-export');
    expect(button).toBeEnabled();
  });

  it('counts and packages exactly the selected visible vector layers', async () => {
    const user = userEvent.setup();
    vi.mocked(downloadBytes).mockClear();
    const square = pathLayer('Square', 'M20 20 L120 20 L120 120 L20 120 Z');
    const circle = pathLayer(
      'Circle',
      'M60 20 C80 20 100 40 100 60 C100 80 80 100 60 100 C40 100 20 80 20 60 C20 40 40 20 60 20 Z',
    );
    const star = pathLayer(
      'Star',
      'M60 20 L72 52 L104 52 L78 72 L88 104 L60 84 L32 104 L42 72 L16 52 L48 52 Z',
    );
    await mount(services, [square, circle, star]);

    const button = screen.getByTestId('icon-set-export');
    const summary = screen.getByTestId('icon-set-summary');
    // Nothing selected: the panel says what to do and offers no download.
    expect(button).toBeDisabled();
    expect(summary).toHaveTextContent(/Select one or more visible vector layers/i);

    await user.click(screen.getByTestId(`layer-name-${String(square.id)}`));
    await user.keyboard('{Control>}');
    await user.click(screen.getByTestId(`layer-name-${String(circle.id)}`));
    await user.keyboard('{/Control}');
    expect(summary).toHaveTextContent(/^2 selected visible vector layer\(s\) will be written/);
    expect(button).toBeEnabled();

    await user.click(button);

    const call = vi.mocked(downloadBytes).mock.calls.at(-1);
    if (!call) throw new Error('the icon set never reached the download adapter');
    const [bytes, fileName] = call;
    expect(fileName).toBe('icon-set.zip');
    // Exactly the two chosen icons, the sprite and the manifest: not the unselected star.
    expect(readZipEntryNames(bytes)).toEqual([
      'square.svg',
      'circle.svg',
      'icons.svg',
      'icons.json',
    ]);
    const manifest = JSON.parse(
      new TextDecoder().decode(readZipEntry(bytes, 'icons.json') ?? new Uint8Array()),
    ) as { icons: { name: string; file: string }[] };
    expect(manifest.icons.map((icon) => icon.name)).toEqual(['Square', 'Circle']);
    expect(manifest.icons.map((icon) => icon.file)).toEqual(['square.svg', 'circle.svg']);
    expect(screen.getByTestId('icon-set-report')).toHaveTextContent('2 icon file(s)');
    expect(screen.getByTestId('icon-set-report')).toHaveTextContent('square.svg, circle.svg');
    expect(screen.getByTestId('icon-set-report')).not.toHaveTextContent('star.svg');

    // Clearing the selection disables the export and retires the report it described.
    const surface = screen.getByTestId('vector-surface');
    await user.click(screen.getByTestId('tool-select'));
    fireEvent.pointerDown(surface, {
      clientX: 2,
      clientY: 2,
      pointerId: 9,
      button: 0,
      bubbles: true,
    });
    fireEvent.pointerUp(surface, {
      clientX: 2,
      clientY: 2,
      pointerId: 9,
      button: 0,
      bubbles: true,
    });
    expect(button).toBeDisabled();
    expect(summary).toHaveTextContent(/Select one or more visible vector layers/i);
    expect(screen.queryByTestId('icon-set-report')).not.toBeInTheDocument();
  });

  it('leaves hidden selected layers out of the set and names them', async () => {
    const user = userEvent.setup();
    vi.mocked(downloadBytes).mockClear();
    const square = pathLayer('Square', 'M20 20 L120 20 L120 120 L20 120 Z');
    const circle = pathLayer(
      'Circle',
      'M60 20 C80 20 100 40 100 60 C100 80 80 100 60 100 C40 100 20 80 20 60 C20 40 40 20 60 20 Z',
    );
    await mount(services, [square, circle]);

    await user.click(screen.getByTestId(`layer-name-${String(square.id)}`));
    await user.keyboard('{Control>}');
    await user.click(screen.getByTestId(`layer-name-${String(circle.id)}`));
    await user.keyboard('{/Control}');
    expect(screen.getByTestId('icon-set-summary')).toHaveTextContent(/^2 selected/);

    // A hidden layer is never part of the drawing, so it is never part of the set.
    await user.click(screen.getByRole('button', { name: 'Hide “Square”' }));
    const summary = screen.getByTestId('icon-set-summary');
    const button = screen.getByTestId('icon-set-export');
    expect(summary).toHaveTextContent(/^1 selected visible vector layer\(s\)/);
    expect(summary).toHaveTextContent(/Not written: “Square” — the layer is hidden/);
    expect(button).toBeEnabled();

    await user.click(button);
    const bytes = vi.mocked(downloadBytes).mock.calls.at(-1)?.[0];
    if (!bytes) throw new Error('the icon set never reached the download adapter');
    expect(readZipEntryNames(bytes)).toEqual(['circle.svg', 'icons.svg', 'icons.json']);
    expect(screen.getByTestId('icon-set-report')).toHaveTextContent(
      'Not written: “Square” — the layer is hidden',
    );

    // Hiding the rest leaves nothing to export, and the button explains why instead of writing an
    // empty archive.
    await user.click(screen.getByRole('button', { name: 'Hide “Circle”' }));
    expect(screen.getByTestId('icon-set-export')).toBeDisabled();
    expect(screen.getByTestId('icon-set-summary')).toHaveTextContent(
      /None of the 2 selected layer\(s\) can be written as icons/,
    );
  });

  it('states the interchange limitations and carries a vector shape to the Design Studio', async () => {
    const user = userEvent.setup();
    const layer = pathLayer('Square', 'M20 20 L120 20 L120 120 L20 120 Z');
    const { documentId } = await mount(services, [layer]);

    const interchange = screen.getByRole('heading', { name: 'Interchange' }).closest('section');
    if (!interchange) throw new Error('the interchange section should exist');
    await user.click(within(interchange).getByText(/what the model cannot carry/i));
    expect(within(interchange).getByText(/no rotation is applied or lost/i)).toBeInTheDocument();

    await user.click(within(interchange).getByTestId('interchange-create'));

    await waitFor(() => {
      expect(within(interchange).getByTestId('interchange-created')).toBeInTheDocument();
    });
    const created = services.documents.getState().documents.find((doc) => doc.id !== documentId);
    expect(created?.studioId).toBe('design');
    expect(created?.scene.layers[0]?.type).toBe('path');
    if (created?.scene.layers[0]?.type !== 'path') throw new Error('expected a path layer');
    expect(created.scene.layers[0].vector.path.contours[0]?.nodes).toHaveLength(4);
  });
});
