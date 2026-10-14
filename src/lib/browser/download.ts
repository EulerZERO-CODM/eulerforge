/**
 * Browser download adapter.
 *
 * The only place in the application that hands a file to the browser: everything upstream returns a
 * `Blob`, and this turns it into a file the user actually receives. It lives outside `src/core/**`,
 * which may not touch `document`, `window` or `URL.createObjectURL` (ESLint enforces that).
 *
 * Returns `false` when there is no document to attach an anchor to (server rendering, or a browser
 * that refuses object URLs), so callers report a failure instead of claiming a download that never
 * happened.
 */

export function downloadBlob(blob: Blob, fileName: string): boolean {
  if (typeof window === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    window.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}
