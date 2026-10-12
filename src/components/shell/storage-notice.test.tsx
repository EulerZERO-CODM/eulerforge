import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from './app-shell';
import { StorageNotice } from './storage-notice';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';
import {
  persistentStorageStatus,
  storagePhase,
  undeterminedStorageStatus,
  volatileStorageStatus,
} from '../../state/storage-status';
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
      <ForgeProvider services={createTestServices({ storageStatus: undeterminedStorageStatus() })}>
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

    expect(
      screen.getByText(/only in memory and will be lost when this page reloads/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/stored in this browser/i)).not.toBeInTheDocument();
    unmount();

    render(
      <ForgeProvider services={createTestServices({ storageStatus: persistentStorageStatus() })}>
        <AppShell>
          <p>Screen content</p>
        </AppShell>
      </ForgeProvider>,
    );

    expect(screen.getByText(/Projects are stored in this browser only/i)).toBeInTheDocument();
    expect(screen.queryByText(/only in memory/i)).not.toBeInTheDocument();
  });
});

/**
 * Undetermined storage — the state a server render produces, before the browser has been inspected.
 *
 * The defect these tests pin down: the footer branched two ways on "is storage refusing writes?", so
 * an uninspected browser took the persistent branch and the shell claimed projects were stored before
 * anything had checked. "Not volatile" is not the same as "durable".
 */
describe('undetermined storage', () => {
  function renderFooter(status = undeterminedStorageStatus()) {
    return render(
      <ForgeProvider services={createTestServices({ storageStatus: status })}>
        <AppShell>
          <p>Screen content</p>
        </AppShell>
      </ForgeProvider>,
    );
  }

  it('shows neutral wording instead of a durability claim', () => {
    renderFooter();

    expect(screen.getByText(/checking storage/i)).toBeInTheDocument();
  });

  it('does not claim projects are stored anywhere', () => {
    renderFooter();

    expect(screen.queryByText(/stored in this browser/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/local to this device/i)).not.toBeInTheDocument();
    // Nor the opposite claim: nothing has failed yet, so it must not read as an error either.
    expect(screen.queryByText(/only in memory/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not being saved/i)).not.toBeInTheDocument();
  });

  it('still offers the explanation link, so the wording is not a dead end', () => {
    renderFooter();

    const link = screen.getByRole('link', { name: /how storage works/i });
    expect(isRoutable(appDir, link.getAttribute('href') ?? '')).toBe(true);
  });

  it('keeps the banner hidden until the browser has been checked', () => {
    renderFooter();

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('switches to the persistent claim once the browser has been checked', () => {
    const { unmount } = renderFooter();
    expect(screen.queryByText(/stored in this browser/i)).not.toBeInTheDocument();
    unmount();

    renderFooter(persistentStorageStatus());
    expect(screen.getByText(/Projects are stored in this browser only/i)).toBeInTheDocument();
    expect(screen.queryByText(/checking storage/i)).not.toBeInTheDocument();
  });

  it('reaches exactly one claim in each of the three states', () => {
    const states: readonly {
      readonly status: ReturnType<typeof persistentStorageStatus>;
      readonly pattern: RegExp;
    }[] = [
      { status: persistentStorageStatus(), pattern: /stored in this browser only/i },
      { status: volatileStorageStatus(), pattern: /only in memory and will be lost/i },
      { status: undeterminedStorageStatus(), pattern: /checking storage/i },
    ];

    for (const status of states) {
      const { unmount } = renderFooter(status.status);

      // Exactly one of the three claims is on screen...
      const present = states.filter((candidate) => screen.queryByText(candidate.pattern) !== null);
      expect(
        present.map((candidate) => candidate.pattern.source),
        storagePhase(status.status),
      ).toEqual([status.pattern.source]);

      // ...and it is the one this status supports, never another phase's wording.
      expect(screen.getByText(status.pattern)).toBeInTheDocument();

      unmount();
    }
  });
});
