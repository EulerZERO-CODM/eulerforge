import { describe, expect, it } from 'vitest';

import { LESSONS } from '../../core/learning/content';
import { studioRegistry } from '../../core/studios';
import { NAV_GROUPS, findNavItemForPath, isNavItemActive } from './nav-items';

describe('findNavItemForPath', () => {
  it('reports the section a known route belongs to', () => {
    expect(findNavItemForPath('/')?.href).toBe('/');
    expect(findNavItemForPath('/studios')?.href).toBe('/studios');
    expect(findNavItemForPath('/studios/design')?.href).toBe('/studios');
    expect(findNavItemForPath('/learn')?.href).toBe('/learn');
    expect(findNavItemForPath('/learn/vector-versus-raster')?.href).toBe('/learn');
    expect(findNavItemForPath('/settings')?.href).toBe('/settings');
  });

  it('claims no section for a route that does not exist', () => {
    // Home is not a prefix of everything: an unknown path has no section, and the top bar must not
    // build a breadcrumb from it. This also keeps the server's synthetic `/_not-found` path and the
    // browser's real path rendering the same header, which is what a 404 needs to hydrate cleanly.
    expect(findNavItemForPath('/this-page-does-not-exist')).toBeUndefined();
    expect(findNavItemForPath('/unknown/deeper')).toBeUndefined();
    expect(findNavItemForPath('/_not-found')).toBeUndefined();
  });

  it('claims no section for a stale child of a real destination', () => {
    // These were the paths that still hydrated wrongly: a prefix match called them by their parent
    // section in the browser, while the server rendered the page as belonging to no section.
    expect(findNavItemForPath('/learn/not-a-lesson')).toBeUndefined();
    expect(findNavItemForPath('/learn/vector-versus-raster/extra')).toBeUndefined();
    expect(findNavItemForPath('/studios/not-a-studio')).toBeUndefined();
    expect(findNavItemForPath('/projects/abc')).toBeUndefined();
    expect(findNavItemForPath('/settings/theme')).toBeUndefined();
    expect(findNavItemForPath('/assets/x')).toBeUndefined();
  });

  it('recognises every child page the registries generate', () => {
    for (const studio of studioRegistry.list()) {
      expect(findNavItemForPath(`/studios/${studio.slug}`)?.href, studio.slug).toBe('/studios');
    }
    for (const lesson of LESSONS) {
      expect(findNavItemForPath(`/learn/${lesson.slug}`)?.href, lesson.slug).toBe('/learn');
    }
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(findNavItemForPath(item.href)?.href, item.href).toBe(item.href);
      }
    }
  });

  it('marks exactly one navigation item active', () => {
    expect(isNavItemActive({ href: '/' } as never, '/')).toBe(true);
    expect(isNavItemActive({ href: '/' } as never, '/projects')).toBe(false);
    expect(isNavItemActive({ href: '/learn' } as never, '/learn/vector-versus-raster')).toBe(true);
    expect(isNavItemActive({ href: '/learn' } as never, '/learn/not-a-lesson')).toBe(false);
    expect(isNavItemActive({ href: '/projects' } as never, '/projects/abc')).toBe(false);
    expect(isNavItemActive({ href: '/projects' } as never, '/projects')).toBe(true);
  });
});
