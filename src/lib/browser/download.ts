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

/**
 * Hands a text file to the browser.
 *
 * SVG and other text payloads are built in `src/core/**` as strings; this is where a string becomes a
 * `Blob`, so the core never names a web API. The `mimeType` is explicit rather than inferred from the
 * extension, because a browser decides how to open a file from the type it is given.
 */
export function downloadText(text: string, fileName: string, mimeType: string): boolean {
  return downloadBlob(new Blob([text], { type: mimeType }), fileName);
}

/**
 * Hands a binary file to the browser.
 *
 * `Uint8Array` rather than an `ArrayBuffer` so a payload built in core (a zip of icon files, say) can
 * be passed through without a copy.
 */
export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): boolean {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return downloadBlob(new Blob([buffer], { type: mimeType }), fileName);
}

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
