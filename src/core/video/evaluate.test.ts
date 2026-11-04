import { describe, expect, it } from 'vitest';

import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../documents/factories';
import type { VideoPayload } from '../documents/payload';
import type { ForgeDocument } from '../documents/types';
import { brand } from '../types/brand';
import { clipBoundaries, evaluateVideoAt } from './evaluate';

const MEDIA = {
  id: 'media-wide',
  name: 'wide.mp4',
  kind: 'video' as const,
  mimeType: 'video/mp4',
  duration: 8,
  width: 1600,
  height: 900,
  size: 1000,
};

const MUSIC = {
  id: 'media-music',
  name: 'music.mp3',
  kind: 'audio' as const,
  mimeType: 'audio/mpeg',
  duration: 30,
  width: 0,
  height: 0,
  size: 500,
};

function videoDocument(): ForgeDocument {
  const created = createDocument(
    {
      title: 'Evaluation',
      studioId: 'video',
      documentTypeId: brand<'DocumentTypeId'>('video.timeline'),
      canvas: { ...DEFAULT_CANVAS, width: 1080, height: 1080 },
      guides: DEFAULT_GUIDES,
    },
    { generateId: () => 'doc-video' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function payload(): VideoPayload {
  return {
    kind: 'video',
    version: 1,
    duration: 10,
    fps: 30,
    media: [MEDIA, MUSIC],
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        name: 'Video 1',
        clips: [
          {
            id: 'clip-1',
            kind: 'video',
            mediaId: MEDIA.id,
            name: MEDIA.name,
            start: 2,
            duration: 4,
            inPoint: 1.5,
            volume: 0.5,
            muted: false,
          },
          {
            id: 'clip-2',
            kind: 'video',
            mediaId: 'media-missing',
            name: 'gone.mp4',
            start: 6,
            duration: 2,
            inPoint: 0,
            volume: 1,
            muted: false,
          },
        ],
      },
      {
        id: 't1',
        kind: 'title',
        name: 'Titles',
        clips: [
          {
            id: 'title-1',
            kind: 'title',
            text: 'Hello',
            start: 1,
            duration: 2,
            color: '#ffffff',
            background: null,
            fontSize: 64,
            position: 'center',
          },
        ],
      },
      {
        id: 'a1',
        kind: 'audio',
        name: 'Audio 1',
        clips: [
          {
            id: 'audio-1',
            kind: 'audio',
            mediaId: MUSIC.id,
            name: MUSIC.name,
            start: 0,
            duration: 6,
            inPoint: 0.5,
            volume: 0.2,
            muted: false,
          },
        ],
      },
    ],
  };
}

function document(): ForgeDocument {
  return { ...videoDocument(), studioPayload: payload() };
}

describe('evaluateVideoAt', () => {
  it('is a pure function of the document and the time', () => {
    const doc = document();
    const first = evaluateVideoAt(doc, 3);
    const second = evaluateVideoAt(doc, 3);
    expect(first.ok && second.ok).toBe(true);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('reports the source time, letterboxed box and gain of a playing clip', () => {
    const result = evaluateVideoAt(document(), 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.videos).toHaveLength(1);
    const [video] = result.value.videos;
    expect(video?.clip.id).toBe('clip-1');
    // 3 s on the timeline is 1 s into a clip that starts at source 1.5 s.
    expect(video?.sourceTime).toBeCloseTo(2.5, 6);
    expect(video?.volume).toBe(0.5);
    // 16:9 into a square frame: full width, bars above and below.
    expect(video?.box.width).toBeCloseTo(1080, 6);
    expect(video?.box.height).toBeCloseTo(1080 * (900 / 1600), 6);
    expect(video?.box.y).toBeGreaterThan(0);
  });

  it('shows a clip only inside its own window', () => {
    const before = evaluateVideoAt(document(), 1.99);
    const atStart = evaluateVideoAt(document(), 2);
    const atEnd = evaluateVideoAt(document(), 6);
    expect(before.ok && before.value.videos).toHaveLength(0);
    expect(atStart.ok && atStart.value.videos).toHaveLength(1);
    // At 6 s the first clip has ended, and the second references media that is gone: no video.
    expect(atEnd.ok && atEnd.value.videos).toHaveLength(0);
  });

  it('never invents footage for a clip whose media is missing', () => {
    const result = evaluateVideoAt(document(), 6.5);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.videos).toHaveLength(0);
    expect(result.value.mediaIds).not.toContain('media-missing');
  });

  it('carries titles with a progress value', () => {
    const result = evaluateVideoAt(document(), 1.5);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.titles).toHaveLength(1);
    expect(result.value.titles[0]?.clip.text).toBe('Hello');
    expect(result.value.titles[0]?.progress).toBeCloseTo(0.25, 6);
  });

  it('includes an audio clip with its own source time and gain', () => {
    const result = evaluateVideoAt(document(), 2);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.audio).toHaveLength(1);
    expect(result.value.audio[0]?.sourceTime).toBeCloseTo(2.5, 6);
    expect(result.value.audio[0]?.volume).toBeCloseTo(0.2, 6);
  });

  it('clamps a time outside the composition instead of returning nothing', () => {
    const result = evaluateVideoAt(document(), 99);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.time).toBe(10);
  });

  it('refuses a document that is not a timeline', () => {
    const design = videoDocument();
    const result = evaluateVideoAt({ ...design, studioPayload: null }, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/not a video timeline/);
  });
});

describe('clipBoundaries', () => {
  it('lists every edit point once, in order', () => {
    expect(clipBoundaries(payload())).toEqual([0, 1, 2, 3, 6, 8]);
  });
});
