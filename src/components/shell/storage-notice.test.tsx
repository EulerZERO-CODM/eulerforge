import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from './app-shell';
import { StorageNotice } from './storage-notice';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';
import { persistentStorageStatus, volatileStorageStatus } from '../../state/storage-status';
import { isRoutable } from '../../testing/routes';
import { resolve } from 'node:path';

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const appDir = resolve(process.cwd(), 'src/app');

/**
 * The global storage warning.
 *
 * The failure this guards against is specific and expensive: silent in-memory fallback means a user
 * can create projects, see them listed, and lose them on reload without a single warning. So with a
 * volatile backend the shell must say so, with an undetermined (server-render) or persistent backend
 * it must stay quiet, and every link it offers has to lead somewhere real.
 */
describe('StorageNotice', () => {
  it('warns with the reason and keeps the copy actionable when storage is refused', () => {
    render(
      <ForgeProvider
        services={createTestServices({ storageStatus: volatileStorageStatus('Access denied.') })}
      >
        <StorageNotice />
      </ForgeProvider>,
    );

    const notice = screen.getByRole('note');
    expect(notice).toHaveTextContent('Projects are not being saved to this device');
    expect(notice).toHaveTextContent(/held in memory for this tab only/i);
    expect(notice).toHaveTextContent(/lost when it reloads or closes/i);

    // The remedies are links, and they resolve to real pages.
    const links = within(notice).getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(isRoutable(appDir, href), href).toBe(true);
    }
  });

  it('stays silent when storage is persistent', () => {
    render(
      <ForgeProvider services={createTestServices({ storageStatus: persistentStorageStatus() })}>
        <StorageNotice />
      </ForgeProvider>,
    );

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('stays silent during server rendering, where the browser has not been asked yet', () => {
    render(
      <ForgeProvider
        services={createTestServices({
          storageStatus: { ...volatileStorageStatus(), determined: false, cause: 'server-render' },
        })}
      >
        <StorageNotice />
      </ForgeProvider>,
    );

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('appears inside the application shell, above the main landmark', () => {
    render(
      <ForgeProvider services={createTestServices({ storageStatus: volatileStorageStatus() })}>
        <AppShell>
          <p>Screen content</p>
        </AppShell>
      </ForgeProvider>,
    );

    const notice = screen.getByRole('note');
    const main = screen.getByRole('main');
    expect(notice.compareDocumentPosition(main)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('changes the shell footer so the sidebar never claims projects are stored', () => {
    const { unmount } = render(
      <ForgeProvider services={createTestServices({ storageStatus: volatileStorageStatus() })}>
        <AppShell>
          <p>Screen content</p>
        </AppShell>
      </ForgeProvider>,
    );

    expect(screen.getByText(/Nothing is being written to this device/i)).toBeInTheDocument();
    unmount();

    render(
      <ForgeProvider services={createTestServices({ storageStatus: persistentStorageStatus() })}>
        <AppShell>
          <p>Screen content</p>
        </AppShell>
      </ForgeProvider>,
    );

    expect(screen.getByText(/Projects are stored in this browser only/i)).toBeInTheDocument();
  });
});
