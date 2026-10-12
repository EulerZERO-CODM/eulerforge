'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '../../lib/cn';
import { ForgeLogo } from '../brand/forge-logo';
import { NAV_GROUPS, isNavItemActive } from './nav-items';

/**
 * Desktop sidebar navigation.
 *
 * Uses `aria-current="page"` for the active destination and a left accent rail for the visual
 * indicator, so the current location is conveyed by more than colour alone.
 */
export function SidebarNav({
  className,
  onNavigate,
}: {
  readonly className?: string;
  readonly onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className={cn('flex h-full flex-col gap-6', className)}>
      <Link
        href="/"
        {...(onNavigate ? { onClick: onNavigate } : {})}
        className="inline-flex items-center rounded-sm px-1 py-1 focus-visible:outline-2"
      >
        <ForgeLogo />
      </Link>

      <div className="flex flex-1 flex-col gap-6">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="space-y-1.5">
            <p className="text-2xs text-fg-subtle px-2 font-medium tracking-wider uppercase">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isNavItemActive(item, pathname);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      {...(onNavigate ? { onClick: onNavigate } : {})}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-base transition-colors',
                        active
                          ? 'bg-ink-850 text-fg font-medium'
                          : 'text-fg-muted hover:bg-ink-900 hover:text-fg',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'absolute top-1.5 bottom-1.5 -left-2 w-0.5 rounded-full',
                          active ? 'bg-accent' : 'bg-transparent',
                        )}
                      />
                      <Icon
                        aria-hidden
                        className={cn('size-4 shrink-0', active ? 'text-accent' : 'text-fg-subtle')}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
