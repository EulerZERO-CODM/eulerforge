import { describe, expect, it } from 'vitest';

import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../documents/factories';
import { defaultVideoPayload, type VideoPayload } from '../documents/payload';
import type { ForgeDocument } from '../documents/types';
import { brand } from '../types/brand';
import {
  MAX_VIDEO_CAPTURE_SECONDS,
  MAX_VIDEO_EXPORT_FRAMES,
  buildVideoManifest,
  planVideoCapture,
  planVideoExport,
  videoArchiveName,
  videoCaptureFileName,
  videoExportSlug,
  videoFrameFileName,
  videoFrameTimes,
} from './export';

const MEDIA = {
  id: 'media-a',
  name: 'clip.mp4',
  kind: 'video' as const,
  mimeType: 'video/mp4',
  duration: 8,
  width: 1920,
  height: 1080,
  size: 1000,
};

function videoDocument(width = 1920, height = 1080): ForgeDocument {
  const created = createDocument(
    {
      title: 'Launch Film',
      studioId: 'video',
      documentTypeId: brand<'DocumentTypeId'>('video.timeline'),
      canvas: { ...DEFAULT_CANVAS, width, height },
      guides: DEFAULT_GUIDES,
    },
    { generateId: () => 'doc-video' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function payloadWithClip(options: { start?: number; duration?: number } = {}): VideoPayload {
  const base = defaultVideoPayload();
  return {
    ...base,
    media: [MEDIA],
    tracks: base.tracks.map((track) =>
      track.kind === 'video'
        ? {
            ...track,
            clips: [
              {
                id: 'clip-1',
                kind: 'video' as const,
                mediaId: MEDIA.id,
                name: MEDIA.name,
                start: options.start ?? 0,
                duration: options.duration ?? 4,
                inPoint: 0,
                volume: 1,
                muted: false,
              },
            ],
          }
        : track,
    ),
  };
}

describe('videoFrameTimes', () => {
  it('treats the end as exclusive and rounds to microseconds', () => {
    const payload = payloadWithClip();
    const times = videoFrameTimes({ ...payload, fps: 30, duration: 2 }, 0, 1);
    expect(times).toHaveLength(30);
    expect(times[0]).toBe(0);
    expect(times[29]).toBeCloseTo(0.966_667, 5);
    // The frame at exactly 1 s belongs to the next second and is not exported twice.
    expect(times).not.toContain(1);
  });

  it('honours a frame step without changing the frame rate', () => {
    const payload = { ...payloadWithClip(), fps: 10, duration: 4 };
    const times = videoFrameTimes(payload, 0, 2, 2);
    expect(times).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8]);
  });

  it('returns nothing for an empty or inverted range, and clamps to the composition', () => {
    const payload = { ...payloadWithClip(), fps: 10, duration: 4 };
    expect(videoFrameTimes(payload, 2, 2)).toEqual([]);
    expect(videoFrameTimes(payload, 3, 1)).toEqual([]);
    const clamped = videoFrameTimes(payload, 3, 99);
    expect(clamped[0]).toBe(3);
    expect(clamped.at(-1)).toBeLessThan(4);
  });
});

describe('planVideoExport', () => {
  it('plans exact frames and the scaled output size', () => {
    const document = videoDocument();
    const plan = planVideoExport({
      document,
      payload: { ...payloadWithClip({ duration: 2 }), duration: 2, fps: 30 },
      scale: 0.5,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.frameCount).toBe(60);
    expect(plan.value.width).toBe(960);
    expect(plan.value.height).toBe(540);
    expect(plan.value.scale).toBe(0.5);
  });

  it('refuses an empty range, a runaway range and a bad scale', () => {
    const document = videoDocument();
    const payload = payloadWithClip({ duration: 4 });

    const empty = planVideoExport({ document, payload, from: 2, to: 2 });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.message).toMatch(/empty/);

    const runaway = planVideoExport({
      document,
      payload: { ...payload, duration: 120, fps: 60 },
      from: 0,
      to: 120,
      frameStep: 1,
    });
    expect(runaway.ok).toBe(false);
    if (!runaway.ok) expect(runaway.error.message).toContain(String(MAX_VIDEO_EXPORT_FRAMES));

    const scale = planVideoExport({ document, payload, scale: 0 });
    expect(scale.ok).toBe(false);
    if (!scale.ok) expect(scale.error.message).toMatch(/scale/);
  });

  it('refuses an export with missing media or nothing to render', () => {
    const document = videoDocument();

    const empty = planVideoExport({ document, payload: defaultVideoPayload() });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.message).toMatch(/nothing to render/);

    const base = payloadWithClip();
    const orphan: VideoPayload = {
      ...base,
      media: [],
      tracks: base.tracks.map((track) => ({ ...track, clips: track.clips })),
    };
    const missing = planVideoExport({ document, payload: orphan });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.message).toMatch(/no longer in this browser/);
      expect(missing.error.detail).toMatch(/Re-import/);
    }
  });

  it('refuses to export a cut-off ending', () => {
    const document = videoDocument();
    const payload = { ...payloadWithClip({ start: 8, duration: 4 }), duration: 10 };
    const plan = planVideoExport({ document, payload });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error.message).toMatch(/Lengthen the composition/);
  });
});

