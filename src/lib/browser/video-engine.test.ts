import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoMedia } from '../../core/documents/payload';
import { ok } from '../../core/result';
import { VideoMediaPool } from './video-engine';

/**
 * The decoder pool's readiness contract.
 *
 * jsdom has no media pipeline, so the element is a stand-in that the test drives by hand. That is
 * exactly what these cases need: the bug they guard against is a *state* problem — metadata without
 * a decoded frame — and no real decoder will reproduce that on demand. The rendering itself is
 * proved in the browser suite.
 */

const MEDIA: VideoMedia = {
  id: 'media-1',
  name: 'clip.webm',
  kind: 'video',
  mimeType: 'video/webm',
  duration: 1.2,
  width: 160,
  height: 90,
  size: 4096,
};

class FakeMediaElement extends EventTarget {
  preload = '';
  muted = false;
  src = '';
  currentTime = 0;
  readyState = 0;
  videoWidth = 160;
  playsInline = false;

  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
  load(): void {}
  setAttribute(): void {}
  removeAttribute(): void {}
  /** Set by the test that checks the pool waits for a presented frame; absent otherwise. */
  requestVideoFrameCallback?: (callback: () => void) => number;
}

describe('VideoMediaPool', () => {
  const created: FakeMediaElement[] = [];
  const originalCreate = document.createElement.bind(document);

  beforeEach(() => {
    created.length = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: () => 'blob:forge/video',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'video' || tag === 'audio') {
        const element = new FakeMediaElement();
        created.push(element);
        return element;
      }
      return originalCreate(tag);
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function makePool(load = async () => ok(new Blob(['frames']))): VideoMediaPool {
    return new VideoMediaPool(load);
  }

  it('does not resolve ensure on metadata alone, because metadata cannot be painted', async () => {
    const pool = makePool();
    let settled = false;
    const pending = pool.ensure(MEDIA).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const element = created[0];
    expect(element).toBeDefined();
    element?.dispatchEvent(new Event('loadedmetadata'));
    await Promise.resolve();
    expect(settled).toBe(false);

    if (element) element.readyState = 2;
    element?.dispatchEvent(new Event('loadeddata'));
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('treats a seek to the current position as done once data exists, without seeking', async () => {
    const pool = makePool();
    const ensured = pool.ensure(MEDIA);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const element = created[0];
    if (!element) throw new Error('the pool created no element');
    element.readyState = 2;
    element.dispatchEvent(new Event('loadeddata'));
    expect((await ensured).ok).toBe(true);

    // The browser can drop back to metadata-only while it fetches a frame; the position is still
    // the requested one, so there is nothing to seek and no `seeked` event will ever arrive.
    element.readyState = 1;
    const pending = pool.seek(MEDIA.id, 0);
    element.readyState = 2;
    element.dispatchEvent(new Event('loadeddata'));
    await expect(pending).resolves.toBe(true);
    expect(element.currentTime).toBe(0);
  });

  it('seeks a decoded element and reports the reached position', async () => {
    const pool = makePool();
    const ensured = pool.ensure(MEDIA);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const element = created[0];
    if (!element) throw new Error('the pool created no element');
    element.readyState = 2;
    element.dispatchEvent(new Event('loadeddata'));
    await ensured;

    const pending = pool.seek(MEDIA.id, 0.4);
    expect(element.currentTime).toBe(0.4);
    element.dispatchEvent(new Event('seeked'));
    await expect(pending).resolves.toBe(true);
  });

  it('waits for the frame the seek landed on, not merely for `seeked`', async () => {
    const pool = makePool();
    const ensured = pool.ensure(MEDIA);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const element = created[0];
    if (!element) throw new Error('the pool created no element');
    element.readyState = 2;
    element.dispatchEvent(new Event('loadeddata'));
    await ensured;

    // The browser says the seek is over while the compositor still shows the previous picture.
    // `drawImage` at that moment copies the old frame, which is how an exported PNG could disagree
    // with the preview at the same timestamp on a busy machine.
    let presented: (() => void) | undefined;
    element.requestVideoFrameCallback = (callback) => {
      presented = callback;
      return 1;
    };
    let settled = false;
    const pending = pool.seek(MEDIA.id, 0.4).then((result) => {
      settled = true;
      return result;
    });
    element.dispatchEvent(new Event('seeked'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    presented?.();
    await expect(pending).resolves.toBe(true);
    expect(settled).toBe(true);
  });

  it('still reaches the position when the browser has no frame callbacks', async () => {
    const pool = makePool();
    const ensured = pool.ensure(MEDIA);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const element = created[0];
    if (!element) throw new Error('the pool created no element');
    element.readyState = 2;
    element.dispatchEvent(new Event('loadeddata'));
    await ensured;

    // Firefox has no `requestVideoFrameCallback`; a seek must not hang waiting for one.
    vi.useFakeTimers();
    const pending = pool.seek(MEDIA.id, 0.4);
    element.dispatchEvent(new Event('seeked'));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(pending).resolves.toBe(true);
  });

  it('does not hang when a frame callback never arrives', async () => {
    const pool = makePool();
    const ensured = pool.ensure(MEDIA);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const element = created[0];
    if (!element) throw new Error('the pool created no element');
    element.readyState = 2;
    element.dispatchEvent(new Event('loadeddata'));
    await ensured;

    // A callback that is advertised and never called must cost one bounded wait, not a hang.
    element.requestVideoFrameCallback = () => 1;
    vi.useFakeTimers();
    const pending = pool.seek(MEDIA.id, 0.4);
    element.dispatchEvent(new Event('seeked'));
    await vi.advanceTimersByTimeAsync(0);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2_500);
    await expect(pending).resolves.toBe(true);
  });

  it('reports a missing element rather than pretending a seek happened', async () => {
    const pool = makePool();
    await expect(pool.seek('not-there', 1)).resolves.toBe(false);
  });
});
