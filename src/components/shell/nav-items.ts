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

/** Longest-prefix match so `/studios/design` still reports "Studios". */
export function findNavItemForPath(pathname: string): NavItem | undefined {
  const matches = ALL_NAV_ITEMS.filter((item) =>
    // Home is the *root*, not a prefix of everything: matching it for any path made the whole
    // application claim you were on the Home page, including the editor.
    item.href === '/'
      ? pathname === '/'
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return matches.sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * The name of a screen that is not in the navigation.
 *
 * The workspace is per document rather than a navigation destination, so it has no nav item — but
 * the chrome still has to say where the reader is.
 */
export function contextLabelForPath(pathname: string): string | undefined {
  if (pathname === '/workspace' || pathname.startsWith('/workspace/')) return 'Workspace';
  return undefined;
}

/** The label the chrome should show for a path, navigation item or not. */
export function screenLabelForPath(pathname: string): string | undefined {
  return findNavItemForPath(pathname)?.label ?? contextLabelForPath(pathname);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
