/**
 * The account panel, driven through its own controls.
 *
 * The network is replaced at the module boundary — `remote-client` — because there is no server in
 * jsdom; the server itself is covered by `src/server/routes.test.ts`, which runs the real handlers.
 * Everything above that boundary is real: the form validation, the sync plan, the conflict choices
 * and the wording the user reads.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountPanel } from './account-panel';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../../core/documents/factories';
import { brand } from '../../core/types/brand';
import { readSyncMarks, SYNC_MARKS_KEY } from '../../lib/browser/sync-marks';
import type { SessionState } from '../../core/account/session';
import type * as Remote from '../../lib/browser/remote-client';

const ACCOUNT = {
  id: 'acct-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

const session = vi.fn(async (): Promise<SessionState> => ({ status: 'anonymous' }));

vi.mock('../../lib/browser/remote-client', async (importOriginal) => {
  const actual = await importOriginal<typeof Remote>();
  return {
    ...actual,
    fetchSession: (...args: Parameters<typeof session>) => session(...args),
    signIn: vi.fn(),
    register: vi.fn(),
    signOut: vi.fn(async () => ({ ok: true as const, value: true })),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    deleteAccount: vi.fn(),
    listRemoteDocuments: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchRemoteDocument: vi.fn(),
    pushDocument: vi.fn(),
    createShareLink: vi.fn(),
    listShareLinks: vi.fn(async () => ({ ok: true as const, value: [] })),
    revokeShareLink: vi.fn(async () => ({ ok: true as const, value: true })),
  };
});

const remote = await import('../../lib/browser/remote-client');

function renderPanel(services: TestForgeServices) {
  return render(
    <ForgeProvider services={services}>
      <AccountPanel />
    </ForgeProvider>,
  );
}

describe('AccountPanel', () => {
  let services: TestForgeServices;

  beforeEach(async () => {
    vi.clearAllMocks();
    window.localStorage.clear();
    session.mockResolvedValue({ status: 'anonymous' });
    services = createTestServices();
    await services.documents.load();
  });

  it('says the server is optional before anything else', async () => {
    renderPanel(services);
    expect(screen.getByText(/Account and sync — optional/)).toBeInTheDocument();
    expect(
      screen.getByText(/Work stays in this browser unless you choose to sync it/),
    ).toBeInTheDocument();
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('keeps the app usable and says so when the server is unreachable', async () => {
    session.mockResolvedValue({
      status: 'unavailable',
      notice: 'The optional server could not be reached.',
    });
    renderPanel(services);
    expect(await screen.findByText('Working locally, as designed')).toBeInTheDocument();
    expect(screen.getByText(/optional server could not be reached/)).toBeInTheDocument();
    expect(
      screen.getByText(/Every studio, save, reopen and export works without an account/),
    ).toBeInTheDocument();
  });

  it('validates registration locally and shows every problem at once', async () => {
    const user = userEvent.setup();
    renderPanel(services);
    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
    await user.type(screen.getByLabelText('Email'), 'nope');
    await user.type(screen.getByLabelText('Password'), 'short');
    fireEvent.submit(screen.getByRole('form', { name: 'Create an account' }));

    expect(
      await screen.findByText('That does not look like an email address.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter a name to show.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(remote.register).not.toHaveBeenCalled();
  });

  it('shows the server’s own sentence when a sign-in is refused', async () => {
    vi.mocked(remote.signIn).mockResolvedValue({
      ok: false,
      error: {
        kind: 'unauthenticated',
        message: 'That email and password do not match.',
        issues: [],
        status: 401,
      },
    });
    const user = userEvent.setup();
    renderPanel(services);
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong password');
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByText('That email and password do not match.')).toBeInTheDocument();
    });
  });

  it('signs in and shows the account, without claiming the work is now remote', async () => {
    vi.mocked(remote.signIn).mockResolvedValue({ ok: true, value: ACCOUNT });
    // Anonymous on the first read, signed in once the sign-in has succeeded.
    session
      .mockResolvedValueOnce({ status: 'anonymous' })
      .mockResolvedValue({ status: 'signed-in', account: ACCOUNT, activeSessions: 1 });
    const user = userEvent.setup();
    renderPanel(services);
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in' }));

    expect(await screen.findByText('Profile')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ada')).toBeInTheDocument();
    expect(screen.getByText(/1 active session for this account/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  });

  it('plans an upload, shows why, and remembers the agreement after pushing it', async () => {
    const created = createDocument({
      title: 'Launch poster',
      studioId: 'design',
      documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
      canvas: DEFAULT_CANVAS,
      guides: DEFAULT_GUIDES,
    });
    if (!created.ok) throw new Error(created.error.message);
    await services.documents.create({
      title: 'Launch poster',
      studioId: 'design',
      documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
      canvas: DEFAULT_CANVAS,
      guides: DEFAULT_GUIDES,
    });
    session.mockResolvedValue({ status: 'signed-in', account: ACCOUNT, activeSessions: 1 });
    vi.mocked(remote.pushDocument).mockResolvedValue({
      ok: true,
      value: { revision: 1, updatedAt: '2026-10-19T10:00:00.000Z' },
    });

    const user = userEvent.setup();
    renderPanel(services);
    await user.click(await screen.findByRole('button', { name: 'Check what would change' }));

    const plan = await screen.findByTestId('sync-plan');
    expect(within(plan).getByText('Launch poster')).toBeInTheDocument();
    expect(within(plan).getByText('Only in this browser.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run sync' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Run sync' }));
    await waitFor(() => {
      expect(remote.pushDocument).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(remote.pushDocument).mock.calls[0]?.[0].baseRevision).toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/Sync finished/)).toBeInTheDocument();
    });
    const marks = readSyncMarks();
    expect(Object.keys(marks)).toHaveLength(1);
    expect(window.localStorage.getItem(SYNC_MARKS_KEY)).toContain('2026-10-19T10:00:00.000Z');

    // The plan is gone because it was executed; a second check must not think the upload is pending.
    expect(screen.queryByTestId('sync-plan')).not.toBeInTheDocument();
  });

  it('refuses to run a plan while a conflict is unresolved, then lets each side be chosen', async () => {
    const created = createDocument({
      title: 'Launch poster',
      studioId: 'design',
      documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
      canvas: DEFAULT_CANVAS,
      guides: DEFAULT_GUIDES,
    });
    if (!created.ok) throw new Error(created.error.message);
    const saved = await services.documents.create({
      title: 'Launch poster',
      studioId: 'design',
      documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
      canvas: DEFAULT_CANVAS,
      guides: DEFAULT_GUIDES,
    });
    if (!saved.ok) throw new Error(saved.error.message);

    session.mockResolvedValue({ status: 'signed-in', account: ACCOUNT, activeSessions: 1 });
    vi.mocked(remote.listRemoteDocuments).mockResolvedValue({
      ok: true,
      value: [
        {
          id: saved.value.id,
          title: 'Launch poster',
          documentTypeId: 'design.canvas',
          revision: 4,
          createdAt: '2026-10-17T09:00:00.000Z',
          updatedAt: '2026-10-18T09:00:00.000Z',
          bytes: 2048,
        },
      ],
    });

    const user = userEvent.setup();
    renderPanel(services);
    await user.click(await screen.findByRole('button', { name: 'Check what would change' }));

    expect(
      await screen.findByText(
        /no record of them agreeing, so neither copy is overwritten automatically/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Resolve the conflicts first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run sync' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Keep the server.s copy/ }));
    expect(await screen.findByText(/Chosen over the copy here from/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run sync' })).toBeEnabled();
  });

  it('creates a share link once, shows it, and never claims it can be shown again', async () => {
    session.mockResolvedValue({ status: 'signed-in', account: ACCOUNT, activeSessions: 1 });
    const saved = await services.documents.create({
      title: 'Launch poster',
      studioId: 'design',
      documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
      canvas: DEFAULT_CANVAS,
      guides: DEFAULT_GUIDES,
    });
    if (!saved.ok) throw new Error(saved.error.message);
    vi.mocked(remote.createShareLink).mockResolvedValue({
      ok: true,
      value: {
        token: 'a'.repeat(43),
        share: {
          id: 'share-1',
          documentId: saved.value.id,
          createdAt: '2026-10-19T10:00:00.000Z',
          expiresAt: '2026-10-26T10:00:00.000Z',
        },
      },
    });

    const user = userEvent.setup();
    renderPanel(services);
    await user.click(await screen.findByRole('button', { name: 'Create link' }));

    expect(await screen.findByTestId('share-link')).toHaveTextContent(`/shared/${'a'.repeat(43)}`);
    expect(screen.getByText(/the server keeps only a digest/)).toBeInTheDocument();
  });
});
