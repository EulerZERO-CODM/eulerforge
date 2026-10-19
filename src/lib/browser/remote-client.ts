/**
 * The browser's client for the optional account server.
 *
 * It is a thin, typed wrapper over `fetch`: every call returns a discriminated result with either a
 * parsed value or an {@link ApiFailure} carrying a sentence the UI can show. Nothing here throws on a
 * network error, because "the server is not running" is the *normal* state of this app — it is
 * local-first, and every screen has to keep working when this module's calls fail.
 *
 * Cookies are the session: requests use `credentials: 'same-origin'` and the server sets an HttpOnly
 * cookie, so no token is ever read by JavaScript or written to storage.
 */

import type {
  Account,
  ApiFailure,
  RemoteDocumentSummary,
  ShareLink,
  SessionState,
} from '../../core/account/session';
import {
  networkFailure,
  parseAccount,
  parseApiFailure,
  parseSessionState,
} from '../../core/account/session';
import type { ForgeDocument } from '../../core/documents/types';

export type RemoteResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiFailure };

function success<T>(value: T): RemoteResult<T> {
  return { ok: true, value };
}

function failure<T>(error: ApiFailure): RemoteResult<T> {
  return { ok: false, error };
}

type RequestOptions = {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
};

async function call(path: string, options: RequestOptions = {}): Promise<RemoteResult<unknown>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return failure(networkFailure('The request was cancelled.'));
    }
    return failure(networkFailure());
  }

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  if (!response.ok) return failure(parseApiFailure(parsed, response.status));
  return success(parsed);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function fetchSession(signal?: AbortSignal): Promise<SessionState> {
  const result = await call('/api/auth/session', { ...(signal ? { signal } : {}) });
  if (!result.ok) {
    // A 5xx from the session endpoint is "no account server", not a broken app.
    return {
      status: 'unavailable',
      notice:
        result.error.status === 0
          ? 'The optional server could not be reached. Everything still works in this browser.'
          : result.error.message,
    };
  }
  return parseSessionState(result.value);
}

export async function register(input: {
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
}): Promise<RemoteResult<Account>> {
  const result = await call('/api/auth/register', { method: 'POST', body: input });
  if (!result.ok) return failure(result.error);
  const account = parseAccount(asRecord(result.value)?.account);
  return account.ok ? success(account.value) : failure(parseApiFailure(null, 502));
}

export async function signIn(input: {
  readonly email: string;
  readonly password: string;
}): Promise<RemoteResult<Account>> {
  const result = await call('/api/auth/login', { method: 'POST', body: input });
  if (!result.ok) return failure(result.error);
  const account = parseAccount(asRecord(result.value)?.account);
  return account.ok ? success(account.value) : failure(parseApiFailure(null, 502));
}

export async function signOut(): Promise<RemoteResult<true>> {
  const result = await call('/api/auth/logout', { method: 'POST' });
  return result.ok ? success(true) : failure(result.error);
}

export async function updateProfile(displayName: string): Promise<RemoteResult<Account>> {
  const result = await call('/api/account', { method: 'PATCH', body: { displayName } });
  if (!result.ok) return failure(result.error);
  const account = parseAccount(asRecord(result.value)?.account);
  return account.ok ? success(account.value) : failure(parseApiFailure(null, 502));
}

export async function changePassword(input: {
  readonly currentPassword: string;
  readonly newPassword: string;
}): Promise<RemoteResult<{ readonly revokedSessions: number }>> {
  const result = await call('/api/account/password', { method: 'POST', body: input });
  if (!result.ok) return failure(result.error);
  const revoked = asRecord(result.value)?.revokedSessions;
  return success({ revokedSessions: typeof revoked === 'number' ? revoked : 0 });
}

export async function deleteAccount(): Promise<RemoteResult<{ readonly documents: number }>> {
  const result = await call('/api/account', {
    method: 'DELETE',
    body: { confirm: 'delete my account' },
  });
  if (!result.ok) return failure(result.error);
  const documents = asRecord(result.value)?.documents;
  return success({ documents: typeof documents === 'number' ? documents : 0 });
}

export async function listRemoteDocuments(): Promise<
  RemoteResult<readonly RemoteDocumentSummary[]>
