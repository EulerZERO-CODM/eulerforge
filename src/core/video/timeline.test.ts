import { describe, expect, it } from 'vitest';

import {
  clipAt,
  clipEnd,
  contentEnd,
  fitRect,
  mediaForClip,
  missingMedia,
  sourceTimeFor,
  timelineIssues,
  titleAnchorY,
  titleClipsAt,
  videoClipsAt,
  type TimelineClip,
} from './timeline';
import { defaultVideoPayload, type VideoClip, type VideoPayload } from '../documents/payload';

const MEDIA = {
  id: 'media-a',
  name: 'clip.mp4',
  kind: 'video' as const,
  mimeType: 'video/mp4',
  duration: 8,
  width: 16,
  height: 9,
  size: 1000,
};

function clip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 'clip-1',
    kind: 'video',
    mediaId: MEDIA.id,
    name: 'clip.mp4',
    start: 1,
    duration: 3,
    inPoint: 2,
    volume: 1,
    muted: false,
    ...overrides,
  };
}

function withClip(clipValue: TimelineClip): VideoPayload {
  const base = defaultVideoPayload();
  return {
    ...base,
    media: [MEDIA],
    tracks: base.tracks.map((track) =>
      track.kind === 'video' ? { ...track, clips: [clipValue] } : track,
    ),
  };
}

describe('timeline windows', () => {
  it('treats a clip as a half-open window', () => {
    const track = { id: 't', kind: 'video' as const, name: 'Video', clips: [clip()] };
    expect(clipAt(track, 0.999)).toBeNull();
    expect(clipAt(track, 1)?.id).toBe('clip-1');
    expect(clipAt(track, 3.999)?.id).toBe('clip-1');
    // The end is exclusive: two clips that touch do not both claim the boundary.
    expect(clipAt(track, 4)).toBeNull();
  });

  it('reports what is playing without inventing clips', () => {
    const payload = withClip(clip());
    const atTwo = videoClipsAt(payload, 2);
    expect(atTwo).toHaveLength(1);
    expect(atTwo[0]?.[1].id).toBe('clip-1');
    expect(videoClipsAt(payload, 0)).toHaveLength(0);
  });

  it('computes the source time from the clip start and in-point', () => {
    expect(sourceTimeFor(clip(), 1)).toBeCloseTo(2, 6);
    expect(sourceTimeFor(clip(), 2.5)).toBeCloseTo(3.5, 6);
    // Before the clip it clamps to the in-point rather than extrapolating backwards.
    expect(sourceTimeFor(clip(), 0)).toBeCloseTo(2, 6);
  });

  it('finds the media record and reports a missing one', () => {
    const payload = withClip(clip({ mediaId: 'media-gone' }));
    expect(mediaForClip(payload, payload.tracks[0]?.clips[0] as VideoClip)).toBeUndefined();
    expect(missingMedia(payload)).toHaveLength(1);
    expect(timelineIssues(payload).join(' ')).toMatch(/no longer in this browser/);
  });
});

describe('composition arithmetic', () => {
  it('finds the content end and ignores empty tracks', () => {
    const payload = withClip(clip({ start: 4, duration: 2 }));
    expect(contentEnd(payload)).toBeCloseTo(6, 6);
    expect(clipEnd(payload.tracks[0]?.clips[0] as VideoClip)).toBeCloseTo(6, 6);
    expect(contentEnd(defaultVideoPayload())).toBe(0);
  });

  it('warns when a clip runs past the composition and when the timeline is empty', () => {
    const payload = withClip(clip({ start: 9, duration: 3 }));
    const issues = timelineIssues(payload).join(' ');
    expect(issues).toMatch(/but the composition is 10\.00 s long/);
    expect(timelineIssues(defaultVideoPayload()).join(' ')).toMatch(/timeline is empty/);
  });
});

describe('titles and geometry', () => {
  it('anchors titles at three vertical positions, in order', () => {
    expect(titleAnchorY('top')).toBeLessThan(titleAnchorY('center'));
    expect(titleAnchorY('center')).toBeLessThan(titleAnchorY('lower'));
  });

  it('returns titles that are on screen at a time', () => {
    const base = defaultVideoPayload();
    const payload: VideoPayload = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.kind === 'title'
          ? {
              ...track,
              clips: [
                {
                  id: 'title-1',
                  kind: 'title' as const,
                  text: 'Hello',
                  start: 2,
                  duration: 2,
                  color: '#ffffff',
                  background: null,
                  fontSize: 64,
                  position: 'lower' as const,
                },
              ],
            }
          : track,
      ),
    };
    expect(titleClipsAt(payload, 1.9)).toHaveLength(0);
    expect(titleClipsAt(payload, 2.5)[0]?.[1].text).toBe('Hello');
  });

  it('letterboxes instead of stretching', () => {
    // 16:9 into 9:16: full width, centred vertically.
    const box = fitRect({ width: 16, height: 9 }, { width: 9, height: 16 });
    expect(box.width).toBeCloseTo(9, 6);
    expect(box.height).toBeCloseTo(9 * (9 / 16), 6);
    expect(box.x).toBeCloseTo(0, 6);
    expect(box.y).toBeCloseTo((16 - 9 * (9 / 16)) / 2, 6);

    // The same aspect ratio fills the frame exactly.
    const same = fitRect({ width: 100, height: 50 }, { width: 200, height: 100 });
    expect(same).toEqual({ x: 0, y: 0, width: 200, height: 100 });

    // A degenerate source is not a division by zero.
    expect(fitRect({ width: 0, height: 0 }, { width: 10, height: 5 })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 5,
    });
  });
});
