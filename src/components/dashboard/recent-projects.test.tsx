import { act, cleanup } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecentProjects } from './recent-projects';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Hydrating the recent-projects card against the markup a server sent.
 *
 * The home page's content is served behind a `loading.tsx` boundary, so the browser hydrates it in a
 * second pass — after the shell's effects have already told the documents store to load. That used to
 * mean the server's skeletons were hydrated by a component reading a *loaded* store, which is a
 * hydration mismatch: React reported an error and re-rendered the page inside the browser. This test
 * reproduces the ordering without a browser: render the server markup, load the store, then hydrate.
 */

function projects(services: ReturnType<typeof createTestServices>): React.ReactNode {
  return (
    <ForgeProvider services={services}>
      <RecentProjects />
    </ForgeProvider>
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('RecentProjects hydration', () => {
  it('keeps the server markup when the store loaded before hydration, then reports the real state', async () => {
    const services = createTestServices();
    const serverHtml = renderToString(projects(services));
    // The server could not read storage, so what it sent is the loading state.
    expect(serverHtml).toContain('animate-pulse');
    expect(serverHtml).not.toContain('No projects yet');

    // The shell's effect: the store loads before the deferred boundary is hydrated.
    await services.documents.load();
    expect(services.documents.getState().status).toBe('ready');

    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recovered: unknown[] = [];

    await act(async () => {
      hydrateRoot(container, projects(services), {
        onRecoverableError: (error: unknown) => recovered.push(error),
      });
    });

    // No mismatch, and the honest empty state follows immediately.
    expect(recovered).toEqual([]);
    expect(container.textContent).toContain('No projects yet');
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });
});
