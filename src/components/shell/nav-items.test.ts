import { describe, expect, it } from 'vitest';

import { contextLabelForPath, findNavItemForPath, screenLabelForPath } from './nav-items';

describe('findNavItemForPath', () => {
  it('finds the navigation entry for a path', () => {
    expect(findNavItemForPath('/projects')?.label).toBe('Projects');
    expect(findNavItemForPath('/studios/design')?.label).toBe('Studios');
    expect(findNavItemForPath('/learn')?.label).toBe('Learn');
  });

  it('does not claim the reader is on the home page everywhere', () => {
    // Home is the root, not a prefix of every path. Matching it for any path made the whole
    // application — including the editor — say you were on the home page.
    expect(findNavItemForPath('/')?.label).toBe('Home');
    expect(findNavItemForPath('/projects')).toBeDefined();
    expect(findNavItemForPath('/projects')?.label).not.toBe('Home');
    expect(findNavItemForPath('/workspace/doc-1')).toBeUndefined();
  });
});

describe('contextLabelForPath', () => {
  it('names the workspace, which is not a navigation destination', () => {
    expect(contextLabelForPath('/workspace/doc-1')).toBe('Workspace');
    expect(contextLabelForPath('/projects')).toBeUndefined();
  });
});

describe('screenLabelForPath', () => {
  it('names the screen whatever kind of route it is', () => {
    expect(screenLabelForPath('/projects')).toBe('Projects');
    expect(screenLabelForPath('/workspace/doc-1')).toBe('Workspace');
  });
});
