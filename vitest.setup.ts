import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';

/**
 * Shared test setup.
 *
 * Everything here targets jsdom, so it is guarded by `typeof window`: a suite may opt into the Node
 * environment with `// @vitest-environment node` (see
 * `src/core/persistence/storage.server-render.test.ts`, which exists to exercise the server-rendering
 * branch of the storage boundary) and this file must not break it.
 */
const hasDom = typeof window !== 'undefined';

if (hasDom) {
  // jsdom does not implement matchMedia; a handful of components use it for
  // `prefers-reduced-motion` and responsive behaviour checks.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  // Radix UI primitives rely on these in jsdom.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }

  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false;
    window.HTMLElement.prototype.setPointerCapture = () => undefined;
    window.HTMLElement.prototype.releasePointerCapture = () => undefined;
  }
}

afterEach(async () => {
  if (!hasDom) return;
  // Imported lazily so the Node-environment suites never load the DOM testing library at all.
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  window.localStorage.clear();
});
