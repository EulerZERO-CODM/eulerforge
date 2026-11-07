import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SharedDocumentView } from './shared-document-view';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A share link that cannot be opened is still a screen, not a fragment of a page.
 *
 * The defect this pins down: the failure branch rendered a note with no heading, so a revoked or
 * mistyped share link reached the browser as a page with no `h1` — the same gap the global 404 had.
 */
describe('a shared project link that cannot be opened', () => {
  it('names the failure in the page heading and repeats the server sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'That share link is not valid.' } }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const { container } = render(<SharedDocumentView token="not-a-token" />);

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('This link does not open');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByText('That share link is not valid.')).toBeInTheDocument();
    expect(screen.getByText(/Links expire/)).toBeInTheDocument();
  });
});
