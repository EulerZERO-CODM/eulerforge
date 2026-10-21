'use client';

import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { VideoPayload } from '../../core/documents/payload';
import { removeClipCommand, splitClipCommand } from '../../core/video/commands';
import type { MediaStore } from '../../core/video/media-store';
import { openMediaStore } from '../../lib/browser/media-store';
import { VideoMediaPool } from '../../lib/browser/video-engine';
import { Button } from '../ui/button';
import { InlineNote } from '../ui/states';
import { AssistantUnavailable } from '../assistant/assistant-unavailable';
import { HistoryPanel } from '../workspace/history-panel';
import type { WorkspaceApi } from '../workspace/workspace-api';
import { ClipInspector } from './clip-inspector';
import { MediaBin } from './media-bin';
import { VideoExportPanel } from './video-export-panel';
import { VideoStage } from './video-stage';
import { VideoTimeline, type VideoSelection } from './video-timeline';
import { useVideoPlayback } from './use-video-playback';

/** True for the document type Video Studio owns. */
export function isVideoDocument(documentTypeId: string): boolean {
  return documentTypeId === 'video.timeline';
}

/**
 * The Video Studio workspace.
 *
 * Preview and transport on the left, timeline underneath, media/selection/export on the right. The
 * media store is opened once and shared by the decoder pool and the importer; when it falls back to
 * memory the panel says so, because "your files vanish on reload" changes how the editor should be
 * used.
 */
export function VideoWorkspace({
  api,
  payload,
  history,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  readonly api: WorkspaceApi;
  readonly payload: VideoPayload;
  readonly history: readonly { readonly id: number; readonly label: string }[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}) {
  const [store, setStore] = useState<MediaStore | null>(null);
  const [storeNotice, setStoreNotice] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [selection, setSelection] = useState<VideoSelection>(null);
  const playback = useVideoPlayback({ duration: payload.duration, fps: payload.fps });

  useEffect(() => {
    let cancelled = false;
    void openMediaStore().then((opened) => {
      if (cancelled) return;
      setStore(opened.store);
      setStoreNotice(opened.notice);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pool = useMemo(() => {
    if (!store) return null;
    return new VideoMediaPool((mediaId) => store.get(mediaId));
  }, [store]);

  useEffect(() => {
    return () => {
      pool?.dispose();
    };
  }, [pool]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;
      if (typing) return;

      if (event.code === 'Space') {
        event.preventDefault();
        playback.toggle();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        playback.step(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        playback.seek(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        playback.seek(payload.duration);
        return;
      }
      if (event.key === 's' || event.key === 'S') {
        if (!selection) return;
        event.preventDefault();
        const command = splitClipCommand(api.doc, selection.clipId, playback.time);
        if (!command.ok) setStoreError(command.error.message);
        else {
          setStoreError(null);
          void api.run(command);
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selection) return;
        event.preventDefault();
        const command = removeClipCommand(api.doc, selection.clipId);
        if (!command.ok) setStoreError(command.error.message);
        else {
          setStoreError(null);
          setSelection(null);
          void api.run(command);
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [api, payload.duration, playback, selection]);

  const activeClipId =
    selection &&
    payload.tracks.some((track) => track.clips.some((clip) => clip.id === selection.clipId))
      ? selection.clipId
      : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-5">
        {pool ? (
          <VideoStage
            document={api.doc}
            payload={payload}
            time={playback.time}
            playing={playback.playing}
            pool={pool}
            onTimeChange={(time) => {
              playback.seek(time);
            }}
          />
        ) : (
          <div
            data-testid="video-preview"
            className="border-ink-800 bg-ink-950 flex h-64 items-center justify-center rounded-lg border"
          >
            <p className="text-fg-subtle text-xs">Opening the media store…</p>
          </div>
        )}

        <Transport
          time={playback.time}
          duration={payload.duration}
          fps={payload.fps}
          playing={playback.playing}
          onToggle={playback.toggle}
          onSeek={playback.seek}
          onStep={playback.step}
        />

        <VideoTimeline
          api={api}
          payload={payload}
          time={playback.time}
          selection={activeClipId ? { clipId: activeClipId } : null}
          onSelect={setSelection}
          onSeek={playback.seek}
          onStep={playback.step}
        />

        <p className="text-fg-subtle text-2xs">
          Space plays and pauses · ← and → step one frame · Delete removes the selected clip · S
          splits it at the playhead.
        </p>
      </div>

      <aside className="space-y-5">
        {storeError ? (
          <InlineNote tone="warning" title="That edit was refused">
            {storeError}
          </InlineNote>
        ) : null}
        <MediaBin
          api={api}
          payload={payload}
          store={store}
          storeNotice={storeNotice}
          time={playback.time}
        />
        <ClipInspector
          api={api}
          payload={payload}
          selectedClipId={activeClipId}
          time={playback.time}
        />
        <VideoExportPanel doc={api.doc} payload={payload} store={store} />
        <AssistantUnavailable studio="video" />
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

function Transport({
  time,
  duration,
  fps,
  playing,
  onToggle,
  onSeek,
  onStep,
}: {
  readonly time: number;
  readonly duration: number;
  readonly fps: number;
  readonly playing: boolean;
  readonly onToggle: () => void;
  readonly onSeek: (time: number) => void;
  readonly onStep: (frames: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        iconLeft={playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        onClick={onToggle}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? 'Pause' : 'Play'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        iconLeft={<SkipBack aria-hidden />}
        onClick={() => {
          onSeek(0);
        }}
        aria-label="Go to start"
      />
      <Button
        variant="secondary"
        size="sm"
        iconLeft={<SkipForward aria-hidden />}
        onClick={() => {
          onSeek(duration);
        }}
        aria-label="Go to end"
      />
      <div className="flex items-center gap-1">
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            onStep(-1);
          }}
          aria-label="Step back one frame"
        >
          −1f
        </Button>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            onStep(1);
          }}
          aria-label="Step forward one frame"
        >
          +1f
        </Button>
      </div>
      <span className="text-fg-subtle forge-numeric ml-auto text-xs">
        {time.toFixed(2)} s / {duration.toFixed(2)} s · frame{' '}
        {Math.min(Math.round(time * fps), Math.round(duration * fps))}
      </span>
    </div>
  );
}
