/**
 * Photo Studio's editing surface, driven the way a person drives it.
 *
 * The renderer and the download adapter are replaced at the browser boundary — jsdom has no
 * rasteriser, so drawing pixels is Chromium's job (`e2e/photo.spec.ts`) — while everything above it
 * is real: the document, the session, the commands, the history and the panels the user presses.
 * Every assertion below reads the *persisted* payload, so a UI that looked right but wrote nothing
 * would fail.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PhotoWorkspace, isPhotoDocument } from './photo-workspace';
import { ForgeProvider } from '../../state/forge-provider';
import { ToastViewport } from '../ui/toast-viewport';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { brand } from '../../core/types/brand';
import { DEFAULT_GUIDES } from '../../core/documents/factories';
import type { CreateDocumentInput } from '../../core/documents/types';
import {
  defaultPhotoPayload,
  type PhotoPayload,
  type PhotoSource,
} from '../../core/documents/payload';
import type { DocumentSession } from '../../state/document-session';
import { useDocumentSession } from '../../state/hooks';
import type * as Engine from '../../lib/browser/photo-engine';
import type * as DownloadAdapter from '../../lib/browser/download';
import { downloadBytes } from '../../lib/browser/download';

const SOURCE: PhotoSource = {
  name: 'Portrait.png',
  href: 'data:image/png;base64,AAAA',
  width: 400,
  height: 300,
  mimeType: 'image/png',
  originalWidth: 4000,
  originalHeight: 3000,
};

const IMPORTED_SOURCE: PhotoSource = {
  name: 'Second.png',
  href: 'data:image/png;base64,BBBB',
  width: 128,
  height: 96,
  mimeType: 'image/png',
  originalWidth: 128,
  originalHeight: 96,
};

vi.mock('../../lib/browser/download', async (importOriginal) => {
  const actual = await importOriginal<typeof DownloadAdapter>();
  return { ...actual, downloadBytes: vi.fn(() => true) };
});

/**
 * The browser renderer.
 *
 * `renderPhoto` returns an empty 2D canvas of the requested size (jsdom has no pixels) and the
 * engine the real implementation would report. The rest of the module is real except for decoding
 * and encoding, which are exactly the steps that need a browser decoder.
 */
