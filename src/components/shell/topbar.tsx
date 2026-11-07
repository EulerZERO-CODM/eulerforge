'use client';

import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { ForgeDocument } from '../../core/documents/types';
import { Button } from '../ui/button';
import { Kbd } from '../ui/kbd';
import { AccountMenu } from './account-menu';
import { MobileNav } from './mobile-nav';
import { findNavItemForPath } from './nav-items';

/**
 * Application top bar.
 *
 * Keeps a persistent "what screen am I on" label, one obvious creation action, and the command
 * palette trigger (which doubles as the global search affordance).
 *
 * On a project the label is that project's name, not the product name: "where am I" is useless if
 * every open document reads the same. The name comes from the library `AppShell` already loaded, so
 * the server render (no library yet) and the first client render agree, and the name appears on the
 * update that follows.
 */
export function Topbar({
  onOpenPalette,
  documents = [],
}: {
  readonly onOpenPalette: () => void;
  /** Loaded project summaries; only used to name the open project. */
  readonly documents?: readonly ForgeDocument[];
}) {
  const pathname = usePathname();
  const context = findNavItemForPath(pathname);
  // The creation flow is the destination this bar's action points at; offering it again would be a
  // dead link, and on a phone it is what squeezes the page title into "New pr…".
  const showCreateAction = pathname !== '/create';

  return (
    <header className="border-line bg-canvas/85 sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-3 backdrop-blur-md sm:px-5">
      <MobileNav />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <p className="text-fg truncate text-base font-medium">
          {context?.label ?? workspaceLabel(pathname, documents)}
        </p>
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
          <Kbd>⌘K</Kbd>
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

        {showCreateAction ? (
          <Button
            asChild
            variant="primary"
            size="md"
            className="px-2.5 sm:px-3.5"
            aria-label="New project"
            iconLeft={<Plus aria-hidden />}
          >
            <Link href="/create">
              {/* Icon-only below `sm`, so the page title keeps its room on a phone. */}
              <span className="hidden sm:inline">New project</span>
            </Link>
          </Button>
        ) : null}

        <AccountMenu />
      </div>
    </header>
  );
}

/**
 * Names the project open in `/workspace/<id>`.
 *
 * The library is loaded after the shell mounts, so the server and the first client render both show
 * "Workspace" and the project name swaps in afterwards — never a mismatch. An id that no longer
 * exists keeps that honest placeholder rather than falling back to the product name.
 */
function workspaceLabel(pathname: string, documents: readonly ForgeDocument[]): string {
  const match = /^\/workspace\/([^/]+)/.exec(pathname);
  if (!match?.[1]) return "Euler's Forge";
  const id = match[1];
  return documents.find((document) => String(document.id) === id)?.title ?? 'Workspace';
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
