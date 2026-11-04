/**
 * Video Studio's editing surface, driven the way a person drives it.
 *
 * Decoding and encoding are replaced at the browser boundary — jsdom has no decoder and no
 * `MediaRecorder`; those paths are covered by `e2e/video.spec.ts` in Chromium — while everything
 * above them is real: the document, the session, the commands, the history and the panels the user
 * presses. Assertions read the *persisted* payload, so a UI that looked right but wrote nothing
 * would fail.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoWorkspace, isVideoDocument } from './video-workspace';
import { ForgeProvider } from '../../state/forge-provider';
import { ToastViewport } from '../ui/toast-viewport';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { brand } from '../../core/types/brand';
import { DEFAULT_GUIDES } from '../../core/documents/factories';
import type { CreateDocumentInput } from '../../core/documents/types';
import {
  defaultVideoPayload,
  type VideoClip,
  type VideoPayload,
} from '../../core/documents/payload';
import type { DocumentSession } from '../../state/document-session';
import { useDocumentSession } from '../../state/hooks';
import { createMemoryMediaStore } from '../../core/video/media-store';
import type * as Engine from '../../lib/browser/video-engine';
import type * as ImportAdapter from '../../lib/browser/media-import';
import type * as DownloadAdapter from '../../lib/browser/download';
import { downloadBlob, downloadBytes } from '../../lib/browser/download';

const PROBED = {
  kind: 'video' as const,
  name: 'clip.mp4',
  mimeType: 'video/mp4',
  duration: 4,
  width: 640,
  height: 360,
  size: 4096,
};

const mediaStore = createMemoryMediaStore();

vi.mock('../../lib/browser/media-store', () => ({
  openMediaStore: async () => ({ store: mediaStore, notice: null }),
  createIndexedDbMediaStore: async () => ({ ok: false as const, error: { message: 'no' } }),
}));

vi.mock('../../lib/browser/media-import', async (importOriginal) => {
  const actual = await importOriginal<typeof ImportAdapter>();
  const { ok } = await import('../../core/result');
  return { ...actual, probeMediaFile: vi.fn(async () => ok(PROBED)) };
});

vi.mock('../../lib/browser/download', async (importOriginal) => {
  const actual = await importOriginal<typeof DownloadAdapter>();
  return {
    ...actual,
    downloadBytes: vi.fn(() => true),
    downloadBlob: vi.fn(() => true),
  };
});

/**
 * The decoder pool and the two exporters.
 *
 * The pool is a stub because a jsdom `<video>` has no decoder; it reports "ready" so the stage's
 * synchronous paint path is exercised. `paintVideoFrame` is replaced because jsdom cannot paint, and
 * the exporters are replaced because they need a canvas and a recorder.
 */
