import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import NotFound from './not-found';

/**
 * The 404 screen is a page, not an empty panel.
 *
 * The defect this pins down: the shared empty state rendered its title as a paragraph, so the one
 * screen a broken link lands on had no heading at all — nothing for a screen reader's heading list,
 * nothing for a crawler, and nothing for the skip-to-content link to lead anywhere useful.
 */
describe('the global 404 screen', () => {
  it('has one top-level heading and three destinations that always exist', () => {
    render(<NotFound />);

    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('That page does not exist');
    expect(headings[0]?.tagName).toBe('H1');

    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Browse studios' })).toHaveAttribute(
      'href',
      '/studios',
    );
    expect(screen.getByRole('link', { name: 'Learning hub' })).toHaveAttribute('href', '/learn');
  });
});
