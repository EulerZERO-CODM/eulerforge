import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from './app-shell';
import { NAV_GROUPS } from './nav-items';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { collectAppRoutes, isRoutable } from '../../testing/routes';
import { resolve } from 'node:path';

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const appDir = resolve(process.cwd(), 'src/app');
const routes = collectAppRoutes(appDir);

function renderShell(services: TestForgeServices = createTestServices()) {
  return render(
    <ForgeProvider services={services}>
      <AppShell>
        <p>Screens render here</p>
      </AppShell>
    </ForgeProvider>,
  );
}

describe('AppShell', () => {
  let services: TestForgeServices;

  beforeEach(() => {
    services = createTestServices();
  });

  it('renders the skip link, the main landmark and its children', () => {
    renderShell(services);
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByText('Screens render here')).toBeInTheDocument();
  });

  it('renders every navigation destination from the shared nav data', () => {
    renderShell(services);
    const nav = screen.getByRole('navigation', { name: /primary/i });
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(within(nav).getByRole('link', { name: new RegExp(item.label, 'i') })).toBeTruthy();
      }
    }
  });

  it('links only to destinations the App Router serves', () => {
    renderShell(services);
    const links = screen.getAllByRole('link');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http')) continue;
      expect(isRoutable(appDir, href, routes), href).toBe(true);
    }
  });

  it('marks the current page in the navigation', () => {
    renderShell(services);
    const current = screen.getByRole('link', { name: /projects/i });
    expect(current).toHaveAttribute('aria-current', 'page');
  });

  it('states that projects live in this browser, without implying a cloud account', () => {
    renderShell(services);
    expect(screen.getByText(/stored in this browser only/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /how storage works/i })).toBeInTheDocument();
  });

  it('renders the notification region even when there is nothing to announce', () => {
    renderShell(services);
    expect(screen.getByRole('region', { name: /notifications/i })).toBeInTheDocument();
  });
});
