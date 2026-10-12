/**
 * Browser download boundary.
 *
 * The only place in the export layer that touches a real browser: everything upstream returns a
 * `Blob`, and this turns it into a file the user actually receives. Returns `false` when there is no
 * document to attach an anchor to (server rendering), so callers report a failure instead of
 * claiming a download that never happened.
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
