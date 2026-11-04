/**
 * Export planning: what the file will be, before any pixels are rendered.
 *
 * These are the checks that would otherwise fail after a multi-second render — no source, a
 * zero-sized canvas, an output larger than the stored working copy, an encoder the browser cannot
 * provide. The plan is what the export panel renders its report from, so a wrong name or size here
 * is a wrong file on disk.
 */

import { describe, expect, it } from 'vitest';

import { defaultPhotoPayload, MAX_PHOTO_WORKING_EDGE } from '../documents/payload';
import {
  formatByteSize,
  photoExportFileName,
  planPhotoExport,
  PHOTO_EXPORT_INFO,
  type PhotoExportRequest,
} from './export';

const source = {
  name: 'Portrait.png',
  href: 'data:image/png;base64,AAAA',
  width: 400,
  height: 300,
  mimeType: 'image/png' as const,
  originalWidth: 4000,
  originalHeight: 3000,
};

function request(overrides: Partial<PhotoExportRequest> = {}): PhotoExportRequest {
  return {
    documentTitle: 'Launch portrait',
    payload: { ...defaultPhotoPayload(), source },
    width: 400,
    height: 300,
    format: 'png',
    ...overrides,
  };
}

describe('planPhotoExport', () => {
  it('plans a PNG at the document size with a slugged, descriptive name', () => {
    const plan = planPhotoExport(request());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value).toMatchObject({
      format: 'png',
      mimeType: 'image/png',
      fileName: 'launch-portrait-400x300.png',
      width: 400,
      height: 300,
      quality: 1,
    });
  });

  it('gives JPEG and WebP their own extension, MIME type and a clamped quality', () => {
    const jpeg = planPhotoExport(request({ format: 'jpeg', quality: 3 }));
    if (!jpeg.ok) throw new Error(jpeg.error.message);
    expect(jpeg.value).toMatchObject({
      mimeType: 'image/jpeg',
      fileName: 'launch-portrait-400x300.jpg',
      quality: 1,
    });
    const webp = planPhotoExport(request({ format: 'webp', quality: 0.01 }));
    if (!webp.ok) throw new Error(webp.error.message);
    expect(webp.value).toMatchObject({
      mimeType: 'image/webp',
      fileName: 'launch-portrait-400x300.webp',
      quality: 0.5,
    });
  });

  it('refuses to export a project with no imported photo', () => {
    const plan = planPhotoExport(request({ payload: defaultPhotoPayload() }));
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error.code).toBe('validation-failed');
      expect(plan.error.message).toMatch(/no imported photo/i);
    }
  });

  it('refuses a size that is not whole pixels or is empty', () => {
    expect(planPhotoExport(request({ width: 0 })).ok).toBe(false);
    expect(planPhotoExport(request({ width: 400.5 })).ok).toBe(false);
  });

  it('refuses an output larger than the stored working copy, and says why', () => {
    const plan = planPhotoExport(request({ width: MAX_PHOTO_WORKING_EDGE + 2 }));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error.detail).toMatch(/long edge/i);
  });

  it('carries the encoder-support result so the panel can refuse before rendering', () => {
    const plan = planPhotoExport(request({ format: 'webp' }), { mimeTypeSupported: false });
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.mimeTypeSupported).toBe(false);
  });

  it('states which formats carry a quality setting', () => {
    expect(PHOTO_EXPORT_INFO.png.quality).toBe(false);
    expect(PHOTO_EXPORT_INFO.jpeg.quality).toBe(true);
    expect(PHOTO_EXPORT_INFO.webp.quality).toBe(true);
  });
});

describe('photoExportFileName', () => {
  it('falls back to a stable slug and never emits a path separator', () => {
    expect(photoExportFileName('***', 'png', { width: 2, height: 3 })).toBe('photo-2x3.png');
    expect(photoExportFileName('../etc/passwd', 'jpeg', { width: 2, height: 3 })).toBe(
      'etc-passwd-2x3.jpg',
    );
  });
});

describe('formatByteSize', () => {
  it('reports bytes, kilobytes and megabytes with a fixed precision', () => {
    expect(formatByteSize(12)).toBe('12 B');
    expect(formatByteSize(1536)).toBe('1.5 KB');
    expect(formatByteSize(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});
