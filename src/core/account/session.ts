/**
 * Accounts, sessions and share links — the framework-free part.
 *
 * The server is optional and the app must behave identically without it, so the rules that decide
 * what a signed-in state *means* live here rather than inside a form component: how a response is
 * read, which failures are worth showing, and what a share link looks like.
 *
 * Everything is plain data and pure functions, and every response body is treated as untrusted.
 */

import { err, forgeError, ok, type Result } from '../result';

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_DISPLAY_NAME_LENGTH = 60;

export type Account = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SessionState =
  | { readonly status: 'anonymous' }
  | {
      readonly status: 'signed-in';
      readonly account: Account;
      readonly activeSessions: number | null;
    }
  | {
      readonly status: 'unavailable';
      /** A sentence for the UI. The app is fully usable in this state. */
      readonly notice: string;
    };

export type RemoteDocumentSummary = {
  readonly id: string;
  readonly title: string;
  readonly documentTypeId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly bytes: number;
};

export type ShareLink = {
  readonly id: string;
  readonly documentId: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
};

export type ApiErrorKind =
  | 'unauthenticated'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'unavailable'
  | 'rate-limited'
  | 'bad-request'
  | 'network';

export type ApiFailure = {
  readonly kind: ApiErrorKind;
  readonly message: string;
  readonly issues: readonly string[];
  readonly serverRevision?: number;
  readonly updatedAt?: string;
  readonly status: number;
};

const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | null {
  const normalised = normaliseEmail(email);
  if (normalised.length === 0) return 'Enter your email address.';
  if (normalised.length > 254) return 'That email address is too long.';
  return EMAIL.test(normalised) ? null : 'That does not look like an email address.';
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${String(MAX_PASSWORD_LENGTH)} characters.`;
  }
  if (password.trim().length === 0) return 'A password of only spaces is not a password.';
  return null;
}

export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Enter a name to show.';
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return `Use at most ${String(MAX_DISPLAY_NAME_LENGTH)} characters.`;
  }
  return null;
}

export function validateRegistration(input: {
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
}): readonly string[] {
  return [
    validateEmail(input.email),
    validateDisplayName(input.displayName),
    validatePassword(input.password),
  ].filter((issue): issue is string => issue !== null);
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parses an account from a response body. A malformed body is a refusal, never a half-account. */
export function parseAccount(value: unknown): Result<Account> {
  const record = asRecord(value);
  if (!record) return err(forgeError('validation-failed', 'The server sent no account.'));
  const id = readString(record, 'id');
  const email = readString(record, 'email');
  const displayName = readString(record, 'displayName');
  const createdAt = readString(record, 'createdAt');
  const updatedAt = readString(record, 'updatedAt');
  if (!id || !email || !displayName || !createdAt || !updatedAt) {
    return err(
      forgeError('validation-failed', 'The server sent an account this build cannot read.', {
        detail: 'One of id, email, displayName, createdAt or updatedAt was missing.',
      }),
    );
  }
  return ok({ id, email, displayName, createdAt, updatedAt });
}

export function parseSessionState(body: unknown): SessionState {
  const record = asRecord(body);
  if (!record) {
    return {
      status: 'unavailable',
      notice: 'The account server answered with something this build cannot read.',
    };
  }
  if (typeof record.unavailable === 'string') {
    return { status: 'unavailable', notice: record.unavailable };
  }
  if (record.account === null || record.account === undefined) return { status: 'anonymous' };
  const account = parseAccount(record.account);
  if (!account.ok) return { status: 'unavailable', notice: account.error.message };
  const sessions = readNumber(record, 'activeSessions');
  return {
    status: 'signed-in',
    account: account.value,
    activeSessions: sessions !== null && Number.isInteger(sessions) ? sessions : null,
  };
}

export function parseApiFailure(body: unknown, status: number): ApiFailure {
  const record = asRecord(body);
  const error = record ? asRecord(record.error) : null;
  const kind = error ? readString(error, 'kind') : null;
  const message = error ? readString(error, 'message') : null;
  const issuesValue = error?.issues;
  const issues = Array.isArray(issuesValue)
    ? issuesValue.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const serverRevision = error ? readNumber(error, 'serverRevision') : null;
  const updatedAt = error ? readString(error, 'updatedAt') : null;
  return {
    kind: isErrorKind(kind) ? kind : status === 0 ? 'network' : 'bad-request',
    message: message ?? 'The request did not succeed.',
    issues,
    status,
    ...(serverRevision === null ? {} : { serverRevision }),
    ...(updatedAt === null ? {} : { updatedAt }),
  };
}

function isErrorKind(value: string | null): value is ApiErrorKind {
  return (
    value === 'unauthenticated' ||
    value === 'not-found' ||
    value === 'conflict' ||
    value === 'validation' ||
    value === 'unavailable' ||
    value === 'rate-limited' ||
    value === 'bad-request'
  );
}

/** A failure is worth a retry when nothing about the form needs to change first. */
export function isRetryable(failure: ApiFailure): boolean {
  return (
    failure.kind === 'unavailable' || failure.kind === 'network' || failure.kind === 'rate-limited'
  );
}

export function networkFailure(message = 'The server could not be reached.'): ApiFailure {
  return { kind: 'network', message, issues: [], status: 0 };
}

/**
 * The absolute URL for a share link.
 *
 * A relative path is returned when no origin is supplied, so the UI never invents a host name.
 */
export function shareUrl(origin: string | null, token: string): string {
  const path = `/shared/${encodeURIComponent(token)}`;
  if (origin === null) return path;
  return `${origin.replace(/\/+$/, '')}${path}`;
}

/** A caption for an expiry that stays true even if the clock is slightly off. */
export function describeExpiry(iso: string | null, now = new Date()): string {
  if (iso === null) return 'No expiry — revoke it when you are done.';
  const expires = new Date(iso);
  if (Number.isNaN(expires.getTime())) return 'Expiry unknown.';
  const ms = expires.getTime() - now.getTime();
  if (ms <= 0) return 'Expired.';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `Expires in ${String(days)} day${days === 1 ? '' : 's'}.`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `Expires in ${String(hours)} hour${hours === 1 ? '' : 's'}.`;
}

/** What the account panel says about ownership. Kept here so the wording is testable. */
export const OWNERSHIP_NOTE =
  'Work stays in this browser unless you choose to sync it. Signing in creates an account on the optional server, and deleting the account removes every document, session and share link that account owns from that server. Local copies are not touched.';
