'use client';

/**
 * Account, sync and sharing — the optional-server surface.
 *
 * Three rules shaped this panel:
 *
 * 1. **It never gates the app.** Nothing here is required to make work: the panel says so, and when
 *    the server is unreachable it shows one calm sentence instead of an error page.
 * 2. **No token is ever in JavaScript's hands.** The session is an HttpOnly cookie; the only secret
 *    this component ever sees is a share-link token, which it shows once and can revoke.
 * 3. **A sync never overwrites without asking.** The plan is computed first, every row says why it is
 *    there, and a conflict offers both copies rather than choosing one.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  describeExpiry,
  isRetryable,
  normaliseEmail,
  OWNERSHIP_NOTE,
  shareUrl,
  validateRegistration,
  type Account,
  type ApiFailure,
  type RemoteDocumentSummary,
  type SessionState,
} from '../../core/account/session';
import {
  describePlan,
  markAfterDownload,
  markAfterUpload,
  planSync,
  resolveConflict,
  type LocalDocumentState,
  type SyncAction,
} from '../../core/account/sync';
import { migrateDocument } from '../../core/documents/migrations';
import type { ForgeDocument } from '../../core/documents/types';
import { formatByteSize } from '../../core/photo/export';
import {
  changePassword,
  createShareLink,
  deleteAccount as deleteAccountOnServer,
  fetchRemoteDocument,
  fetchSession,
  listRemoteDocuments,
  listShareLinks,
  pushDocument,
  register,
  revokeShareLink,
  signIn,
  signOut,
  updateProfile,
  type RemoteResult,
} from '../../lib/browser/remote-client';
import { readSyncMarks, writeSyncMark } from '../../lib/browser/sync-marks';
import { useForgeServices } from '../../state/forge-provider';
import { useDocuments } from '../../state/hooks';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/field';
import { Panel } from '../ui/section';
import { InlineNote } from '../ui/states';

type Mode = 'sign-in' | 'register';

function sentenceOf(failure: ApiFailure): string {
  return failure.issues.length > 0
    ? `${failure.message} ${failure.issues.join(' ')}`
    : failure.message;
}

export function AccountPanel() {
  const { documents: documentsStore } = useForgeServices();
  const { documents: localDocuments, status: documentsStatus } = useDocuments();
  const [session, setSession] = useState<SessionState | null>(null);
  const [mode, setMode] = useState<Mode>('sign-in');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    const next = await fetchSession();
    setSession(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSession().then((next) => {
      if (!cancelled) setSession(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const account = session?.status === 'signed-in' ? session.account : null;

  return (
    <section aria-labelledby="account-heading" className="space-y-5">
      <div className="space-y-2">
        <h2 id="account-heading" className="text-fg text-lg font-semibold">
          Account and sync — optional
        </h2>
        <p className="text-fg-muted text-sm">
          {OWNERSHIP_NOTE} You can sign in to keep a copy on a server you run, or ignore this panel
          entirely.
        </p>
      </div>

      {notice ? (
        <InlineNote tone="info" title="Done">
          {notice}
        </InlineNote>
      ) : null}
      {failure ? (
        <InlineNote tone="warning" title="That did not complete">
          <p>{sentenceOf(failure)}</p>
          {isRetryable(failure) ? (
            <p className="text-fg-subtle mt-1 text-xs">
              This is a connection problem, so nothing you have here was changed.
            </p>
          ) : null}
        </InlineNote>
      ) : null}

      {session === null ? (
        <p className="text-fg-subtle text-sm" role="status">
          Checking whether the optional server is running…
        </p>
      ) : session.status === 'unavailable' ? (
        <InlineNote tone="info" title="Working locally, as designed">
          <p>{session.notice}</p>
          <p className="text-fg-subtle mt-1 text-xs">
            Every studio, save, reopen and export works without an account.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => {
              void refreshSession();
            }}
          >
            Check again
          </Button>
        </InlineNote>
      ) : account ? (
        <SignedIn
          account={account}
          activeSessions={session.status === 'signed-in' ? session.activeSessions : null}
          localDocuments={localDocuments}
          documentsReady={documentsStatus === 'ready'}
          onSessionChange={(next) => {
            setSession(next ?? { status: 'anonymous' });
          }}
          onNotice={setNotice}
          onFailure={setFailure}
          onSaveDocument={async (document) => {
            const result = await documentsStore.update(document);
            return result.ok;
          }}
        />
      ) : (
        <SignedOut
          mode={mode}
          busy={busy}
          onMode={setMode}
          onSubmit={async (fields) => {
            setBusy(true);
            setFailure(null);
            setNotice(null);
            try {
              const result =
                mode === 'sign-in'
                  ? await signIn({ email: normaliseEmail(fields.email), password: fields.password })
                  : await register({
                      email: normaliseEmail(fields.email),
                      displayName: fields.displayName,
                      password: fields.password,
                    });
              if (!result.ok) {
                setFailure(result.error);
                return;
              }
              setNotice(
                mode === 'sign-in'
                  ? `Signed in as ${result.value.displayName}.`
                  : `Account created for ${result.value.email}.`,
              );
              await refreshSession();
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}

function SignedOut({
  mode,
  busy,
  onMode,
  onSubmit,
}: {
  readonly mode: Mode;
  readonly busy: boolean;
  readonly onMode: (mode: Mode) => void;
  readonly onSubmit: (fields: {
    readonly email: string;
    readonly displayName: string;
    readonly password: string;
  }) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [issues, setIssues] = useState<readonly string[]>([]);

  return (
    <Panel className="space-y-4">
      <div role="group" aria-label="Account action" className="flex gap-2">
        <Button
          size="sm"
          variant={mode === 'sign-in' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'sign-in'}
          onClick={() => {
            onMode('sign-in');
            setIssues([]);
          }}
        >
          Sign in
        </Button>
        <Button
          size="sm"
          variant={mode === 'register' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'register'}
          onClick={() => {
            onMode('register');
            setIssues([]);
          }}
        >
          Create an account
        </Button>
      </div>

      <form
        className="space-y-3"
        aria-label={mode === 'sign-in' ? 'Sign in' : 'Create an account'}
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === 'register') {
            const problems = validateRegistration({ email, displayName, password });
            setIssues(problems);
            if (problems.length > 0) return;
          }
          setIssues([]);
          void onSubmit({ email, displayName, password });
        }}
      >
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>
        {mode === 'register' ? (
          <Field label="Name to show">
            <Input
              value={displayName}
              autoComplete="name"
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
            />
          </Field>
        ) : null}
        <Field
          label="Password"
          hint={
            mode === 'register'
              ? 'At least 10 characters. Stored only as a salted scrypt hash.'
              : undefined
          }
        >
          <Input
            type="password"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
        {issues.length > 0 ? (
          <InlineNote tone="warning" title="Check the form">
            <ul className="list-disc pl-4">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </InlineNote>
        ) : null}
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
    </Panel>
  );
}

function SignedIn({
  account,
  activeSessions,
  localDocuments,
  documentsReady,
  onSessionChange,
  onNotice,
  onFailure,
  onSaveDocument,
}: {
  readonly account: Account;
  readonly activeSessions: number | null;
  readonly localDocuments: readonly ForgeDocument[];
  readonly documentsReady: boolean;
  readonly onSessionChange: (next: SessionState | null) => void;
  readonly onNotice: (notice: string | null) => void;
  readonly onFailure: (failure: ApiFailure | null) => void;
  readonly onSaveDocument: (document: ForgeDocument) => Promise<boolean>;
}) {
  const [name, setName] = useState(account.displayName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<RemoteResult<unknown>>): Promise<void> {
    setBusy(key);
    onFailure(null);
    onNotice(null);
    try {
      const result = await action();
      if (!result.ok) onFailure(result.error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-fg text-sm font-semibold">Profile</h3>
          <span className="text-fg-subtle text-2xs font-mono">{account.email}</span>
        </div>
        <Field label="Name to show">
          <Input
            value={name}
            maxLength={60}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || name.trim() === account.displayName}
            onClick={() => {
              void run('name', () => updateProfile(name.trim())).then(() => {
                onNotice('Your display name was updated.');
              });
            }}
          >
            Save name
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={busy !== null}
            onClick={() => {
              void run('signout', () => signOut()).then(() => {
                onSessionChange({ status: 'anonymous' });
                onNotice('Signed out. Local work is untouched.');
              });
            }}
          >
            Sign out
          </Button>
        </div>
        <p className="text-fg-subtle text-xs">
          {activeSessions === null
            ? 'Active sessions are not reported by this server.'
            : `${String(activeSessions)} active session${activeSessions === 1 ? '' : 's'} for this account.`}
        </p>
      </Panel>

      <SyncPanel
        account={account}
        localDocuments={localDocuments}
        documentsReady={documentsReady}
        onSaveDocument={onSaveDocument}
        onNotice={onNotice}
        onFailure={onFailure}
      />

      <SharesPanel onNotice={onNotice} onFailure={onFailure} />

      <Panel className="space-y-3">
        <h3 className="text-fg text-sm font-semibold">Password</h3>
        <form
          className="space-y-3"
          aria-label="Change password"
          onSubmit={(event) => {
            event.preventDefault();
            void run('password', () => changePassword({ currentPassword, newPassword })).then(
              (result) => {
                void result;
              },
            );
          }}
        >
          <Field label="Current password">
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value);
              }}
            />
          </Field>
          <Field label="New password" hint="Changing it signs out every other device.">
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
              }}
            />
          </Field>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={busy !== null || currentPassword.length === 0 || newPassword.length === 0}
          >
            Change password
          </Button>
        </form>
      </Panel>

      <Panel className="space-y-3">
        <h3 className="text-fg text-sm font-semibold">Delete this account</h3>
        <p className="text-fg-muted text-xs">
          Removes the account, its sessions, every document it owns on this server and every share
          link pointing at one of them. Copies in this browser stay where they are.
        </p>
        <Field label="Type “delete my account” to confirm">
          <Input
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
            }}
          />
        </Field>
        <Button
          size="sm"
          variant="danger"
          disabled={busy !== null || confirmation !== 'delete my account'}
          onClick={() => {
            void run('delete', () => deleteAccountOnServer()).then(() => {
              onSessionChange({ status: 'anonymous' });
              onNotice('The account and its server-side data were deleted.');
            });
          }}
        >
          Delete account
        </Button>
      </Panel>
    </div>
  );
}

function SyncPanel({
  account,
  localDocuments,
  documentsReady,
  onSaveDocument,
  onNotice,
  onFailure,
}: {
  readonly account: Account;
  readonly localDocuments: readonly ForgeDocument[];
  readonly documentsReady: boolean;
  readonly onSaveDocument: (document: ForgeDocument) => Promise<boolean>;
  readonly onNotice: (notice: string | null) => void;
  readonly onFailure: (failure: ApiFailure | null) => void;
}) {
  const [remote, setRemote] = useState<readonly RemoteDocumentSummary[] | null>(null);
  const [plan, setPlan] = useState<readonly SyncAction[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const local: readonly LocalDocumentState[] = localDocuments.map((document) => ({
    id: document.id,
    title: document.title,
    updatedAt: document.updatedAt,
    revision: document.revision,
  }));

  async function loadPlan(): Promise<void> {
    setBusy(true);
    setProgress(null);
    onFailure(null);
    onNotice(null);
    try {
      const listed = await listRemoteDocuments();
      if (!listed.ok) {
        onFailure(listed.error);
        return;
      }
      setRemote(listed.value);
      const computed = planSync({
        local,
        remote: listed.value,
        marks: readSyncMarks(),
      });
      setPlan(computed.actions);
      if (computed.idle) onNotice(describePlan(computed));
    } finally {
      setBusy(false);
    }
  }

  function applyConflict(
    action: Extract<SyncAction, { kind: 'conflict' }>,
    choice: 'local' | 'remote',
  ): void {
    setPlan((current) =>
      current
        ? current.map((entry) => (entry.id === action.id ? resolveConflict(action, choice) : entry))
        : current,
    );
  }

  async function runPlan(): Promise<void> {
    if (!plan) return;
    setBusy(true);
    setProgress(null);
    onFailure(null);
    const marks = readSyncMarks();
    let uploaded = 0;
    let downloaded = 0;

    try {
      for (const action of plan) {
        if (action.kind === 'in-sync' || action.kind === 'conflict') continue;
        if (action.kind === 'upload') {
          const document = localDocuments.find((entry) => entry.id === action.id);
          if (!document) continue;
          const mark = marks[action.id];
          const remoteEntry = remote?.find((entry) => entry.id === action.id);
          const baseRevision = remoteEntry ? (mark?.remoteRevision ?? null) : null;
          setProgress(`Uploading “${document.title}”…`);
          const pushed = await pushDocument({ document, baseRevision });
          if (!pushed.ok) {
            onFailure(pushed.error);
            return;
          }
          writeSyncMark(
            action.id,
            markAfterUpload({
              localUpdatedAt: document.updatedAt,
              revision: pushed.value.revision,
              remoteUpdatedAt: pushed.value.updatedAt,
            }),
          );
          uploaded += 1;
          continue;
        }
        // download
        setProgress(`Downloading “${action.title}”…`);
        const fetched = await fetchRemoteDocument(action.id);
        if (!fetched.ok) {
          onFailure(fetched.error);
          return;
        }
        const migrated = migrateDocument(fetched.value);
        if (!migrated.ok) {
          onFailure({
            kind: 'validation',
            message: `The server copy of “${action.title}” could not be read.`,
            issues: [migrated.error.message],
            status: 422,
          });
          return;
        }
        const saved = await onSaveDocument(migrated.value);
        if (!saved) {
          onFailure({
            kind: 'unavailable',
            message: `The server copy of “${action.title}” arrived but this browser could not store it.`,
            issues: [],
            status: 0,
          });
          return;
        }
        const summary = remote?.find((entry) => entry.id === action.id);
        if (summary) writeSyncMark(action.id, markAfterDownload(summary, migrated.value.updatedAt));
        downloaded += 1;
      }
      setProgress(
        `Transferred ${String(uploaded)} upload${uploaded === 1 ? '' : 's'} and ${String(downloaded)} download${downloaded === 1 ? '' : 's'}.`,
      );
      onNotice('Sync finished. Nothing was overwritten without a conflict decision.');
      setPlan(null);
      setRemote(null);
    } finally {
      setBusy(false);
    }
  }

  const conflicts = plan?.filter((action) => action.kind === 'conflict') ?? [];
  const pending =
    plan?.filter((action) => action.kind === 'upload' || action.kind === 'download') ?? [];

  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-fg text-sm font-semibold">
          Sync with {account.displayName}&rsquo;s server documents
        </h3>
        <span className="text-fg-subtle text-2xs">
          {documentsReady ? `${String(localDocuments.length)} here` : 'Loading local projects…'}
        </span>
      </div>
      <p className="text-fg-muted text-xs">
        A plan is worked out first: every row says why it is there, and a document changed on both
        sides is a conflict you resolve, never an automatic overwrite.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !documentsReady}
          onClick={() => {
            void loadPlan();
          }}
        >
          {busy ? 'Checking…' : 'Check what would change'}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || pending.length === 0 || conflicts.length > 0}
          onClick={() => {
            void runPlan();
          }}
        >
          Run sync
        </Button>
      </div>
      {progress ? (
        <p className="text-fg-subtle text-xs" role="status">
          {progress}
        </p>
      ) : null}

      {plan ? (
        <div data-testid="sync-plan" className="space-y-2">
          {plan.length === 0 ? (
            <p className="text-fg-muted text-xs">Nothing here and nothing on the server.</p>
          ) : (
            <ul aria-label="Planned sync steps" className="divide-ink-800 divide-y">
              {plan.map((action) => (
                <li
                  key={`${action.kind}-${action.id}`}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <span className="text-2xs text-fg-subtle w-20 shrink-0 font-mono uppercase">
                    {action.kind.replace('-', ' ')}
                  </span>
                  <span className="text-fg min-w-0 flex-1 truncate text-xs">{action.title}</span>
                  <span className="text-fg-subtle text-2xs basis-full sm:basis-auto">
                    {action.kind === 'in-sync'
                      ? 'Matches the server.'
                      : action.kind === 'conflict'
                        ? action.reason
                        : action.reason}
                  </span>
                  {action.kind === 'conflict' ? (
                    <span className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => {
                          applyConflict(action, 'local');
                        }}
                      >
                        Keep this browser&rsquo;s copy
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => {
                          applyConflict(action, 'remote');
                        }}
                      >
                        Keep the server&rsquo;s copy
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {conflicts.length > 0 ? (
            <InlineNote tone="warning" title="Resolve the conflicts first">
              {String(conflicts.length)} document{conflicts.length === 1 ? ' has' : 's have'}{' '}
              changed on both sides. Choosing a copy is a decision this panel cannot make for you.
            </InlineNote>
          ) : null}
        </div>
      ) : null}

      {remote ? (
        <p className="text-fg-subtle text-2xs">
          {remote.reduce((total, entry) => total + entry.bytes, 0) > 0
            ? `${String(remote.length)} server documents · ${formatByteSize(remote.reduce((total, entry) => total + entry.bytes, 0))} total.`
            : 'The server holds no documents for this account yet.'}
        </p>
      ) : null}
    </Panel>
  );
}

function SharesPanel({
  onNotice,
  onFailure,
}: {
  readonly onNotice: (notice: string | null) => void;
  readonly onFailure: (failure: ApiFailure | null) => void;
}) {
  const { documents } = useDocuments();
  const [documentId, setDocumentId] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('7');
  const [token, setToken] = useState<string | null>(null);
  const [links, setLinks] = useState<
    readonly {
      readonly id: string;
      readonly createdAt: string;
      readonly expiresAt: string | null;
    }[]
  >([]);
  const [busy, setBusy] = useState(false);

  // Derived rather than synchronised in an effect: the selection is whatever is still in the list,
  // falling back to the first project once the list has loaded.
  const chosenId = documents.some((document) => document.id === documentId)
    ? documentId
    : (documents[0]?.id ?? '');
  const chosen = documents.find((document) => document.id === chosenId) ?? documents[0];

  async function loadLinks(id: string): Promise<void> {
    const listed = await listShareLinks(id);
    if (listed.ok) setLinks(listed.value);
  }

  return (
    <Panel className="space-y-3">
      <h3 className="text-fg text-sm font-semibold">Read-only share links</h3>
      <p className="text-fg-muted text-xs">
        A link opens a snapshot of the saved server copy and works without an account. The token is
        shown once; revoking it takes effect immediately. Anyone with the link can read the document
        until it expires or is revoked.
      </p>
      {documents.length === 0 ? (
        <p className="text-fg-subtle text-xs">Create and save a project before sharing it.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end">
          <Field label="Project">
            <select
              className="border-line-strong bg-ink-950 text-fg w-full rounded-sm border px-2.5 py-1.5 text-sm"
              value={chosenId}
              aria-label="Project to share"
              onChange={(event) => {
                setDocumentId(event.target.value);
                setToken(null);
                void loadLinks(event.target.value);
              }}
            >
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expires (days)">
            <Input
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(event) => {
                setExpiresInDays(event.target.value);
              }}
            />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !chosen}
            onClick={() => {
              if (!chosen) return;
              setBusy(true);
              onFailure(null);
              onNotice(null);
              const days = Number(expiresInDays);
              void createShareLink(chosen.id, Number.isFinite(days) && days > 0 ? days : 7).then(
                (created) => {
                  setBusy(false);
                  if (!created.ok) {
                    onFailure(created.error);
                    return;
                  }
                  setToken(created.value.token);
                  onNotice('Share link created. Copy it now — it is not shown again.');
                  void loadLinks(chosen.id);
                },
              );
            }}
          >
            Create link
          </Button>
        </div>
      )}
      {token ? (
        <div className="space-y-1">
          <p className="text-fg-subtle text-2xs">
            Copy this link now; the server keeps only a digest.
          </p>
          <code
            data-testid="share-link"
            className="border-line bg-ink-950 text-fg block overflow-x-auto rounded-sm border px-2 py-1.5 text-xs"
          >
            {shareUrl(typeof window === 'undefined' ? null : window.location.origin, token)}
          </code>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              const url = shareUrl(
                typeof window === 'undefined' ? null : window.location.origin,
                token,
              );
              const clipboard = navigator.clipboard as Clipboard | undefined;
              if (!clipboard) {
                onNotice('This browser exposes no clipboard; select the link and copy it.');
                return;
              }
              void clipboard
                .writeText(url)
                .then(() => {
                  onNotice('Link copied to the clipboard.');
                })
                .catch(() => {
                  onNotice('The browser refused the clipboard; select the link and copy it.');
                });
            }}
          >
            Copy link
          </Button>
        </div>
      ) : null}
      {links.length > 0 ? (
        <ul aria-label="Existing share links" className="divide-ink-800 divide-y">
          {links.map((link) => (
            <li key={link.id} className="flex items-center gap-2 py-1.5 text-xs">
              <span className="text-fg-subtle text-2xs font-mono">{link.id.slice(0, 8)}</span>
              <span className="text-fg-muted min-w-0 flex-1">{describeExpiry(link.expiresAt)}</span>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  if (!chosen) return;
                  void revokeShareLink(chosen.id, link.id).then((revoked) => {
                    if (!revoked.ok) {
                      onFailure(revoked.error);
                      return;
                    }
                    onNotice('That link no longer works.');
                    void loadLinks(chosen.id);
                  });
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
