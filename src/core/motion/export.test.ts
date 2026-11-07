/**
 * Frame export planning: the file list is decided before any pixels are rendered.
 *
 * These tests pin the frame grid (inclusive start, exclusive end), the step option, the caps, the
 * zero-padded names that make a zip sort in playback order, and the manifest that travels with the
 * frames so another tool can reassemble them without guessing.
 */

import { describe, expect, it } from 'vitest';

import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../documents/factories';
import type { MotionPayload } from '../documents/payload';
import type { ForgeDocument } from '../documents/types';
import { brand } from '../types/brand';
import {
  buildMotionManifest,
  MAX_MOTION_EXPORT_FRAMES,
  motionArchiveName,
  motionExportSlug,
  motionFrameFileName,
  motionFrameTimes,
  planMotionExport,
} from './export';

function motionDocument(fps = 30, duration = 5): ForgeDocument {
  const created = createDocument(
    {
      title: 'Launch title 2026',
      studioId: 'motion',
      documentTypeId: brand<'DocumentTypeId'>('motion.scene'),
      canvas: { ...DEFAULT_CANVAS, width: 1920, height: 1080 },
      guides: DEFAULT_GUIDES,
    },
    { generateId: () => 'doc-export' },
  );
  if (!created.ok) throw new Error(created.error.message);
  const payload = created.value.studioPayload as MotionPayload;
  return {
    ...created.value,
    studioPayload: { ...payload, fps, duration },
  };
}

describe('motionFrameTimes', () => {
  it('takes frames at the frame rate, inclusive of the start and exclusive of the end', () => {
    const payload = motionDocument(30, 5).studioPayload as MotionPayload;
    const times = motionFrameTimes(payload, 0, 2);
    expect(times).toHaveLength(60);
    expect(times[0]).toBe(0);
    // Times are stored to the microsecond so a manifest is stable across platforms.
    expect(times[1]).toBeCloseTo(1 / 30, 5);
    expect(times[59]).toBeCloseTo(59 / 30, 6);
    expect(times).not.toContain(2);
  });

  it('honours a frame step without changing the composition frame rate', () => {
    const payload = motionDocument(24, 5).studioPayload as MotionPayload;
    const times = motionFrameTimes(payload, 0, 2, 3);
    expect(times).toHaveLength(16);
    expect(times[1]).toBeCloseTo(3 / 24, 5);
  });

  it('clamps the range to the composition and returns nothing for an empty range', () => {
    const payload = motionDocument(30, 2).studioPayload as MotionPayload;
    expect(motionFrameTimes(payload, -5, 99)).toHaveLength(60);
    expect(motionFrameTimes(payload, 1, 1)).toEqual([]);
    expect(motionFrameTimes(payload, 2, 1)).toEqual([]);
  });
});

describe('planMotionExport', () => {
  it('plans a size and a frame count from the document', () => {
    const document = motionDocument(30, 5);
    const plan = planMotionExport({
      document,
      payload: document.studioPayload as MotionPayload,
      to: 1,
      scale: 0.5,
    });
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value).toMatchObject({ fps: 30, width: 960, height: 540, scale: 0.5 });
    expect(plan.value.frameCount).toBe(30);
    expect(plan.value.times).toHaveLength(30);
  });

  it('refuses an empty range before rendering anything', () => {
    const document = motionDocument();
    const plan = planMotionExport({
      document,
      payload: document.studioPayload as MotionPayload,
      from: 2,
      to: 2,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error.message).toMatch(/empty/i);
  });

  it('refuses more frames than the cap and an out-of-range scale', () => {
    const document = motionDocument(60, 120);
    const tooLong = planMotionExport({
      document,
      payload: document.studioPayload as MotionPayload,
      from: 0,
      to: 60,
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.message).toContain(String(MAX_MOTION_EXPORT_FRAMES));

    const scale = planMotionExport({
      document,
      payload: document.studioPayload as MotionPayload,
      to: 1,
      scale: 9,
    });
    expect(scale.ok).toBe(false);
  });

  it('names frames so a directory listing sorts in playback order', () => {
    expect(motionFrameFileName(0, 12)).toBe('frames/frame-0001.png');
    expect(motionFrameFileName(11, 12)).toBe('frames/frame-0012.png');
    expect(motionFrameFileName(0, 1200)).toBe('frames/frame-0001.png');
    expect(motionFrameFileName(0, 20_000)).toBe('frames/frame-00001.png');
  });

  it('slugs an archive name and never emits a path separator', () => {
    expect(motionExportSlug('Launch title 2026')).toBe('launch-title-2026');
    expect(motionExportSlug('***')).toBe('motion');
    expect(motionArchiveName('../etc/passwd')).toBe('etc-passwd-frames.zip');
  });
});

describe('buildMotionManifest', () => {
  it('records the times, dimensions and a frame list that matches the plan', () => {
    const document = motionDocument(12, 2);
    const payload = document.studioPayload as MotionPayload;
    const plan = planMotionExport({ document, payload, to: 0.5 });
    if (!plan.ok) throw new Error(plan.error.message);
    const manifest = JSON.parse(
      buildMotionManifest({
        document,
        payload,
        plan: plan.value,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ) as {
      format: string;
      fps: number;
      frameCount: number;
      times: number[];
      frames: string[];
      width: number;
      height: number;
    };
    expect(manifest.format).toBe('eulerforge-motion-frames/1');
    expect(manifest.fps).toBe(12);
    expect(manifest.frameCount).toBe(6);
    expect(manifest.frames).toHaveLength(manifest.times.length);
    expect(manifest.frames[0]).toBe('frames/frame-0001.png');
    expect(manifest.width).toBe(1920);
    expect(manifest.height).toBe(1080);
  });
});