describe('names and manifest', () => {
  it('names frames so a listing sorts in playback order', () => {
    expect(videoFrameFileName(0, 3)).toBe('frames/frame-0001.png');
    expect(videoFrameFileName(2, 3)).toBe('frames/frame-0003.png');
    expect(videoFrameFileName(9, 12_000)).toBe('frames/frame-00010.png');
    expect(videoArchiveName('Launch Film')).toBe('launch-film-video-frames.zip');
    expect(videoExportSlug('   ')).toBe('video');
    expect(videoCaptureFileName('Launch Film')).toBe('launch-film-capture.webm');
  });

  it('writes a manifest that records every frame and every media file', () => {
    const document = videoDocument();
    const payload = payloadWithClip({ duration: 2 });
    const plan = planVideoExport({ document, payload });
    if (!plan.ok) throw new Error(plan.error.message);

    const manifest = JSON.parse(
      buildVideoManifest({
        document,
        payload,
        plan: plan.value,
        createdAt: '2026-10-18T00:00:00.000Z',
      }),
    ) as {
      format: string;
      frameCount: number;
      frames: string[];
      times: number[];
      width: number;
      height: number;
      media: { name: string }[];
      note: string;
    };

    expect(manifest.format).toBe('eulerforge-video-frames/1');
    expect(manifest.frameCount).toBe(plan.value.frameCount);
    expect(manifest.frames).toHaveLength(manifest.frameCount);
    expect(manifest.frames[0]).toBe('frames/frame-0001.png');
    expect(manifest.times[0]).toBe(0);
    expect(manifest.width).toBe(1920);
    expect(manifest.media.map((media) => media.name)).toEqual(['clip.mp4']);
    expect(manifest.note).toMatch(/not a video file/);
  });

  it('records title text in the manifest, with its own timing', () => {
    const document = videoDocument();
    const payload: VideoPayload = {
      ...payloadWithClip({ duration: 2 }),
      tracks: [
        ...payloadWithClip({ duration: 2 }).tracks,
        {
          id: 'track-title-1',
          kind: 'title',
          name: 'Titles',
          clips: [
            {
              id: 'title-1',
              kind: 'title',
              text: 'Launch day',
              start: 0.5,
              duration: 1.5,
              color: '#ffffff',
              background: 'transparent',
              fontSize: 72,
              position: 'lower',
            },
          ],
        },
      ],
    };
    const plan = planVideoExport({ document, payload });
    if (!plan.ok) throw new Error(plan.error.message);
    const manifest = JSON.parse(
      buildVideoManifest({
        document,
        payload,
        plan: plan.value,
        createdAt: '2026-10-18T00:00:00.000Z',
      }),
    ) as {
      titles: { text: string; start: number; duration: number; position: string }[];
    };
    expect(manifest.titles).toEqual([
      expect.objectContaining({ text: 'Launch day', start: 0.5, duration: 1.5, position: 'lower' }),
    ]);
  });
});

describe('planVideoCapture', () => {
  it('plans a bounded real-time capture and says why a long one is refused', () => {
    const document = videoDocument();
    const payload = payloadWithClip({ duration: 4 });
    const plan = planVideoCapture({ document, payload, from: 1, to: 3 });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.duration).toBe(2);
      expect(plan.value.width).toBe(1920);
    }

    const long = planVideoCapture({
      document,
      payload: { ...payload, duration: 600 },
      from: 0,
      to: 600,
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error.message).toMatch(/real time/);

    if (!long.ok) {
      expect(long.error.detail).toContain(String(MAX_VIDEO_CAPTURE_SECONDS));
    }
  });
});
