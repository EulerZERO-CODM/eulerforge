/**
 * Motion Studio, driven the way a person drives it.
 *
 * The frame exporter and the download adapter are replaced at the browser boundary — jsdom cannot
 * encode a PNG — while everything above it is real: the document, the session, the command history
 * and the panels. Assertions read the persisted payload, so a UI that looked right but committed
 * nothing would fail here.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionWorkspace, isMotionDocument } from './motion-workspace';
import { ForgeProvider } from '../../state/forge-provider';
import { ToastViewport } from '../ui/toast-viewport';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { brand } from '../../core/types/brand';
import { DEFAULT_GUIDES } from '../../core/documents/factories';
import type { CreateDocumentInput } from '../../core/documents/types';
import { defaultMotionPayload, type MotionPayload } from '../../core/documents/payload';
import type { DocumentSession } from '../../state/document-session';
import { useDocumentSession } from '../../state/hooks';
import type * as MotionEngine from '../../lib/browser/motion-engine';
import type * as DownloadAdapter from '../../lib/browser/download';
import { downloadBytes } from '../../lib/browser/download';

vi.mock('../../lib/browser/download', async (importOriginal) => {
  const actual = await importOriginal<typeof DownloadAdapter>();
  return { ...actual, downloadBytes: vi.fn(() => true) };
});

/**
 * The frame exporter.
 *
 * Rendering 1080 px frames is Chromium's job (`e2e/motion.spec.ts`); here the exporter returns the
 * archive it would produce so the panel, the download call and the report are exercised end to end.
 */
