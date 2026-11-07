import {
  BookOpen,
  Compass,
  FolderOpen,
  Home,
  Layers,
  Plus,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react';

import { getLesson } from '../../core/learning/query';
import { studioRegistry } from '../../core/studios';

export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Shown in tooltips and the mobile drawer for extra context. */
  readonly description: string;
};

export type NavGroup = {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
};

/**
 * Global navigation.
 *
 * Declared as data because the sidebar, the mobile drawer, the command palette and the page-title
 * resolver all derive from it. Adding a destination is one entry, not four edits.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'create',
    label: 'Create',
    items: [
      {
        href: '/',
        label: 'Home',
        icon: Home,
        description: 'Start here: what you can make and where to begin',
      },
      {
        href: '/create',
        label: 'New project',
        icon: Plus,
        description: 'Create a document from a canvas preset',
      },
      {
        href: '/projects',
        label: 'Projects',
        icon: FolderOpen,
        description: 'Projects stored in this browser',
      },
    ],
  },
  {
    id: 'explore',
    label: 'Explore',
    items: [
      {
        href: '/studios',
        label: 'Studios',
        icon: Layers,
        description: 'Every discipline, with honest build status',
      },
      {
        href: '/assets',
        label: 'Assets',
        icon: Search,
        description: 'Sample palette, templates and presets',
      },
      {
        href: '/learn',
        label: 'Learn',
        icon: BookOpen,
        description: 'Concepts, tutorials and guided exercises',
      },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    items: [
      {
        href: '/roadmap',
        label: 'Roadmap',
        icon: Compass,
        description: 'What is built, what is next, what is exploratory',
      },
      {
        href: '/settings',
        label: 'Settings',
        icon: Settings,
        description: 'Defaults, accessibility and local data',
      },
    ],
  },
] as const;

export const ALL_NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * Navigation destinations that really have child pages, and how to recognise one.
 *
 * The top bar and the sidebar may only claim a section for a URL the App Router actually serves.
 * That is not pedantry: for an unknown URL Next.js answers with its prerendered `/_not-found`
 * document, whose server render sees the synthetic path `/_not-found` while the browser sees the
 * URL that was typed. A naive prefix match therefore rendered "Learn / not a lesson" in the browser
 * and "Euler's Forge" in the server markup, and React reported a hydration error on every stale
 * lesson link. Checking the child segment against the same registry that generated the route means
 * both sides agree — the URL is not a lesson, so no section is claimed. Unknown paths under a
 * destination, such as `/projects/abc` or `/settings/theme`, are treated the same way because no
 * such route exists.
 */
const CHILD_ROUTES: Readonly<Record<string, (segment: string) => boolean>> = {
  '/studios': (segment) => studioRegistry.bySlug(segment) !== undefined,
  '/learn': (segment) => getLesson(segment) !== undefined,
};

/**
 * The navigation item for a pathname, if the app actually serves that path.
 *
 * Home matches the root path only. A deeper path must be the item's own URL or a real child route;
 * anything else has no section, which is the truth and keeps server and browser renders identical.
 */
export function findNavItemForPath(pathname: string): NavItem | undefined {
  const exact = ALL_NAV_ITEMS.find((item) => item.href === pathname);
  if (exact) return exact;

  const parent = ALL_NAV_ITEMS.filter(
    (item) => item.href !== '/' && pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
  if (!parent) return undefined;

  const remainder = pathname.slice(parent.href.length + 1);
  if (remainder.length === 0 || remainder.includes('/')) return undefined;
  const isChild = CHILD_ROUTES[parent.href];
  return isChild?.(remainder) === true ? parent : undefined;
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return findNavItemForPath(pathname)?.href === item.href;
}
