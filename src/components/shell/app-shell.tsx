'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { env } from '../../config/env';
import { useForgeServices } from '../../state/forge-provider';
import { useDocumentLibrary } from '../../state/hooks';
import { TooltipProvider } from '../ui/tooltip';
import { ToastViewport } from '../ui/toast-viewport';
import { CommandPalette, useCommandPaletteShortcut } from './command-palette';
import { MotionPreferenceSync } from './motion-preference';
import { SidebarNav } from './sidebar-nav';
import { Topbar } from './topbar';

/**
 * Application shell.
 *
 * Owns the persistent chrome (sidebar, top bar, notifications, command palette) and the single
 * place where the project library is loaded. Screens below it render content only — which is why a
 * new studio page needs no knowledge of navigation or storage.
 */
export function AppShell({ children }: { readonly children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { bus, toasts } = useForgeServices();
  const library = useDocumentLibrary();

  useCommandPaletteShortcut(() => {
    setPaletteOpen(true);
  });

  // Surface storage problems once, through the notification region, instead of failing silently.
  useEffect(() => {
    return bus.on('storage:error', (payload) => {
      toasts.error('Local storage problem', payload.message);
    });
  }, [bus, toasts]);

  useEffect(() => {
    if (library.status === 'ready' && library.skipped.length > 0) {
      toasts.warning(
        `${library.skipped.length} stored project${library.skipped.length === 1 ? '' : 's'} could not be read`,
        library.skipped[0]?.reason ?? 'Open Settings for details.',
      );
    }
  }, [library.skipped, library.status, toasts]);

  return (
    <TooltipProvider>
      <MotionPreferenceSync />

      <a
        href="#main-content"
        className="focus:border-line-strong focus:bg-surface-overlay focus:text-fg sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-sm focus:border focus:px-3 focus:py-2 focus:text-base"
      >
        Skip to main content
      </a>

      <div className="lg:grid lg:min-h-dvh lg:grid-cols-[16.5rem_minmax(0,1fr)]">
        <aside className="border-line bg-surface sticky top-0 hidden h-dvh shrink-0 border-r px-4 py-4 lg:flex lg:flex-col">
          <SidebarNav />
          <ShellFooter />
        </aside>

        <div className="flex min-h-dvh min-w-0 flex-col">
          <Topbar
            onOpenPalette={() => {
              setPaletteOpen(true);
            }}
          />
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
            {children}
          </main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ToastViewport />
    </TooltipProvider>
  );
}

function ShellFooter() {
  return (
    <div className="border-line-subtle text-2xs text-fg-subtle mt-4 space-y-1 border-t pt-3">
      <p className="forge-numeric">v0.1.0 · {env.environment}</p>
      <p>
        Projects are stored in this browser only.{' '}
        <Link
          href="/learn/how-your-projects-are-stored"
          className="hover:text-fg-muted underline decoration-1 underline-offset-2"
        >
          How storage works
        </Link>
      </p>
      <p>
        <Link
          href="/platform-status"
          className="hover:text-fg-muted underline decoration-1 underline-offset-2"
        >
          What works today
        </Link>
      </p>
    </div>
  );
}
