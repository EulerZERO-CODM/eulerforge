'use client';

import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '../ui/button';
import { AccountMenu } from './account-menu';
import { MobileNav } from './mobile-nav';
import { contextLabelForPath, findNavItemForPath } from './nav-items';
import { CommandKeyHint } from './command-key-hint';

/**
 * Application top bar.
 *
 * Keeps a persistent "what screen am I on" label, one obvious creation action, and the command
 * palette trigger (which doubles as the global search affordance).
 */
export function Topbar({ onOpenPalette }: { readonly onOpenPalette: () => void }) {
  const pathname = usePathname();
  const context = findNavItemForPath(pathname);
  const label = context?.label ?? contextLabelForPath(pathname);

  return (
    <header className="border-line bg-canvas/85 sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-3 backdrop-blur-md sm:px-5">
      <MobileNav />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <p className="text-fg truncate text-base font-medium">{label ?? "Euler's Forge"}</p>
        {context && pathname !== context.href && pathname !== '/' ? (
          <span className="text-fg-subtle hidden truncate text-sm sm:inline">
            {breadcrumbTail(pathname, context.href)}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenPalette}
          className="border-line-strong text-fg-subtle hover:border-ink-600 hover:text-fg-muted hidden h-9 items-center gap-2 rounded-sm border px-2.5 text-sm transition-colors sm:inline-flex"
          aria-label="Search commands"
        >
          <Search aria-hidden className="size-4" />
          <span>Search</span>
          <CommandKeyHint />
        </button>

        <Button
          variant="quiet"
          size="md"
          className="sm:hidden"
          aria-label="Search commands"
          onClick={onOpenPalette}
          iconLeft={<Search aria-hidden />}
        >
          <span className="sr-only">Search</span>
        </Button>

        <Button asChild variant="primary" size="md" iconLeft={<Plus aria-hidden />}>
          <Link href="/create">New project</Link>
        </Button>

        <AccountMenu />
      </div>
    </header>
  );
}

/** "Studios / Design Studio" tail for the current path, so context is unambiguous. */
function breadcrumbTail(pathname: string, base: string): string {
  const tail = pathname.slice(base.length).replace(/^\//, '');
  if (!tail) return '';
  return `/ ${tail
    .split('/')
    .map((segment) => segment.replace(/-/g, ' '))
    .join(' / ')}`;
}