> {
  const result = await call('/api/documents');
  if (!result.ok) return failure(result.error);
  const documents = asRecord(result.value)?.documents;
  if (!Array.isArray(documents)) return failure(parseApiFailure(null, 502));
  return success(
    documents.flatMap((entry) => {
      const record = asRecord(entry);
      if (!record) return [];
      const id = record.id;
      const title = record.title;
      const documentTypeId = record.documentTypeId;
      const revision = record.revision;
      const createdAt = record.createdAt;
      const updatedAt = record.updatedAt;
      const bytes = record.bytes;
      if (
        typeof id !== 'string' ||
        typeof title !== 'string' ||
        typeof documentTypeId !== 'string' ||
        typeof revision !== 'number' ||
        typeof createdAt !== 'string' ||
        typeof updatedAt !== 'string'
      ) {
        return [];
      }
      return [
        {
          id,
          title,
          documentTypeId,
          revision,
          createdAt,
          updatedAt,
          bytes: typeof bytes === 'number' ? bytes : 0,
        },
      ];
    }),
  );
}

async function readDocument(value: unknown): Promise<RemoteResult<ForgeDocument>> {
  const document = asRecord(value)?.document;
  if (!document) return failure(parseApiFailure(null, 502));
  // The server validated this with the platform schema before storing it, but a response is still
  // untrusted: the caller re-validates through the document repository before it is opened.
  return success(document as ForgeDocument);
}

export async function fetchRemoteDocument(id: string): Promise<RemoteResult<ForgeDocument>> {
  const result = await call(`/api/documents/${encodeURIComponent(id)}`);
  if (!result.ok) return failure(result.error);
  return readDocument(result.value);
}

export async function pushDocument(input: {
  readonly document: ForgeDocument;
  readonly baseRevision: number | null;
}): Promise<RemoteResult<{ readonly revision: number; readonly updatedAt: string }>> {
  const result = await call(`/api/documents/${encodeURIComponent(input.document.id)}`, {
    method: 'PUT',
    body: { document: input.document, baseRevision: input.baseRevision },
  });
  if (!result.ok) return failure(result.error);
  const record = asRecord(result.value);
  const revision = record?.revision;
  const updatedAt = record?.updatedAt;
  if (typeof revision !== 'number' || typeof updatedAt !== 'string') {
    return failure(parseApiFailure(null, 502));
  }
  return success({ revision, updatedAt });
}

export async function deleteRemoteDocument(id: string): Promise<RemoteResult<true>> {
  const result = await call(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return result.ok ? success(true) : failure(result.error);
}

export async function createShareLink(
  documentId: string,
  expiresInDays: number,
): Promise<RemoteResult<{ readonly token: string; readonly share: ShareLink }>> {
  const result = await call(`/api/documents/${encodeURIComponent(documentId)}/shares`, {
    method: 'POST',
    body: { expiresInDays },
  });
  if (!result.ok) return failure(result.error);
  const record = asRecord(result.value);
  const token = record?.token;
  const share = asRecord(record?.share);
  if (typeof token !== 'string' || !share) return failure(parseApiFailure(null, 502));
  const id = share.id;
  const createdAt = share.createdAt;
  const expiresAt = share.expiresAt;
  if (typeof id !== 'string' || typeof createdAt !== 'string') {
    return failure(parseApiFailure(null, 502));
  }
  return success({
    token,
    share: {
      id,
      documentId,
      createdAt,
      expiresAt: typeof expiresAt === 'string' ? expiresAt : null,
    },
  });
}

export async function listShareLinks(
  documentId: string,
): Promise<RemoteResult<readonly ShareLink[]>> {
  const result = await call(`/api/documents/${encodeURIComponent(documentId)}/shares`);
  if (!result.ok) return failure(result.error);
  const shares = asRecord(result.value)?.shares;
  if (!Array.isArray(shares)) return failure(parseApiFailure(null, 502));
  return success(
    shares.flatMap((entry) => {
      const record = asRecord(entry);
      if (!record || typeof record.id !== 'string' || typeof record.createdAt !== 'string')
        return [];
      return [
        {
          id: record.id,
          documentId: typeof record.documentId === 'string' ? record.documentId : documentId,
          createdAt: record.createdAt,
          expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : null,
        },
      ];
    }),
  );
}

export async function revokeShareLink(
  documentId: string,
  shareId: string,
): Promise<RemoteResult<true>> {
  const result = await call(
    `/api/documents/${encodeURIComponent(documentId)}/shares/${encodeURIComponent(shareId)}`,
    { method: 'DELETE' },
  );
  return result.ok ? success(true) : failure(result.error);
}