vi.mock('../../lib/browser/video-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof Engine>();
  return {
    ...actual,
    paintVideoFrame: vi.fn(),
    pickCaptureMimeType: vi.fn(() => 'video/webm;codecs=vp8,opus'),
    VideoMediaPool: class {
      peek() {
        return null;
      }
      ensure() {
        return Promise.resolve({ ok: true as const, value: null });
      }
      seek() {
        return Promise.resolve(true);
      }
      bufferedAhead() {
        return 0;
      }
      playAll() {}
      pauseAll() {}
      dispose() {}
    },
    exportVideoFrames: vi.fn(async () => ({
      status: 'exported' as const,
      zip: new Uint8Array([80, 75, 3, 4, 9, 9]),
      frames: 2,
      width: 1080,
      height: 1080,
      fileName: 'launch-film-video-frames.zip',
      skipped: [],
    })),
    captureTimeline: vi.fn(async () => ({
      status: 'captured' as const,
      blob: new Blob([new Uint8Array([26, 69, 223, 163])]),
      mimeType: 'video/webm;codecs=vp8,opus',
      extension: 'webm',
      bytes: 4,
      durationSeconds: 1,
      audioIncluded: true,
      fileName: 'launch-film-capture.webm',
    })),
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/doc-video',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function videoDocument(payload: VideoPayload): CreateDocumentInput {
  return {
    title: 'Launch film',
    studioId: 'video',
    documentTypeId: brand<'DocumentTypeId'>('video.timeline'),
    canvas: {
      width: 1080,
      height: 1080,
      unit: 'px',
      dpi: 96,
      background: '#000000',
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
    <VideoWorkspace
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
      payload={state.document.studioPayload as VideoPayload}
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

async function mount(services: TestForgeServices, payload: VideoPayload = defaultVideoPayload()) {
  await services.documents.load();
  const created = await services.documents.create(videoDocument(payload));
  if (!created.ok) throw new Error(created.error.message);
  const session = services.documents.session(created.value.id);
  if (!session) throw new Error('the session should open');
  render(
    <ForgeProvider services={services}>
      <ToastViewport />
      <Harness session={session} documentId={created.value.id} />
    </ForgeProvider>,
  );
  await screen.findByRole('heading', { name: 'Timeline' });
  return { session, documentId: created.value.id };
}

function payloadOf(session: DocumentSession): VideoPayload {
  const payload = session.getState().document.studioPayload;
  if (!payload || payload.kind !== 'video') throw new Error('expected a video payload');
  return payload;
}

function allClips(session: DocumentSession): readonly VideoClip[] {
  return payloadOf(session)
    .tracks.flatMap((track) => track.clips)
    .filter((clip): clip is VideoClip => clip.kind === 'video' || clip.kind === 'audio');
}

describe('Video Studio workspace', () => {
  let services: TestForgeServices;

  beforeEach(async () => {
    services = createTestServices({ generateId: () => `id-${String(Math.random()).slice(2, 8)}` });
  });

  it('identifies its own document type and starts with an empty, honest timeline', async () => {
    expect(isVideoDocument('video.timeline')).toBe(true);
    expect(isVideoDocument('motion.scene')).toBe(false);

    await mount(services);

    expect(screen.getByTestId('video-time')).toHaveTextContent('0.00s');
    expect(screen.getByRole('button', { name: 'Export frames' })).toBeDisabled();
    expect(screen.getByText(/This timeline cannot be exported yet/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is on screen at 0.00 s/)).toBeInTheDocument();
  });

  it('imports a real file into the bin and places it on the timeline', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    const input = screen.getByLabelText('Import video or audio files');
    await user.upload(
      input,
      new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' }),
    );

    await waitFor(() => {
      expect(payloadOf(session).media).toHaveLength(1);
    });
    expect(screen.getByTestId('video-import-report')).toHaveTextContent(/Imported “clip.mp4”/);
    expect(await screen.findByText('clip.mp4')).toBeInTheDocument();
    expect(mediaStore.kind).toBe('memory');

    await user.click(screen.getByRole('button', { name: 'Place clip.mp4 at the playhead' }));

    await waitFor(() => {
      expect(allClips(session)).toHaveLength(1);
    });
    const clip = allClips(session)[0];
    expect(clip?.start).toBe(0);
    expect(clip?.duration).toBeCloseTo(4, 6);
    expect(screen.getByRole('button', { name: 'clip.mp4 at 0.00 seconds' })).toBeInTheDocument();
    expect(session.getState().history.at(-1)?.label).toBe('Add “clip.mp4” at 0.00 s');
    // The stage no longer says the frame is empty, because a clip is on screen.
    expect(screen.queryByText(/Nothing is on screen/)).not.toBeInTheDocument();
  });

  it('plays, pauses and steps the transport one frame at a time', async () => {
    const user = userEvent.setup();
    await mount(services);

    await user.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('video-time')).not.toHaveTextContent('0.00s');
    });
    await user.click(screen.getByRole('button', { name: 'Pause' }));

    await user.click(screen.getByRole('button', { name: 'Go to start' }));
    expect(screen.getByTestId('video-time')).toHaveTextContent('0.00s');

    await user.click(screen.getByRole('button', { name: 'Step forward one frame' }));
    expect(screen.getByTestId('video-time')).toHaveTextContent('0.03s');
    await user.click(screen.getByRole('button', { name: 'Step back one frame' }));
    expect(screen.getByTestId('video-time')).toHaveTextContent('0.00s');
  });

  it('adds a title, undoes it as one step, and redoes it', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    await user.type(screen.getByLabelText('Title text'), 'Launch day');
    await user.click(screen.getByRole('button', { name: 'Add title' }));

    await waitFor(() => {
      expect(
        payloadOf(session).tracks.some((track) =>
          track.clips.some((clip) => clip.kind === 'title'),
        ),
      ).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Launch day at 0.00 seconds' })).toBeInTheDocument();
    expect(session.getState().history.at(-1)?.label).toBe('Add title “Launch day” at 0.00 s');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(
        payloadOf(session).tracks.some((track) =>
          track.clips.some((clip) => clip.kind === 'title'),
        ),
      ).toBe(false);
    });
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => {
      expect(
        payloadOf(session).tracks.some((track) =>
          track.clips.some((clip) => clip.kind === 'title'),
        ),
      ).toBe(true);
    });
  });

  it('plans a range, exports frames through the real command path, and reports the file', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    const input = screen.getByLabelText('Import video or audio files');
    await user.upload(input, new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' }));
    await waitFor(() => {
      expect(payloadOf(session).media).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: 'Place clip.mp4 at the playhead' }));
    await waitFor(() => {
      expect(allClips(session)).toHaveLength(1);
    });

    await user.clear(screen.getByLabelText('Export end'));
    await user.type(screen.getByLabelText('Export end'), '1');
    await user.click(screen.getByRole('button', { name: 'Check range' }));

    expect(await screen.findByTestId('video-export-plan')).toHaveTextContent(
      /30 frames at 1080 × 1080, 30 fps/,
    );

    await user.click(screen.getByRole('button', { name: 'Export frames' }));

    await waitFor(() => {
      expect(downloadBytes).toHaveBeenCalledWith(
        new Uint8Array([80, 75, 3, 4, 9, 9]),
        'launch-film-video-frames.zip',
        'application/zip',
      );
    });
    expect(await screen.findByTestId('video-export-report')).toHaveTextContent(
      'launch-film-video-frames.zip · 2 frames at 1080 × 1080',
    );
  });

  it('records a real-time take and names the container it got', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    await user.upload(
      screen.getByLabelText('Import video or audio files'),
      new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' }),
    );
    await waitFor(() => {
      expect(payloadOf(session).media).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: 'Place clip.mp4 at the playhead' }));
    await waitFor(() => {
      expect(allClips(session)).toHaveLength(1);
    });

    await user.click(screen.getByRole('button', { name: 'Record WebM' }));

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalled();
    });
    expect(await screen.findByTestId('video-capture-report')).toHaveTextContent(
      /launch-film-capture.webm · 1.0 s · 4 B · video\/webm;codecs=vp8,opus/,
    );
    expect(screen.getByText(/Audio from the timeline was mixed/)).toBeInTheDocument();
  });

  it('refuses an empty export range with a sentence, not a silent no-op', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    await user.upload(
      screen.getByLabelText('Import video or audio files'),
      new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' }),
    );
    await waitFor(() => {
      expect(payloadOf(session).media).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: 'Place clip.mp4 at the playhead' }));
    await waitFor(() => {
      expect(allClips(session)).toHaveLength(1);
    });

    await user.clear(screen.getByLabelText('Export end'));
    await user.type(screen.getByLabelText('Export end'), '0');
    await user.click(screen.getByRole('button', { name: 'Check range' }));

    expect(await screen.findByText(/The export range is empty/)).toBeInTheDocument();
    expect(screen.queryByTestId('video-export-plan')).not.toBeInTheDocument();
    expect(downloadBytes).not.toHaveBeenCalled();
  });

  it('removes a clip from the timeline with the Delete key, and undoes it', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    await user.upload(
      screen.getByLabelText('Import video or audio files'),
      new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' }),
    );
    await waitFor(() => {
      expect(payloadOf(session).media).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: 'Place clip.mp4 at the playhead' }));
    await waitFor(() => {
      expect(allClips(session)).toHaveLength(1);
    });

    await user.click(screen.getByRole('button', { name: 'clip.mp4 at 0.00 seconds' }));
    await user.keyboard('{Delete}');
    await waitFor(() => {
      expect(allClips(session)).toHaveLength(0);
    });

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(allClips(session)).toHaveLength(1);
    });
  });

  it('shows the media bin usage and refuses to forget a file a clip still uses', async () => {
    const user = userEvent.setup();
    const { session } = await mount(services);

    await user.upload(
      screen.getByLabelText('Import video or audio files'),
      new File([new Uint8Array([1, 2])], 'clip.mp4', { type: 'video/mp4' }),
    );
    await waitFor(() => {
      expect(payloadOf(session).media).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: 'Place clip.mp4 at the playhead' }));
    await waitFor(() => {
      expect(allClips(session)).toHaveLength(1);
    });

    const bin = screen.getByRole('list', { name: 'Imported media' });
    await user.click(
      within(bin).getByRole('button', { name: 'Remove clip.mp4 from the media bin' }),
    );

    expect(await screen.findByText(/still used by 1 clip/)).toBeInTheDocument();
    expect(payloadOf(session).media).toHaveLength(1);
  });

  it('names a clip whose file is gone instead of drawing a hole or exporting it', async () => {
    const base = defaultVideoPayload();
    // A document that travelled from another machine: the clip is there, the bytes are not.
    const payload: VideoPayload = {
      ...base,
      tracks: [
        {
          id: 'track-video-1',
          kind: 'video',
          name: 'Video',
          clips: [
            {
              id: 'clip-1',
              kind: 'video',
              mediaId: 'missing-media',
              name: 'lost.webm',
              start: 0,
              duration: 2,
              inPoint: 0,
              volume: 1,
              muted: false,
            },
          ],
        },
        ...base.tracks.filter((track) => track.kind !== 'video'),
      ],
    };

    await mount(services, payload);

    expect(screen.getByText('A clip has no file')).toBeInTheDocument();
    expect(screen.getByText(/reference media that is not in this browser/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export frames' })).toBeDisabled();

    // Asking for a plan names the same problem and refuses, rather than exporting black frames.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check range' }));
    // The message appears both as the summary and inside the expanded detail; either is enough.
    expect(
      (await screen.findAllByText(/1 clip references media that is no longer in this browser/))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/“lost\.webm”/).length).toBeGreaterThan(0);
  });

  it('offers a refusal-only assistant surface, naming the missing tool and the alternatives', async () => {
    await mount(services);
    expect(screen.getByTestId('assistant-unavailable')).toHaveTextContent(
      /cannot edit Video Studio/i,
    );
    expect(screen.getByTestId('assistant-unavailable-tools')).toHaveTextContent('video.trim');
    expect(screen.queryByTestId('assistant-request')).toBeNull();
  });
});