vi.mock('../../lib/browser/motion-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof MotionEngine>();
  return {
    ...actual,
    exportMotionFrames: vi.fn(async () => ({
      status: 'exported' as const,
      zip: new Uint8Array([80, 75, 3, 4, 9, 9, 9]),
      frames: 3,
      width: 1080,
      height: 1080,
    })),
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/doc-motion',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function motionDocument(payload: MotionPayload): CreateDocumentInput {
  return {
    title: 'Launch title',
    studioId: 'motion',
    documentTypeId: brand<'DocumentTypeId'>('motion.scene'),
    canvas: {
      width: 1080,
      height: 1080,
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
    <MotionWorkspace
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
      payload={state.document.studioPayload as MotionPayload}
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

async function mount(services: TestForgeServices, payload: MotionPayload = defaultMotionPayload()) {
  await services.documents.load();
  const created = await services.documents.create(motionDocument(payload));
  if (!created.ok) throw new Error(created.error.message);
  const session = services.documents.session(created.value.id);
  if (!session) throw new Error('the session should open');
  render(
    <ForgeProvider services={services}>
      <ToastViewport />
      <Harness session={session} documentId={created.value.id} />
    </ForgeProvider>,
  );
  await screen.findByRole('button', { name: /Export frames/ });
  return { session, documentId: created.value.id };
}

function payloadOf(session: DocumentSession): MotionPayload {
  const payload = session.getState().document.studioPayload;
  if (!payload || payload.kind !== 'motion') throw new Error('expected a motion payload');
  return payload;
}

describe('Motion Studio', () => {
  let services: TestForgeServices;

  beforeEach(() => {
    services = createTestServices();
    vi.mocked(downloadBytes).mockClear();
  });

  it('is selected by document type, not by studio name', () => {
    expect(isMotionDocument('motion.scene')).toBe(true);
    expect(isMotionDocument('photo.image')).toBe(false);
  });

  it('explains an empty composition and adds a text layer as one history entry', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);
    expect(screen.getByText(/This composition is empty/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Text' }));
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });
    expect(session.getState().history.at(-1)?.label).toBe('Add text layer');
    const layers = screen.getByRole('list', { name: 'Composition layers' });
    expect(within(layers).getByRole('button', { name: /Text/ })).toBeInTheDocument();
  });

  it('adds a keyframe at the playhead and shows it on the timeline', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);
    await user.click(screen.getByRole('button', { name: 'Text' }));
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });

    const value = screen.getByLabelText('Keyframe value');
    await user.clear(value);
    await user.type(value, '40');
    await user.click(screen.getByRole('button', { name: /Add keyframe at/ }));

    await waitFor(() => {
      expect(payloadOf(session).tracks).toHaveLength(1);
    });
    const track = payloadOf(session).tracks[0];
    expect(track?.property).toBe('x');
    expect(track?.keyframes[0]?.value).toBe(40);
    expect(session.getState().history.at(-1)?.label).toBe('Add x position keyframe');
    expect(
      screen.getByRole('button', { name: /X position keyframe at 0\.00 seconds/ }),
    ).toBeInTheDocument();
  });

  it('moves a keyframe with the keyboard and refuses nothing silently', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);
    await user.click(screen.getByRole('button', { name: 'Text' }));
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: /Add keyframe at/ }));
    await waitFor(() => {
      expect(payloadOf(session).tracks).toHaveLength(1);
    });

    const keyframe = await screen.findByRole('button', {
      name: /X position keyframe at 0\.00 seconds/,
    });
    keyframe.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      // Times are stored to the millisecond, so one frame at 30 fps is 0.033 s.
      expect(payloadOf(session).tracks[0]?.keyframes[0]?.time).toBeCloseTo(0.033, 3);
    });
    expect(session.getState().history.at(-1)?.label).toBe('Move keyframe');
  });

  it('changes easing to a preset and stores it on the segment', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);
    await user.click(screen.getByRole('button', { name: 'Text' }));
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: /Add keyframe at/ }));
    await waitFor(() => {
      expect(payloadOf(session).tracks).toHaveLength(1);
    });

    // The panel shows the easing editor for the selected keyframe; select it from the list first.
    await user.click(screen.getByRole('button', { name: /Select keyframe at 0\.00 seconds/ }));
    await user.selectOptions(screen.getByLabelText('Preset'), 'hold');
    await waitFor(() => {
      expect(payloadOf(session).tracks[0]?.keyframes[0]?.easing).toEqual({ kind: 'hold' });
    });
    expect(session.getState().history.at(-1)?.label).toBe('Set keyframe easing');
  });

  it('deletes a layer and its animation in one undoable step', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);
    await user.click(screen.getByRole('button', { name: 'Rectangle' }));
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: /Add keyframe at/ }));
    await waitFor(() => {
      expect(payloadOf(session).tracks).toHaveLength(1);
    });

    await user.click(screen.getByRole('button', { name: 'Delete the selected layer' }));
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(0);
    });
    expect(payloadOf(session).tracks).toEqual([]);
    // One step, not two: undoing it restores the layer and its keyframes together.
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });
    expect(payloadOf(session).tracks).toHaveLength(1);
  });

  it('plans and exports a frame sequence, then reports what was produced', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);
    await user.click(screen.getByRole('button', { name: 'Text' }));
    await waitFor(() => {
      expect(session.getState().document.scene.layers).toHaveLength(1);
    });

    const end = screen.getByLabelText('Export end');
    await user.clear(end);
    await user.type(end, '0.1');
    await user.click(screen.getByRole('button', { name: 'Check range' }));
    expect(await screen.findByTestId('motion-export-plan')).toHaveTextContent(/3 frames/);

    await user.click(screen.getByRole('button', { name: /Export frames/ }));
    await waitFor(() => {
      expect(screen.getByTestId('motion-export-report')).toBeInTheDocument();
    });
    expect(vi.mocked(downloadBytes)).toHaveBeenCalledTimes(1);
    const [bytes, name, mime] = vi.mocked(downloadBytes).mock.calls[0] ?? [];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(name).toBe('launch-title-frames.zip');
    expect(mime).toBe('application/zip');
    expect(screen.getByTestId('motion-export-report')).toHaveTextContent(/3 frames at 1080 × 1080/);
  });

  it('refuses an empty export range before rendering', async () => {
    const user = userEvent.setup();
    await mount(services);
    const end = screen.getByLabelText('Export end');
    await user.clear(end);
    await user.type(end, '0');
    await user.click(screen.getByRole('button', { name: 'Check range' }));
    expect(await screen.findByText(/The export range is empty/)).toBeInTheDocument();
    expect(vi.mocked(downloadBytes)).not.toHaveBeenCalled();
  });

  it('toggles playback and steps one frame at a time', async () => {
    const user = userEvent.setup();
    await mount(services);
    expect(screen.getByTestId('motion-time')).toHaveTextContent(/frame 0/);

    await user.click(screen.getByRole('button', { name: 'Next frame' }));
    expect(screen.getByTestId('motion-time')).toHaveTextContent(/frame 1/);

    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });
});
