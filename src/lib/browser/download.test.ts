import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from './download';

/**
 * The browser download boundary.
 *
 * jsdom implements neither `URL.createObjectURL` nor real navigation, so this suite stubs exactly
 * those two things and then asserts the properties that matter: the anchor carries the right file
 * name, the click really happens, and a failure is *reported* rather than swallowed.
 */
describe('downloadBlob', () => {
  const created: string[] = [];
  let clicked: string[] = [];

  function stubObjectUrls(): void {
    created.length = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        const url = `blob:forge/${String(created.length)}`;
        created.push(url);
        expect(blob.size).toBeGreaterThan(0);
        return url;
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: (url: string) => {
        created.push(`revoked:${url}`);
      },
    });
  }

  function stubClicks(): void {
    clicked = [];
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      writable: true,
      value(this: HTMLAnchorElement) {
        clicked.push(this.download);
        expect(document.body.contains(this)).toBe(true);
      },
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hands the file to the browser and revokes the temporary URL', () => {
    stubObjectUrls();
    stubClicks();

    const started = downloadBlob(new Blob(['{"ok":true}'], { type: 'application/json' }), 'a.png');

    expect(started).toBe(true);
    expect(clicked).toEqual(['a.png']);
    expect(created).toEqual(['blob:forge/0', 'revoked:blob:forge/0']);
    // The anchor must not be left behind in the document.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('reports failure instead of pretending a download happened when the environment cannot save', () => {
    // `URL.createObjectURL` is absent in some server-side renderers.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    expect(downloadBlob(new Blob(['x']), 'a.png')).toBe(false);
  });
});
