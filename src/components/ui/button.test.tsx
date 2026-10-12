import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Link from 'next/link';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';

// `asChild` exists to style links; use the real `Link` component rather than a bare anchor so the
// test covers how the application actually navigates.
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

/**
 * The button primitive is the single interactive affordance in the application, so its contract —
 * real element, accessible name, honest disabled/loading state, and the `asChild` link form — is
 * asserted directly rather than only through the screens that use it.
 */
describe('Button', () => {
  it('renders a real button with a safe default type', () => {
    render(<Button>Start a project</Button>);

    const button = screen.getByRole('button', { name: 'Start a project' });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('respects an explicit type and forwards clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button type="submit" onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'submit');

    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('blocks interaction while loading and announces what is happening', () => {
    render(
      <Button loading loadingLabel="Saving project">
        Save
      </Button>,
    );

    // The accessible name includes the announcement woven in beside the visible label.
    const button = screen.getByRole('button', { name: /save/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Save');
    expect(screen.getByText('Saving project')).toBeInTheDocument();
  });

  it('marks a disabled button as aria-disabled without inventing new semantics', () => {
    render(<Button disabled>Delete</Button>);

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('renders the child element as a link when asChild is set', () => {
    render(
      <Button asChild variant="primary">
        <Link href="/create">Create a project</Link>
      </Button>,
    );

    // The child wins: the accessible name and the navigation both come from the anchor.
    const link = screen.getByRole('link', { name: 'Create a project' });
    expect(link).toHaveAttribute('href', '/create');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the label while placing icons on both sides in the asChild form', () => {
    render(
      <Button
        asChild
        iconLeft={<span data-testid="leading" />}
        iconRight={<span data-testid="trailing" />}
      >
        <Link href="/learn">Learn the basics</Link>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Learn the basics' });
    expect(link).toContainElement(screen.getByTestId('leading'));
    expect(link).toContainElement(screen.getByTestId('trailing'));
  });
});
