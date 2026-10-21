'use client';

import { CircleUser, Cloud, Settings, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { contextLabelForPath, findNavItemForPath } from './nav-items';

/**
 * Account and context menu.
 *
 * There is no account system in this phase. Instead of fake profile data, the menu states that
 * plainly and routes to the two things that do exist: local settings and the roadmap entry for
 * accounts and sync.
 */
export function AccountMenu() {
  const pathname = usePathname();
  const context = findNavItemForPath(pathname);
  const label = context?.label ?? contextLabelForPath(pathname);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="quiet"
          size="md"
          className="gap-2"
          aria-label="Open account and workspace menu"
        >
          <CircleUser aria-hidden className="size-4" />
          <span className="hidden sm:inline">Workspace</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-64">
        <DropdownMenuLabel>{label ? `You are in ${label}` : "Euler's Forge"}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden className="text-fg-subtle size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Not available yet</DropdownMenuLabel>
        <DropdownMenuItem disabled>
          <UserPlus aria-hidden className="text-fg-subtle size-4" />
          Sign in — accounts are planned
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Cloud aria-hidden className="text-fg-subtle size-4" />
          Cloud sync — local device storage only
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/roadmap">
            <span className="text-fg-subtle">→</span>
            See when these arrive
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
