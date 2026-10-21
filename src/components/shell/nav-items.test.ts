import { describe, expect, it } from 'vitest';

import { findNavItemForPath, isNavItemActive } from './nav-items';

describe('findNavItemForPath', () => {
  it('reports the section a known route belongs to', () => {
    expect(findNavItemForPath('/')?.href).toBe('/');
    expect(findNavItemForPath('/studios')?.href).toBe('/studios');
    expect(findNavItemForPath('/studios/design')?.href).toBe('/studios');
    expect(findNavItemForPath('/settings')?.href).toBe('/settings');
  });

  it('claims no section for a route that does not exist', () => {
    // Home is not a prefix of everything: an unknown path has no section, and the top bar must not
    // build a breadcrumb from it. This also keeps the server's synthetic `/_not-found` path and the
    // browser's real path rendering the same header, which is what a 404 needs to hydrate cleanly.
    expect(findNavItemForPath('/this-page-does-not-exist')).toBeUndefined();
    expect(findNavItemForPath('/unknown/deeper')).toBeUndefined();
  });

  it('marks exactly one navigation item active', () => {
    expect(isNavItemActive({ href: '/' } as never, '/')).toBe(true);
    expect(isNavItemActive({ href: '/' } as never, '/projects')).toBe(false);
    expect(isNavItemActive({ href: '/projects' } as never, '/projects/abc')).toBe(true);
  });
});
