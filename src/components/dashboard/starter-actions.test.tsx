import { render, screen } from '@testing-library/react';
import Link from 'next/link';
import { describe, expect, it, vi } from 'vitest';

import { StarterActions } from './starter-actions';
import { collectAppRoutes, isRoutable } from '../../testing/routes';
import { resolve } from 'node:path';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const routes = collectAppRoutes(resolve(process.cwd(), 'src/app'));

/**
 * The home page's three starting points are the most-clicked controls in the product, so they are
 * asserted rather than assumed: each one must lead to a screen the App Router actually serves, and
 * each must describe something the build can really do.
 */
describe('StarterActions', () => {
  it('offers exactly three starting points', () => {
    render(<StarterActions />);

    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('links every action to a route that exists', () => {
    render(<StarterActions />);

    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      expect(isRoutable(resolve(process.cwd(), 'src/app'), href, routes), href).toBe(true);
    }
  });

  it('routes the layout starter through a starter the flow understands', () => {
    render(<StarterActions />);

    const starterHref = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .find((href) => href.includes('starter='));

    expect(starterHref).toBeDefined();
    const starterId = new URL(starterHref ?? '', 'http://localhost').searchParams.get('starter');
    expect(starterId).toBe('subject-title');
  });

  it('states what each action produces, without promising an editor that does not exist', () => {
    render(<StarterActions />);

    expect(screen.getByText('Start a blank document')).toBeInTheDocument();
    expect(screen.getByText('Begin from a layout starter')).toBeInTheDocument();
    expect(screen.getByText('Follow a beginner tutorial')).toBeInTheDocument();

    // The starter card is explicit that the user supplies the artwork.
    expect(screen.getByText(/you place the artwork/i)).toBeInTheDocument();
  });

  it('reaches the tutorial through the learning layer, not a placeholder page', async () => {
    render(<StarterActions />);

    const tutorial = screen.getByText('Start the tutorial').closest('a');
    expect(tutorial).toHaveAttribute('href', '/learn/your-first-project');
  });

  it('renders actions as real links so they can be opened in a new tab', () => {
    render(<StarterActions />);

    // A `<Link>` renders an anchor with a resolvable href — the check a screen-reader user needs.
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('href');
      expect(link.tagName).toBe('A');
    }
    // Guard against the actions being re-implemented as buttons that swallow navigation.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(Link).toBeDefined();
  });
});