vi.mock('../../lib/browser/photo-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof Engine>();
  const { ok } = await import('../../core/result');
  return {
    ...actual,
    decodePhotoSource: vi.fn(async () =>
      ok({ image: { width: 400, height: 300 } as HTMLImageElement, width: 400, height: 300 }),
    ),
    renderPhoto: vi.fn(async ({ width, height }: { width: number; height: number }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return ok({
        canvas,
        engine: 'canvas2d' as const,
        fallbackReason: null,
        durationMs: 12,
      });
    }),
    preparePhoto: vi.fn(async () =>
      ok({ source: IMPORTED_SOURCE, downscaledFrom: { width: 4000, height: 3000 } }),
    ),
    canEncodeImage: vi.fn(() => true),
    canvasToBytes: vi.fn(async () => ok(new Uint8Array(1234).fill(7))),
    detectWebgl2: vi.fn(() => false),
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/doc-photo',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function photoDocument(payload: PhotoPayload): CreateDocumentInput {
  return {
    title: 'Portrait study',
    studioId: 'photo',
    documentTypeId: brand<'DocumentTypeId'>('photo.image'),
    canvas: {
      width: 400,
      height: 300,
      unit: 'px',
      dpi: 96,
      background: '#0f1115',
      transparent: false,
    },
    guides: DEFAULT_GUIDES,
    studioPayload: payload,
  };
}

function Harness({
  session,
  documentId,
}: {
  readonly session: DocumentSession;
  readonly documentId: string;
}) {
  const { state } = useDocumentSession(documentId);
  if (!state) return <p>no document</p>;
  return (
    <PhotoWorkspace
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
      payload={state.document.studioPayload as PhotoPayload}
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

async function mount(
  services: TestForgeServices,
  payload: PhotoPayload = { ...defaultPhotoPayload(), source: SOURCE },
) {
  await services.documents.load();
  const created = await services.documents.create(photoDocument(payload));
  if (!created.ok) throw new Error(created.error.message);
  const session = services.documents.session(created.value.id);
  if (!session) throw new Error('the session should open');
  render(
    <ForgeProvider services={services}>
      <ToastViewport />
      <Harness session={session} documentId={created.value.id} />
    </ForgeProvider>,
  );
  // The import panel is always present; waiting for it proves the document mounted. The interaction
  // canvas is sized once the mocked renderer has produced its preview, which is what the pointer
  // tests address their coordinates against.
  await screen.findByRole('button', { name: 'Export PNG' });
  const surface = screen.queryByTestId('photo-interaction');
  if (surface) {
    await waitFor(() => {
      expect(surface.getAttribute('width')).toBe('400');
    });
  }
  return { session, documentId: created.value.id };
}

function payloadOf(session: DocumentSession): PhotoPayload {
  const payload = session.getState().document.studioPayload;
  if (!payload || payload.kind !== 'photo') throw new Error('expected a photo payload');
  return payload;
}

/** Press, drag and release on the interaction canvas at normalised positions. */
function paint(
  surface: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: { altKey?: boolean } = {},
): void {
  fireEvent.pointerDown(surface, {
    clientX: from.x,
    clientY: from.y,
    pointerId: 1,
    button: 0,
    bubbles: true,
    ...modifiers,
  });
  fireEvent.pointerMove(surface, {
    clientX: to.x,
    clientY: to.y,
    pointerId: 1,
    bubbles: true,
  });
  fireEvent.pointerUp(surface, { clientX: to.x, clientY: to.y, pointerId: 1, bubbles: true });
}

describe('Photo Studio', () => {
  let services: TestForgeServices;

  beforeEach(() => {
    services = createTestServices();
    vi.mocked(downloadBytes).mockClear();
  });

  it('is selected by document type, not by studio name', () => {
    expect(isPhotoDocument('photo.image')).toBe(true);
    expect(isPhotoDocument('design.canvas')).toBe(false);
  });

  it('shows the imported working copy, both sizes and the renderer that produced the preview', async () => {
    await mount(services);
    expect(
      screen.getByText(/400 × 300 working copy · imported at 4000 × 3000/),
    ).toBeInTheDocument();
    expect(screen.getByText(/preview 400 × 300 · Canvas 2D · 12 ms/)).toBeInTheDocument();
  });

  it('imports a file, embeds the working copy and resizes the document canvas', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services, { ...defaultPhotoPayload(), source: null });
    const file = new File([new Uint8Array([1, 2, 3])], 'Second.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Import a photo file'), file);

    await waitFor(() => {
      expect(payloadOf(session).source?.name).toBe('Second.png');
    });
    const document = session.getState().document;
    expect(document.canvas.width).toBe(128);
    expect(document.canvas.height).toBe(96);
    expect(screen.getByTestId('photo-import-report').textContent).toContain(
      'scaled from 4000 × 3000 to 128 × 96',
    );
    expect(session.getState().history.at(-1)?.label).toBe('Import “Second.png”');
  });

  it('reports a refused file instead of pretending the import worked', async () => {
    const engine = await import('../../lib/browser/photo-engine');
    vi.mocked(engine.preparePhoto).mockImplementationOnce(async () => {
      const { err, forgeError } = await import('../../core/result');
      return err(
        forgeError('unsupported', 'The image could not be decoded by this browser.', {
          detail: 'The file may be corrupt, or in a format this browser cannot open.',
        }),
      );
    });
    const user = userEvent.setup();
    const { session } = await mount(services);
    const revision = session.getState().document.revision;
    const file = new File([new Uint8Array([1])], 'corrupt.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Import a photo file'), file);

    expect(
      await screen.findByText('The image could not be decoded by this browser.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The file may be corrupt, or in a format this browser cannot open.'),
    ).toBeInTheDocument();
    expect(session.getState().document.revision).toBe(revision);
    expect(payloadOf(session).source?.name).toBe('Portrait.png');
  });

  it('adds, edits, bypasses and reorders the non-destructive stack', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services, { ...defaultPhotoPayload(), source: SOURCE });

    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    await waitFor(() => {
      expect(payloadOf(session).adjustments).toHaveLength(1);
    });
    const exposure = payloadOf(session).adjustments[0];
    expect(exposure).toMatchObject({ kind: 'exposure', value: 20, enabled: true });

    fireEvent.change(screen.getByLabelText('Exposure amount'), { target: { value: '80' } });
    await waitFor(() => {
      expect(payloadOf(session).adjustments[0]?.value).toBe(80);
    });

    await user.click(screen.getByRole('button', { name: 'Bypassed' }));
    await waitFor(() => {
      expect(payloadOf(session).adjustments[0]?.enabled).toBe(false);
    });
    expect(session.getState().history.at(-1)?.label).toBe('Bypass exposure');

    // A second adjustment can be moved in front of the first: order is part of the document.
    await user.selectOptions(screen.getByLabelText('Add an adjustment'), 'contrast');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    await waitFor(() => {
      expect(payloadOf(session).adjustments).toHaveLength(2);
    });
    await user.click(screen.getByRole('button', { name: 'Move contrast earlier' }));
    await waitFor(() => {
      expect(payloadOf(session).adjustments.map((item) => item.kind)).toEqual([
        'contrast',
        'exposure',
      ]);
    });
  });

  it('records one history entry for a whole slider drag', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services, { ...defaultPhotoPayload(), source: SOURCE });
    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    const slider = screen.getByLabelText('Exposure amount');
    const before = session.getState().history.length;

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.change(slider, { target: { value: '70' } });
    fireEvent.change(slider, { target: { value: '90' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      expect(payloadOf(session).adjustments[0]?.value).toBe(90);
    });
    expect(session.getState().history.length).toBe(before + 1);
    await session.undo();
    expect(payloadOf(session).adjustments[0]?.value).toBe(20);
  });

  it('paints a real mask stroke with the pointer, and undo removes it in one step', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services, { ...defaultPhotoPayload(), source: SOURCE });
    await user.click(screen.getByRole('button', { name: 'Brush mask' }));

    const surface = screen.getByRole('application');
    paint(surface, { x: 80, y: 60 }, { x: 200, y: 150 });

    await waitFor(() => {
      expect(payloadOf(session).mask?.strokes).toHaveLength(1);
    });
    const stroke = payloadOf(session).mask?.strokes[0];
    expect(stroke).toMatchObject({ erase: false, fill: false, radius: 0.08, hardness: 0.6 });
    expect(stroke?.points).toHaveLength(2);
    expect(stroke?.points[0]).toEqual({ x: 0.2, y: 0.2 });
    expect(session.getState().history.at(-1)?.label).toBe('Paint mask');

    await session.undo();
    expect(payloadOf(session).mask).toBeNull();
  });

  it('supports keyboard painting on the focused surface', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services, { ...defaultPhotoPayload(), source: SOURCE });
    await user.click(screen.getByRole('button', { name: 'Erase mask' }));
    const surface = screen.getByRole('application');
    surface.focus();

    await user.keyboard('{ArrowRight}{ArrowRight}{Space}');
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}{Space}');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(payloadOf(session).mask?.strokes).toHaveLength(1);
    });
    const stroke = payloadOf(session).mask?.strokes[0];
    expect(stroke?.erase).toBe(true);
    expect(stroke?.points).toHaveLength(2);
    expect(stroke?.points[0]).toEqual({ x: 0.54, y: 0.5 });
    expect(stroke?.points[1]).toEqual({ x: 0.54, y: 0.6 });
    expect(session.getState().history.at(-1)?.label).toBe('Erase mask');
  });

  it('closes a lasso into a filled stroke and records a clone source offset', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services, { ...defaultPhotoPayload(), source: SOURCE });
    await user.click(screen.getByRole('button', { name: 'Lasso mask' }));
    paint(screen.getByRole('application'), { x: 40, y: 30 }, { x: 120, y: 90 });
    await waitFor(() => {
      expect(payloadOf(session).mask?.strokes[0]?.fill).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: 'Clone stamp' }));
    const surface = screen.getByRole('application');
    fireEvent.pointerDown(surface, {
      clientX: 100,
      clientY: 100,
      pointerId: 3,
      button: 0,
      altKey: true,
      bubbles: true,
    });
    expect(screen.getByText(/Clone source at 25%, 33%/)).toBeInTheDocument();
    paint(surface, { x: 200, y: 150 }, { x: 220, y: 160 });
    await waitFor(() => {
      expect(payloadOf(session).retouch).toHaveLength(1);
    });
    const stroke = payloadOf(session).retouch[0];
    expect(stroke?.mode).toBe('clone');
    // The source point (0.25, 0.333) is copied onto the stroke start (0.5, 0.5).
    expect(stroke?.offsetX).toBeCloseTo(-0.25, 5);
    expect(stroke?.offsetY).toBeCloseTo(-0.1667, 3);
  });

  it('inverts and clears the mask through the panel', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services, { ...defaultPhotoPayload(), source: SOURCE });
    await user.click(screen.getByRole('button', { name: 'Brush mask' }));
    paint(screen.getByRole('application'), { x: 40, y: 30 }, { x: 120, y: 90 });
    await waitFor(() => {
      expect(payloadOf(session).mask?.strokes).toHaveLength(1);
    });

    await user.click(screen.getByRole('switch', { name: /Invert mask/ }));
    await waitFor(() => {
      expect(payloadOf(session).mask?.inverted).toBe(true);
    });
    expect(session.getState().history.at(-1)?.label).toBe('Invert mask');

    await user.click(screen.getByRole('button', { name: 'Clear mask' }));
    await waitFor(() => {
      expect(payloadOf(session).mask?.strokes).toEqual([]);
    });
  });

  it('compares against the original without writing anything', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services, { ...defaultPhotoPayload(), source: SOURCE });
    const revision = session.getState().document.revision;
    await user.click(screen.getByRole('button', { name: 'Show original' }));
    expect(screen.getByText(/The stack, mask and retouch are skipped here/)).toBeInTheDocument();
    expect(session.getState().document.revision).toBe(revision);
    expect(session.getState().history).toHaveLength(0);
  });

  it('switches the renderer as a document change', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services, { ...defaultPhotoPayload(), source: SOURCE });
    await user.click(screen.getByRole('button', { name: 'CPU (Canvas 2D)' }));
    await waitFor(() => {
      expect(payloadOf(session).engine).toBe('canvas2d');
    });
    expect(session.getState().history.at(-1)?.label).toBe('Use the CPU renderer');
  });

  it('exports real bytes through the download adapter and reports the size', async () => {
    const user = userEvent.setup();
    await mount(services, { ...defaultPhotoPayload(), source: SOURCE });
    await user.click(screen.getByRole('button', { name: 'Export PNG' }));

    await waitFor(() => {
      expect(screen.getByTestId('photo-export-report')).toBeInTheDocument();
    });
    const [bytes, fileName, mimeType] = vi.mocked(downloadBytes).mock.calls[0] ?? [];
    expect(bytes?.byteLength).toBe(1234);
    expect(fileName).toBe('portrait-study-400x300.png');
    expect(mimeType).toBe('image/png');
    expect(screen.getByTestId('photo-export-report').textContent).toContain('1.2 KB');
    expect(screen.getByTestId('photo-export-report').textContent).toContain('400 × 300');
  });

  it('surfaces a GPU fallback reason instead of silently changing engines', async () => {
    const engine = await import('../../lib/browser/photo-engine');
    vi.mocked(engine.renderPhoto).mockImplementationOnce(async ({ width, height }) => {
      const { ok } = await import('../../core/result');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return ok({
        canvas,
        engine: 'canvas2d' as const,
        fallbackReason: 'the fragment shader did not compile',
        durationMs: 40,
      });
    });
    await mount(services);
    expect(await screen.findByText('Fell back to the CPU renderer')).toBeInTheDocument();
    expect(screen.getByText('the fragment shader did not compile')).toBeInTheDocument();
  });

  it('explains that a project without an image has nothing to edit', async () => {
    await mount(services, { ...defaultPhotoPayload(), source: null });
    expect(screen.getByText(/Import a PNG, JPEG or WebP to start editing/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export PNG' })).toBeDisabled();
  });
});
