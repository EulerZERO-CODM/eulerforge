import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StudioGlyph, STUDIO_ACCENT_CLASSES, STUDIO_ICONS } from './studio-icon';
import { listStudios, type StudioAccent, type StudioIconName } from '../../core/studios';

/**
 * The studio registry is framework-free, so it stores an icon *name*. This module is the only place
 * that resolves those names to components — which makes the mapping a real integration point: a new
 * studio with an icon nobody drew must fail here rather than render an empty shape.
 */
describe('studio icon resolution', () => {
  it('resolves every icon name the registry declares', () => {
    const declared = new Set(listStudios().map((studio) => studio.icon));

    expect(declared.size).toBeGreaterThan(0);
    for (const name of declared) {
      expect(STUDIO_ICONS[name], `no icon registered for "${name}"`).toBeDefined();
    }
  });

  it('resolves every accent token the registry declares', () => {
    const declared = new Set(listStudios().map((studio) => studio.accent));

    for (const accent of declared) {
      expect(STUDIO_ACCENT_CLASSES[accent], `no accent class for "${accent}"`).toBeDefined();
    }
  });

  it('carries no icon or accent the registry never uses', () => {
    const declaredIcons = new Set<string>(listStudios().map((studio) => studio.icon));
    const declaredAccents = new Set<string>(listStudios().map((studio) => studio.accent));

    for (const name of Object.keys(STUDIO_ICONS) as StudioIconName[]) {
      expect(declaredIcons.has(name), `unused icon "${name}"`).toBe(true);
    }
    for (const accent of Object.keys(STUDIO_ACCENT_CLASSES) as StudioAccent[]) {
      expect(declaredAccents.has(accent), `unused accent "${accent}"`).toBe(true);
    }
  });

  it('renders a decorative glyph so the surrounding copy carries the meaning', () => {
    const { container } = render(<StudioGlyph name="layout" accent="ember" />);

    const glyph = container.querySelector('span[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph?.querySelector('svg')).not.toBeNull();
  });
});
