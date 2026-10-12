import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from './command-palette';
import { createShellCommands } from './commands';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { collectAppRoutes, isRoutable } from '../../testing/routes';
import { resolve } from 'node:path';

const push = vi.fn();
let pathname = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const appDir = resolve(process.cwd(), 'src/app');
const routes = collectAppRoutes(appDir);

function renderPalette(services: TestForgeServices = createTestServices()) {
  const onOpenChange = vi.fn();
  const view = render(
    <ForgeProvider services={services}>
      <CommandPalette open onOpenChange={onOpenChange} />
    </ForgeProvider>,
  );
  return { ...view, onOpenChange };
}

describe('CommandPalette', () => {
  let services: TestForgeServices;

  beforeEach(() => {
    services = createTestServices();
    pathname = '/';
    push.mockClear();
  });

  it('lists registered actions grouped by area', async () => {
    renderPalette(services);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/actions registered/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /new project/i })).toBeInTheDocument();
  });

  it('filters actions as the user types', async () => {
    const user = userEvent.setup();
    renderPalette(services);

    await user.type(screen.getByLabelText('Search commands'), 'roadmap');
    expect(screen.getByRole('button', { name: /roadmap/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^new project$/i })).not.toBeInTheDocument();
  });

  it('shows a helpful empty state instead of a blank list', async () => {
    const user = userEvent.setup();
    renderPalette(services);

    await user.type(screen.getByLabelText('Search commands'), 'zzz-nothing');
    expect(screen.getByText('No matching actions')).toBeInTheDocument();
  });

  it('navigates to a real route when a command runs', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderPalette(services);

    await user.click(await screen.findByRole('button', { name: /roadmap/i }));

    expect(push).toHaveBeenCalledWith('/roadmap');
    expect(isRoutable(appDir, '/roadmap', routes)).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('routes every visible command to a destination that exists', async () => {
    const user = userEvent.setup();
    renderPalette(services);

    for (const command of createShellCommands()) {
      // Commands are hidden when their availability predicate fails; only visible ones can be
      // clicked, and each of those must land on a route the App Router serves.
      if (
        command.isAvailable &&
        !command.isAvailable({ hasDocuments: false, documentCount: 0, pathname })
      ) {
        expect(
          screen.queryByRole('button', { name: new RegExp(escapeRegExp(command.title), 'i') }),
        ).toBeNull();
        continue;
      }
      push.mockClear();
      await user.click(
        await screen.findByRole('button', { name: new RegExp(escapeRegExp(command.title), 'i') }),
      );
      const target = push.mock.calls[0]?.[0];
      if (typeof target === 'string') {
        expect(isRoutable(appDir, target, routes), `${command.id} → ${target}`).toBe(true);
      }
    }
  });

  it('only offers the contextual help command inside a workspace', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPalette(services);
    expect(screen.queryByRole('button', { name: /explain the current tool/i })).toBeNull();
    unmount();

    pathname = '/workspace/doc-1';
    renderPalette(services);
    await user.type(screen.getByLabelText('Search commands'), 'explain');
    expect(screen.getByRole('button', { name: /explain the current tool/i })).toBeInTheDocument();
  });

  it('announces that a command ran through the event bus', async () => {
    const user = userEvent.setup();
    const executed: string[] = [];
    services.bus.on('command:executed', (payload) => executed.push(payload.id));

    renderPalette(services);
    await user.click(await screen.findByRole('button', { name: /new project/i }));

    await waitFor(() => {
      expect(executed).toContain('project.new');
    });
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
