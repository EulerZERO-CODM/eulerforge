'use client';

import { FileAudio, FileVideo, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { VideoMedia, VideoPayload } from '../../core/documents/payload';
import {
  placeClipCommand,
  registerMediaCommand,
  removeMediaCommand,
} from '../../core/video/commands';
import { contentEnd, missingMedia } from '../../core/video/timeline';
import type { MediaStore, MediaUsage } from '../../core/video/media-store';
import { formatBytes, mediaRecordFor, probeMediaFile } from '../../lib/browser/media-import';
import { Button } from '../ui/button';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';

/**
 * The media bin.
 *
 * Importing is two steps on purpose: the browser decodes the file and reports its real duration and
 * picture size, the bytes go into the media store, and only then does the document get a metadata
 * record. If any step fails the timeline is untouched and the panel says what failed — a clip whose
 * file is missing is a hole, not a placeholder.
 */
export function MediaBin({
  api,
  payload,
  store,
  storeNotice,
  time,
}: {
  readonly api: WorkspaceApi;
  readonly payload: VideoPayload;
  readonly store: MediaStore | null;
  readonly storeNotice: string | null;
  readonly time: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [usage, setUsage] = useState<MediaUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!store) return;
    void store.usage().then((result) => {
      if (!cancelled && result.ok) setUsage(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [payload.media, store]);

  const missing = missingMedia(payload);
  const firstVideoTrack = payload.tracks.find((track) => track.kind === 'video');
  const firstAudioTrack = payload.tracks.find((track) => track.kind === 'audio');

  async function importFiles(files: readonly File[]): Promise<void> {
    if (!store || files.length === 0) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      for (const file of files) {
        const probed = await probeMediaFile(file);
        if (!probed.ok) {
          setError(
            probed.error.detail
              ? `${probed.error.message} ${probed.error.detail}`
              : probed.error.message,
          );
          continue;
        }
        const record = mediaRecordFor(probed.value);
        const stored = await store.put(
          {
            id: record.id,
            name: record.name,
            mimeType: record.mimeType,
            size: record.size,
            createdAt: new Date().toISOString(),
          },
          file,
        );
        if (!stored.ok) {
          setError(stored.error.detail ?? stored.error.message);
          continue;
        }
        const command = registerMediaCommand(api.doc, record);
        if (!command.ok) {
          setError(command.error.message);
          continue;
        }
        await api.run(command);
        setReport(
          `Imported “${record.name}” · ${record.duration.toFixed(2)} s · ${formatBytes(record.size)}.`,
        );
      }
    } finally {
      setBusy(false);
      await store.usage().then((result) => {
        if (result.ok) setUsage(result.value);
      });
    }
  }

  function place(media: VideoMedia): void {
    const track = media.kind === 'video' ? firstVideoTrack : firstAudioTrack;
    if (!track) {
      setError(`This timeline has no ${media.kind} track to place the clip on.`);
      return;
    }
    const start = Math.min(time, Math.max(0, payload.duration - 0.1));
    const command = placeClipCommand(api.doc, { trackId: track.id, media, start });
    if (!command.ok) {
      setError(command.error.message);
      return;
    }
    setError(null);
    void api.run(command);
  }

  return (
    <section aria-labelledby="media-bin-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="media-bin-heading" className="text-fg text-sm font-medium">
          Media
        </h2>
        <span className="text-fg-subtle text-2xs">
          {usage ? `${String(usage.count)} file(s) · ${formatBytes(usage.bytes)}` : '—'}
        </span>
      </div>

      <label className="block">
        <span className="text-fg-muted mb-1 block text-xs">Import video or audio files</span>
        <input
          type="file"
          multiple
          accept="video/*,audio/*"
          className="text-xs"
          disabled={busy || !store}
          aria-label="Import video or audio files"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            void importFiles(files);
          }}
        />
      </label>

      {storeNotice ? (
        <InlineNote tone="warning" title="Media will not survive a reload">
          {storeNotice} Imported files are kept in memory for this session only.
        </InlineNote>
      ) : null}
      {busy ? <p className="text-fg-subtle text-2xs">Decoding the file…</p> : null}
      {error ? (
        <InlineNote tone="warning" title="That import did not complete">
          {error}
        </InlineNote>
      ) : null}
      {report ? (
        <p data-testid="video-import-report" role="status" className="text-fg-muted text-2xs">
          {report}
        </p>
      ) : null}
      {missing.length > 0 ? (
        <InlineNote tone="warning" title="A clip has no file">
          {String(missing.length)} clip(s) reference media that is not in this browser. Re-import
          the file or remove the clip before exporting.
        </InlineNote>
      ) : null}

      {payload.media.length === 0 ? (
        <p className="text-fg-subtle text-2xs">
          No files yet. Import an MP4, WebM, MOV, MP3, WAV or M4A file; the browser decodes it here
          — nothing is uploaded.
        </p>
      ) : (
        <ul className="divide-ink-800 divide-y" aria-label="Imported media">
          {payload.media.map((media) => (
            <li key={media.id} className="flex items-center gap-2 py-2">
              {media.kind === 'video' ? (
                <FileVideo aria-hidden className="text-fg-subtle h-4 w-4 shrink-0" />
              ) : (
                <FileAudio aria-hidden className="text-fg-subtle h-4 w-4 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-fg truncate text-xs">{media.name}</p>
                <p className="text-fg-subtle text-2xs font-mono">
                  {media.duration.toFixed(2)}s
                  {media.kind === 'video'
                    ? ` · ${String(media.width)}×${String(media.height)}`
                    : ''}{' '}
                  · {formatBytes(media.size)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Plus aria-hidden />}
                onClick={() => {
                  place(media);
                }}
                aria-label={`Place ${media.name} at the playhead`}
              >
                Place
              </Button>
              <Button
                variant="quiet"
                size="sm"
                aria-label={`Remove ${media.name} from the media bin`}
                iconLeft={<Trash2 aria-hidden />}
                onClick={() => {
                  const command = removeMediaCommand(api.doc, media.id);
                  if (!command.ok) {
                    setError(command.error.message);
                    return;
                  }
                  setError(null);
                  void api.run(command).then((applied) => {
                    if (applied) void store?.remove(media.id);
                  });
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="text-fg-subtle text-2xs">
        Timeline content ends at {contentEnd(payload).toFixed(2)} s of {payload.duration.toFixed(2)}{' '}
        s.
      </p>
    </section>
  );
}
