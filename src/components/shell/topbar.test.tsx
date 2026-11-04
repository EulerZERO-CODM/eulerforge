import { within } from '@testing-library/react';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from './app-shell';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';

/**
 * The pathname the mocked router reports.
 *
 * During a server render Next.js reports the synthetic `/_not-found` path for an unknown URL, while
 * the browser reports the URL that was actually requested. The mock lets one test reproduce that
 * split exactly, without a real server.
 */
const navigation = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function shell() {
  return (
    <ForgeProvider services={createTestServices()}>
      <AppShell>
        <p>Screen content</p>
      </AppShell>
    </ForgeProvider>
  );
}

/**
 * The header must not disagree with itself across hydration.
 *
 * The defect this pins down: the top bar resolved a section by URL prefix, so a stale lesson link
 * (`/learn/not-a-lesson`) claimed "Learn / not a lesson" in the browser while the server-rendered
 * 404 claimed no section. React reported a hydration error on every such URL and re-rendered the
 * page. The navigation model now claims a section only for a page the app really serves, so both
 * renders agree — and the label is the truthful one for a link that no longer exists.
 */
describe('top bar during hydration', () => {
  const containers: HTMLElement[] = [];
  afterEach(() => {
    for (const container of containers.splice(0)) container.remove();
  });

  async function hydrateAcross(
    serverPath: string,
    browserPath: string,
  ): Promise<{ readonly header: HTMLElement; readonly recovered: readonly unknown[] }> {
    navigation.pathname = serverPath;
    const serverHtml = renderToString(shell());

    navigation.pathname = browserPath;
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.append(container);
    containers.push(container);

    const recovered: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, shell(), {
        onRecoverableError: (error) => {
          recovered.push(error);
        },
      });
    });

    const header = container.querySelector('header');
    if (!header) throw new Error('the shell rendered no header');
    return { header, recovered };
  }

  it('does not claim a section for a stale lesson link, and hydrates without recovering', async () => {
    const { header, recovered } = await hydrateAcross('/_not-found', '/learn/not-a-lesson');

    expect(recovered).toEqual([]);
    expect(within(header).getByText("Euler's Forge")).toBeInTheDocument();
    expect(header.textContent).not.toContain('not a lesson');
  });

  it('keeps the section and the breadcrumb for a lesson that exists', async () => {
    const path = '/learn/vector-versus-raster';
    const { header, recovered } = await hydrateAcross(path, path);

    expect(recovered).toEqual([]);
    expect(within(header).getByText('Learn')).toBeInTheDocument();
    expect(header.textContent).toContain('/ vector versus raster');
  });
});
