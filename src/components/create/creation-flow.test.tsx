/**
 * The creation flow, driven through all four steps.
 *
 * The point of these tests is the *document that comes out*: which studio the user picked decides
 * the document type, and an Illustration project has to open on the vector artboard rather than on
 * a design canvas that merely claims to be one.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreationFlow } from './creation-flow';
import { ForgeProvider } from '../../state/forge-provider';
import { ToastViewport } from '../ui/toast-viewport';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/create',
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

function renderFlow(services: TestForgeServices) {
  render(
    <ForgeProvider services={services}>
      <ToastViewport />
      <CreationFlow />
    </ForgeProvider>,
  );
}

/** Walk the four steps, leaving the defaults in place except for the document name. */
async function createProject(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: /^Continue$/ }));
  await user.click(screen.getByRole('button', { name: /^Continue$/ }));
  const title = screen.getByLabelText('Project name');
  await user.clear(title);
  await user.type(title, name);
  await user.click(screen.getByRole('button', { name: /^Continue$/ }));
  await user.click(screen.getByRole('button', { name: /create project/i }));
}

describe('creation flow', () => {
  let services: TestForgeServices;

  beforeEach(async () => {
    push.mockClear();
    services = createTestServices();
    await services.documents.load();
    window.history.replaceState({}, '', '/create');
  });

  it('creates a Design document with the design canvas type', async () => {
    const user = userEvent.setup();
    renderFlow(services);

    await createProject(user, 'Poster');

    await waitFor(() => {
      expect(services.documents.getState().documents).toHaveLength(1);
    });
    const created = services.documents.getState().documents[0];
    expect(created?.studioId).toBe('design');
    expect(created?.documentTypeId).toBe('design.canvas');
  });

  it('creates a vector document when the Illustration Studio is chosen', async () => {
    window.history.replaceState({}, '', '/create?studio=illustration');
    const user = userEvent.setup();
    renderFlow(services);

    // The studio step opens on the requested studio, and the step still lists the document type
    // that will be created rather than a generic studio name.
    expect(screen.getByRole('button', { name: /Illustration Studio/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The studio card names the document type it will create, not just the studio.
    expect(screen.getByText('Vector artboard.')).toBeInTheDocument();

    await createProject(user, 'Icon set');

    await waitFor(() => {
      expect(services.documents.getState().documents).toHaveLength(1);
    });
    const created = services.documents.getState().documents[0];
    expect(created?.studioId).toBe('illustration');
    expect(created?.documentTypeId).toBe('illustration.artboard');
    expect(push).toHaveBeenCalledWith(`/workspace/${String(created?.id)}`);
  });

  it('creates a photo document when the Photo Studio is chosen', async () => {
    window.history.replaceState({}, '', '/create?studio=photo');
    const user = userEvent.setup();
    renderFlow(services);

    expect(screen.getByRole('button', { name: /Photo Studio/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Photo image.')).toBeInTheDocument();

    await createProject(user, 'Portrait');

    await waitFor(() => {
      expect(services.documents.getState().documents).toHaveLength(1);
    });
    const created = services.documents.getState().documents[0];
    expect(created?.studioId).toBe('photo');
    expect(created?.documentTypeId).toBe('photo.image');
    // The document is born with a photo payload, which is what the workspace switches on.
    expect(created?.studioPayload?.kind).toBe('photo');
  });

  it('will not offer to create a document for a studio that is still planned', async () => {
    const user = userEvent.setup();
    renderFlow(services);

    const video = screen.getByRole('button', { name: /Video Studio/ });
    expect(video).toBeDisabled();
    expect(video).toHaveAttribute('aria-pressed', 'false');

    await createProject(user, 'Poster');
    await waitFor(() => {
      expect(services.documents.getState().documents[0]?.studioId).toBe('design');
    });
  });

  it('names the document type on the review step', async () => {
    window.history.replaceState({}, '', '/create?studio=illustration');
    const user = userEvent.setup();
    renderFlow(services);

    await user.click(screen.getByRole('button', { name: /^Continue$/ }));
    await user.click(screen.getByRole('button', { name: /^Continue$/ }));
    const title = screen.getByLabelText('Project name');
    await user.clear(title);
    await user.type(title, 'Icon set');
    await user.click(screen.getByRole('button', { name: /^Continue$/ }));

    expect(screen.getByText('Document type')).toBeInTheDocument();
    expect(screen.getByText('Vector artboard')).toBeInTheDocument();
  });
});
