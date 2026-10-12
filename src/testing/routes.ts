/**
 * Test support: resolve the routes the App Router actually serves.
 *
 * Data-driven navigation (the sidebar, studio entries, shell commands, lesson exercises) is only
 * honest if every declared destination exists. These helpers read `src/app` at test time and match a
 * concrete URL against the pages that exist, so a renamed folder fails CI instead of shipping a
 * dead link.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type AppRoutePattern = {
  /** Pattern with dynamic segments left intact, e.g. `/studios/[studio]`. */
  readonly pattern: string;
  /** Absolute path of the owning `page.tsx`. */
  readonly file: string;
};

/** Walks `src/app` and collects every directory that contains a `page.tsx`. */
export function collectAppRoutes(appDir: string, prefix = ''): readonly AppRoutePattern[] {
  const routes: AppRoutePattern[] = [];

  // The root of `src/app` is not visited as a child directory, so it is handled explicitly.
  const rootPage = join(appDir, 'page.tsx');
  if (existsSync(rootPage)) routes.push({ pattern: prefix === '' ? '/' : prefix, file: rootPage });
  for (const entry of readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(appDir, entry.name);
    // Route groups — `(marketing)` — organise files without appearing in the URL.
    const isGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
    const isPrivate = entry.name.startsWith('_');
    if (isPrivate) continue;

    const nextPrefix = isGroup ? prefix : `${prefix}/${entry.name}`;
    const page = join(directory, 'page.tsx');
    if (existsSync(page))
      routes.push({ pattern: nextPrefix === '' ? '/' : nextPrefix, file: page });
    routes.push(...collectAppRoutes(directory, nextPrefix));
  }
  return routes;
}

/** True when a concrete href (query string and hash ignored) is served by the pattern. */
export function matchesAppRoute(pattern: string, href: string): boolean {
  const clean = href.split(/[?#]/)[0] ?? '';
  const normalised = clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
  if (normalised === pattern) return true;

  const patternSegments = pattern.split('/').filter(Boolean);
  const hrefSegments = normalised.split('/').filter(Boolean);
  if (patternSegments.length !== hrefSegments.length) return false;

  return patternSegments.every((segment, index) => {
    const value = hrefSegments[index] ?? '';
    if (segment.startsWith('[') && segment.endsWith(']')) return value.length > 0;
    return segment === value;
  });
}

/** Whether any page under `src/app` serves the href. `appDir` is the absolute `src/app` path. */
export function isRoutable(
  appDir: string,
  href: string,
  routes?: readonly AppRoutePattern[],
): boolean {
  const patterns = routes ?? collectAppRoutes(appDir);
  return patterns.some((route) => matchesAppRoute(route.pattern, href));
}
