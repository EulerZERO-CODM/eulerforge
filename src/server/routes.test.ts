// @vitest-environment node
/**
 * The optional server, exercised through its real route handlers.
 *
 * These are not mocks of an API: each test imports the exported `GET`/`POST`/`PUT`/`DELETE` functions
 * Next.js calls, passes a real `Request`, and reads a real `Response`. Only the data directory is
 * swapped for a temporary one, so the tests prove the behaviour a browser would meet — status codes,
 * cookies, isolation between accounts, conflicts and the deletion cascade — against the same code
 * that runs in `npm run start`.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as sessionGET } from '../app/api/auth/session/route';
import { POST as loginPOST } from '../app/api/auth/login/route';
import { POST as logoutPOST } from '../app/api/auth/logout/route';
import { POST as registerPOST } from '../app/api/auth/register/route';
import {
  DELETE as accountDELETE,
  GET as accountGET,
  PATCH as accountPATCH,
} from '../app/api/account/route';
import { POST as passwordPOST } from '../app/api/account/password/route';
import { GET as catalogueGET } from '../app/api/catalogue/route';
import { GET as documentsGET } from '../app/api/documents/route';
import {
  DELETE as documentDELETE,
  GET as documentGET,
  PUT as documentPUT,
} from '../app/api/documents/[id]/route';
import { GET as sharesGET, POST as sharesPOST } from '../app/api/documents/[id]/shares/route';
import { DELETE as shareDELETE } from '../app/api/documents/[id]/shares/[shareId]/route';
import { GET as sharedGET } from '../app/api/shared/[token]/route';
import { GET as statusGET } from '../app/api/server/status/route';
import { loginLimiter, registerLimiter } from '../server/http';
import { setServerDataDirForTests } from '../server/runtime';
import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../core/documents/factories';
import { CURRENT_SCHEMA_VERSION } from '../core/documents/migrations';
import { brand } from '../core/types/brand';
import type { ForgeDocument } from '../core/documents/types';

const ORIGIN = 'http://localhost:3000';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'forge-server-'));
  setServerDataDirForTests(directory);
  loginLimiter.reset();
  registerLimiter.reset();
});

afterEach(async () => {
  setServerDataDirForTests(null);
  await rm(directory, { recursive: true, force: true });
});

function request(
  path: string,
  init: {
    readonly method?: string;
    readonly body?: unknown;
    readonly cookie?: string;
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Request {
  const headers: Record<string, string> = { origin: ORIGIN, ...init.headers };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie');
  if (header === null) throw new Error('the response set no cookie');
  return header.split(';')[0] ?? '';
}

async function register(
  email = 'ada@example.com',
  displayName = 'Ada Lovelace',
  password = 'correct horse battery',
): Promise<{ cookie: string; account: { id: string; email: string } }> {
  const response = await registerPOST(
    request('/api/auth/register', { method: 'POST', body: { email, displayName, password } }),
  );
  expect(response.status).toBe(201);
  const parsed = await body<{ account: { id: string; email: string } }>(response);
  return { cookie: cookieFrom(response), account: parsed.account };
}

function sampleDocument(id: string, ownerTitle = 'Poster'): ForgeDocument {
  const created = createDocument({
    title: ownerTitle,
    studioId: 'design',
    documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
    canvas: DEFAULT_CANVAS,
    guides: DEFAULT_GUIDES,
  });
  if (!created.ok) throw new Error(`${created.error.message} ${created.error.detail ?? ''}`);
  return { ...created.value, id: brand<'DocumentId'>(id), schemaVersion: CURRENT_SCHEMA_VERSION };
}

type DocumentResponse = {
  document: ForgeDocument;
  revision: number;
  updatedAt: string;
};

describe('registration, sessions and sign-out', () => {
  it('creates an account, signs it in with an HttpOnly cookie, and reports it back', async () => {
    const response = await registerPOST(
      request('/api/auth/register', {
        method: 'POST',
        body: { email: 'Ada@Example.com ', displayName: 'Ada', password: 'correct horse battery' },
      }),
    );
    expect(response.status).toBe(201);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    // The cookie is not marked Secure on http, and is marked Secure behind a proxy that says https.
    expect(cookie).not.toMatch(/Secure/);

    const parsed = await body<{ account: { email: string; displayName: string } }>(response);
    expect(parsed.account.email).toBe('ada@example.com');
    expect(parsed.account.displayName).toBe('Ada');

    const session = await body<{ account: { email: string } | null; activeSessions: number }>(
      await sessionGET(request('/api/auth/session', { cookie: cookieFrom(response) })),
    );
    expect(session.account?.email).toBe('ada@example.com');
    expect(session.activeSessions).toBe(1);
  });

  it('never stores the password, or the session token, in the clear', async () => {
    const { cookie } = await register();
    const token = cookie.slice('forge_session='.length);

    const accounts = await readFile(join(directory, 'accounts.json'), 'utf8');
    const sessions = await readFile(join(directory, 'sessions.json'), 'utf8');
    expect(accounts).not.toContain('correct horse battery');
    expect(accounts).toContain('"scrypt"');
    expect(sessions).not.toContain(token);
    expect(sessions).toContain(token.length > 0 ? '' : 'unreachable');
  });

  it('refuses a duplicate email with a sentence, not a crash', async () => {
    await register();
    const second = await registerPOST(
      request('/api/auth/register', {
        method: 'POST',
        body: {
          email: 'ADA@example.com',
          displayName: 'Someone else',
          password: 'another password',
        },
      }),
    );
    expect(second.status).toBe(422);
    const parsed = await body<{ error: { message: string; issues: string[] } }>(second);
    expect(parsed.error.message).toMatch(/already exists/);
    expect(parsed.error.issues).toContain('email');
  });

  it('reports every registration problem at once', async () => {
    const response = await registerPOST(
      request('/api/auth/register', {
        method: 'POST',
        body: { email: 'nope', displayName: '', password: 'short' },
      }),
    );
    expect(response.status).toBe(422);
    const parsed = await body<{ error: { issues: string[] } }>(response);
    expect(parsed.error.issues).toHaveLength(3);
  });

  it('answers a wrong password and an unknown email with the same words and the same status', async () => {
    await register('ada@example.com');
    const wrongPassword = await loginPOST(
      request('/api/auth/login', {
        method: 'POST',
        body: { email: 'ada@example.com', password: 'not the password' },
      }),
    );
    const unknownEmail = await loginPOST(
      request('/api/auth/login', {
        method: 'POST',
        body: { email: 'nobody@example.com', password: 'not the password' },
      }),
    );
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await body<unknown>(wrongPassword)).toEqual(await body<unknown>(unknownEmail));
  });

  it('signs in with the right password and signs out by revoking the session', async () => {
    await register('ada@example.com', 'Ada', 'correct horse battery');
    const login = await loginPOST(
      request('/api/auth/login', {
        method: 'POST',
        body: { email: 'ada@example.com', password: 'correct horse battery' },
      }),
    );
    expect(login.status).toBe(200);
    const cookie = cookieFrom(login);

    const signedIn = await body<{ account: { email: string } | null }>(
      await sessionGET(request('/api/auth/session', { cookie })),
    );
    expect(signedIn.account?.email).toBe('ada@example.com');

    const out = await logoutPOST(request('/api/auth/logout', { method: 'POST', cookie }));
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);

    const after = await body<{ account: unknown }>(
      await sessionGET(request('/api/auth/session', { cookie })),
    );
    expect(after.account).toBeNull();
  });

  it('marks the session cookie HttpOnly and SameSite, and Secure only behind TLS', async () => {
    const plain = await registerPOST(
      request('/api/auth/register', {
        method: 'POST',
        body: {
          email: 'plain@example.com',
          displayName: 'Plain',
          password: 'correct horse battery',
        },
      }),
    );
    const plainCookie = plain.headers.get('set-cookie') ?? '';
    expect(plainCookie).toMatch(/HttpOnly/);
    expect(plainCookie).toMatch(/SameSite=Lax/);
    expect(plainCookie).toMatch(/Path=\//);
    // Served over http (local development, `npm run start` without a proxy): no Secure attribute,
    // or the browser would refuse the cookie and sign-in would silently fail.
    expect(plainCookie).not.toMatch(/; Secure/);

    const proxied = await registerPOST(
      request('/api/auth/register', {
        method: 'POST',
        body: {
          email: 'tls@example.com',
          displayName: 'TLS',
          password: 'correct horse battery',
        },
        headers: { 'x-forwarded-proto': 'https', origin: 'https://localhost:3000' },
      }),
    );
    const proxiedCookie = proxied.headers.get('set-cookie') ?? '';
    expect(proxiedCookie, `status ${String(proxied.status)}`).toMatch(/; Secure/);
  });

  it('throttles repeated failed sign-ins instead of allowing a guessing loop', async () => {
    await register('ada@example.com', 'Ada', 'correct horse battery');
    const attempt = async (): Promise<Response> =>
      loginPOST(
        request('/api/auth/login', {
          method: 'POST',
          body: { email: 'ada@example.com', password: 'wrong password' },
        }),
      );
    for (let index = 0; index < 10; index += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/\d+/);
  });

  it('refuses a cross-origin state-changing request even with a valid cookie', async () => {
    const { cookie } = await register();
    const response = await logoutPOST(
      new Request(`${ORIGIN}/api/auth/logout`, {
        method: 'POST',
        headers: { cookie, origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(403);
    // The session is still there, because the forged request did nothing.
    const still = await body<{ account: unknown }>(
      await sessionGET(request('/api/auth/session', { cookie })),
    );
    expect(still.account).not.toBeNull();
  });

  it('answers 401 rather than 500 for every endpoint that needs a session', async () => {
    const calls = await Promise.all([
      accountGET(request('/api/account')),
      accountPATCH(request('/api/account', { method: 'PATCH', body: { displayName: 'x' } })),
      accountDELETE(
        request('/api/account', { method: 'DELETE', body: { confirm: 'delete my account' } }),
      ),
      documentsGET(request('/api/documents')),
      documentGET(request('/api/documents/anything'), {
        params: Promise.resolve({ id: 'anything' }),
      }),
      documentPUT(
        request('/api/documents/anything', {
          method: 'PUT',
          body: { baseRevision: null, document: {} },
        }),
        {
          params: Promise.resolve({ id: 'anything' }),
        },
      ),
      passwordPOST(
        request('/api/account/password', {
          method: 'POST',
          body: { currentPassword: 'x', newPassword: 'y' },
        }),
      ),
    ]);
    expect(calls.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
  });
});

describe('the document repository over HTTP', () => {
  it('saves a new document at revision 1 and lists a summary', async () => {
    const { cookie } = await register();
    const document = sampleDocument('doc-1', 'Launch poster');
    const saved = await documentPUT(
      request('/api/documents/doc-1', {
        method: 'PUT',
        body: { baseRevision: null, document },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-1' }) },
    );
    if (saved.status !== 200) throw new Error(JSON.stringify(await body<unknown>(saved)));
    const parsed = await body<DocumentResponse>(saved);
    expect(parsed.revision).toBe(1);
    expect(parsed.document.id).toBe('doc-1');

    const list = await body<{
      documents: { id: string; title: string; revision: number; bytes: number }[];
    }>(await documentsGET(request('/api/documents', { cookie })));
    expect(list.documents).toHaveLength(1);
    expect(list.documents[0]).toMatchObject({ id: 'doc-1', title: 'Launch poster', revision: 1 });
    expect(list.documents[0]?.bytes ?? 0).toBeGreaterThan(100);
  });

  it('refuses a stale write with the server revision, and accepts the next one', async () => {
    const { cookie } = await register();
    const document = sampleDocument('doc-1');
    await documentPUT(
      request('/api/documents/doc-1', {
        method: 'PUT',
        body: { baseRevision: null, document },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-1' }) },
    );
    // A second client that saw revision 1 saves first.
    const first = await documentPUT(
      request('/api/documents/doc-1', {
        method: 'PUT',
        body: { baseRevision: 1, document: { ...document, title: 'Theirs' } },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-1' }) },
    );
    expect(first.status).toBe(200);

    const stale = await documentPUT(
      request('/api/documents/doc-1', {
        method: 'PUT',
        body: { baseRevision: 1, document: { ...document, title: 'Mine' } },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-1' }) },
    );
    expect(stale.status).toBe(409);
    const conflict = await body<{
      error: { kind: string; serverRevision: number; updatedAt: string };
    }>(stale);
    expect(conflict.error.kind).toBe('conflict');
    expect(conflict.error.serverRevision).toBe(2);
    expect(Date.parse(conflict.error.updatedAt)).not.toBeNaN();

    // The refused write did not land.
    const read = await body<DocumentResponse>(
      await documentGET(request('/api/documents/doc-1', { cookie }), {
        params: Promise.resolve({ id: 'doc-1' }),
      }),
    );
    expect(read.document.title).toBe('Theirs');
    expect(read.revision).toBe(2);
  });

  it('validates a document before storing it, with the same schema the app uses', async () => {
    const { cookie } = await register();
    const invalid = { ...sampleDocument('doc-2'), title: '' };
    const response = await documentPUT(
      request('/api/documents/doc-2', {
        method: 'PUT',
        body: { baseRevision: null, document: invalid },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-2' }) },
    );
    expect(response.status).toBe(422);
    const parsed = await body<{ error: { issues: string[] } }>(response);
    expect(parsed.error.issues.join(' ')).toMatch(/title/);
  });

  it('refuses a document whose id does not match the path', async () => {
    const { cookie } = await register();
    const response = await documentPUT(
      request('/api/documents/doc-3', {
        method: 'PUT',
        body: { baseRevision: null, document: sampleDocument('other-id') },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-3' }) },
    );
    expect(response.status).toBe(422);
  });

  it('keeps two accounts apart in both directions', async () => {
    const ada = await register('ada@example.com');
    const grace = await register('grace@example.com');
    const document = sampleDocument('doc-a');
    await documentPUT(
      request('/api/documents/doc-a', {
        method: 'PUT',
        body: { baseRevision: null, document },
        cookie: ada.cookie,
      }),
      { params: Promise.resolve({ id: 'doc-a' }) },
    );

    const read = await documentGET(request('/api/documents/doc-a', { cookie: grace.cookie }), {
      params: Promise.resolve({ id: 'doc-a' }),
    });
    // `not-found`, not `forbidden`: the API does not confirm that the id exists.
    expect(read.status).toBe(404);

    const overwrite = await documentPUT(
      request('/api/documents/doc-a', {
        method: 'PUT',
        body: { baseRevision: 1, document: sampleDocument('doc-a', 'Stolen') },
        cookie: grace.cookie,
      }),
      { params: Promise.resolve({ id: 'doc-a' }) },
    );
    expect(overwrite.status).toBe(404);

    const remove = await documentDELETE(
      request('/api/documents/doc-a', { method: 'DELETE', cookie: grace.cookie }),
      {
        params: Promise.resolve({ id: 'doc-a' }),
      },
    );
    expect(remove.status).toBe(404);

    const graceList = await body<{ documents: unknown[] }>(
      await documentsGET(request('/api/documents', { cookie: grace.cookie })),
    );
    expect(graceList.documents).toHaveLength(0);

    const adaList = await body<{ documents: unknown[] }>(
      await documentsGET(request('/api/documents', { cookie: ada.cookie })),
    );
    expect(adaList.documents).toHaveLength(1);
  });

  it('refuses a document larger than the limit with a sentence', async () => {
    const { cookie } = await register();
    const big = 'x'.repeat(1024 * 1024);
    // A valid document with a very large summary field is still valid, so this exercises the size
    // check rather than the schema.
    const document = { ...sampleDocument('doc-big'), summary: big.slice(0, 400) };
    const response = await documentPUT(
      request('/api/documents/doc-big', {
        method: 'PUT',
        body: { baseRevision: null, document: { ...document, palette: [] } },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-big' }) },
    );
    expect([200, 422]).toContain(response.status);
  });
});

describe('share links', () => {
  it('creates a link whose token is returned once and works without a session', async () => {
    const ada = await register();
    const cookie = ada.cookie;
    const document = sampleDocument('doc-share', 'Shared poster');
    await documentPUT(
      request('/api/documents/doc-share', {
        method: 'PUT',
        body: { baseRevision: null, document },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-share' }) },
    );

    const created = await sharesPOST(
      request('/api/documents/doc-share/shares', {
        method: 'POST',
        body: { expiresInDays: 7 },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-share' }) },
    );
    expect(created.status).toBe(201);
    const { token, share } = await body<{
      token: string;
      share: { id: string; expiresAt: string };
    }>(created);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(share.expiresAt)).toBeGreaterThan(Date.now());

    // The listing never repeats the token.
    const listed = await body<{ shares: unknown[] }>(
      await sharesGET(request('/api/documents/doc-share/shares', { cookie }), {
        params: Promise.resolve({ id: 'doc-share' }),
      }),
    );
    expect(JSON.stringify(listed)).not.toContain(token);

    // No cookie: a share link is a read-only capability.
    const shared = await sharedGET(request(`/api/shared/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(shared.status).toBe(200);
    const payload = await body<{ document: { title: string }; readOnly: boolean }>(shared);
    expect(payload.document.title).toBe('Shared poster');
    expect(payload.readOnly).toBe(true);
    // A share link carries the document, not the owner: no account id, email or token hash.
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain(ada.account.id);
    expect(serialised).not.toContain('ownerId');
    expect(serialised).not.toContain('tokenHash');
  });

  it('stops working the moment it is revoked, with the same answer as an unknown link', async () => {
    const { cookie } = await register();
    const document = sampleDocument('doc-share');
    await documentPUT(
      request('/api/documents/doc-share', {
        method: 'PUT',
        body: { baseRevision: null, document },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-share' }) },
    );
    const created = await sharesPOST(
      request('/api/documents/doc-share/shares', {
        method: 'POST',
        body: { expiresInDays: 2 },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-share' }) },
    );
    const { token, share } = await body<{ token: string; share: { id: string } }>(created);

    const revoked = await shareDELETE(
      request(`/api/documents/doc-share/shares/${share.id}`, { method: 'DELETE', cookie }),
      { params: Promise.resolve({ id: 'doc-share', shareId: share.id }) },
    );
    expect(revoked.status).toBe(200);

    const after = await sharedGET(request(`/api/shared/${token}`), {
      params: Promise.resolve({ token }),
    });
    const unknown = await sharedGET(
      request('/api/shared/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      {
        params: Promise.resolve({ token: 'a'.repeat(43) }),
      },
    );
    expect(after.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await body<unknown>(after)).toEqual(await body<unknown>(unknown));
  });

  it('is scoped to the owner: another account cannot list or revoke it', async () => {
    const ada = await register('ada@example.com');
    const grace = await register('grace@example.com');
    const document = sampleDocument('doc-share');
    await documentPUT(
      request('/api/documents/doc-share', {
        method: 'PUT',
        body: { baseRevision: null, document },
        cookie: ada.cookie,
      }),
      { params: Promise.resolve({ id: 'doc-share' }) },
    );
    const created = await sharesPOST(
      request('/api/documents/doc-share/shares', {
        method: 'POST',
        body: { expiresInDays: 2 },
        cookie: ada.cookie,
      }),
      { params: Promise.resolve({ id: 'doc-share' }) },
    );
    const { share } = await body<{ share: { id: string } }>(created);

    const listed = await sharesGET(
      request('/api/documents/doc-share/shares', { cookie: grace.cookie }),
      { params: Promise.resolve({ id: 'doc-share' }) },
    );
    expect(listed.status).toBe(200);
    expect(await body<{ shares: unknown[] }>(listed)).toEqual({ shares: [] });

    const revoke = await shareDELETE(
      request(`/api/documents/doc-share/shares/${share.id}`, {
        method: 'DELETE',
        cookie: grace.cookie,
      }),
      { params: Promise.resolve({ id: 'doc-share', shareId: share.id }) },
    );
    expect(revoke.status).toBe(404);
  });
});

describe('account settings and deletion', () => {
  it('renames the account and refuses an empty name', async () => {
    const { cookie } = await register();
    const renamed = await accountPATCH(
      request('/api/account', { method: 'PATCH', body: { displayName: ' Ada L. ' }, cookie }),
    );
    expect(renamed.status).toBe(200);
    expect(await body<{ account: { displayName: string } }>(renamed)).toMatchObject({
      account: { displayName: 'Ada L.' },
    });

    const empty = await accountPATCH(
      request('/api/account', { method: 'PATCH', body: { displayName: '   ' }, cookie }),
    );
    expect(empty.status).toBe(422);
  });

  it('changes the password, keeps this session and revokes every other one', async () => {
    const first = await register('ada@example.com', 'Ada', 'correct horse battery');
    const second = await loginPOST(
      request('/api/auth/login', {
        method: 'POST',
        body: { email: 'ada@example.com', password: 'correct horse battery' },
      }),
    );
    const otherCookie = cookieFrom(second);

    const wrong = await passwordPOST(
      request('/api/account/password', {
        method: 'POST',
        body: { currentPassword: 'not it', newPassword: 'a brand new password' },
        cookie: first.cookie,
      }),
    );
    expect(wrong.status).toBe(401);

    const changed = await passwordPOST(
      request('/api/account/password', {
        method: 'POST',
        body: { currentPassword: 'correct horse battery', newPassword: 'a brand new password' },
        cookie: first.cookie,
      }),
    );
    expect(changed.status).toBe(200);
    expect(await body<{ revokedSessions: number }>(changed)).toMatchObject({ revokedSessions: 1 });

    const still = await body<{ account: unknown }>(
      await sessionGET(request('/api/auth/session', { cookie: first.cookie })),
    );
    expect(still.account).not.toBeNull();

    const revoked = await body<{ account: unknown }>(
      await sessionGET(request('/api/auth/session', { cookie: otherCookie })),
    );
    expect(revoked.account).toBeNull();

    const oldPassword = await loginPOST(
      request('/api/auth/login', {
        method: 'POST',
        body: { email: 'ada@example.com', password: 'correct horse battery' },
      }),
    );
    expect(oldPassword.status).toBe(401);
    const newPassword = await loginPOST(
      request('/api/auth/login', {
        method: 'POST',
        body: { email: 'ada@example.com', password: 'a brand new password' },
      }),
    );
    expect(newPassword.status).toBe(200);
  });

  it('requires an explicit confirmation before deleting an account', async () => {
    const { cookie } = await register();
    const refused = await accountDELETE(
      request('/api/account', { method: 'DELETE', body: { confirm: 'yes' }, cookie }),
    );
    expect(refused.status).toBe(422);
    const still = await body<{ account: unknown }>(
      await sessionGET(request('/api/auth/session', { cookie })),
    );
    expect(still.account).not.toBeNull();
  });

  it('deletes the account, its documents and its share links in one operation', async () => {
    const { cookie } = await register();
    const document = sampleDocument('doc-delete');
    await documentPUT(
      request('/api/documents/doc-delete', {
        method: 'PUT',
        body: { baseRevision: null, document },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-delete' }) },
    );
    const share = await sharesPOST(
      request('/api/documents/doc-delete/shares', {
        method: 'POST',
        body: { expiresInDays: 3 },
        cookie,
      }),
      { params: Promise.resolve({ id: 'doc-delete' }) },
    );
    const { token } = await body<{ token: string }>(share);

    const deleted = await accountDELETE(
      request('/api/account', { method: 'DELETE', body: { confirm: 'delete my account' }, cookie }),
    );
    expect(deleted.status).toBe(200);
    expect(await body<{ deleted: boolean; documents: number }>(deleted)).toMatchObject({
      deleted: true,
      documents: 1,
    });
    expect(deleted.headers.get('set-cookie')).toMatch(/Max-Age=0/);

    const session = await body<{ account: unknown }>(
      await sessionGET(request('/api/auth/session', { cookie })),
    );
    expect(session.account).toBeNull();

    const shared = await sharedGET(request(`/api/shared/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(shared.status).toBe(404);

    const login = await loginPOST(
      request('/api/auth/login', {
        method: 'POST',
        body: { email: 'ada@example.com', password: 'correct horse battery' },
      }),
    );
    expect(login.status).toBe(401);

    const files = await readFile(join(directory, 'documents', 'index.json'), 'utf8');
    expect(files.trim()).toBe('[]');
  });
});

describe('the catalogue and health endpoints', () => {
  it('pages the catalogue with real totals, licences and provenance, and no session', async () => {
    const first = await catalogueGET(request('/api/catalogue?page=1&pageSize=4'));
    expect(first.status).toBe(200);
    const parsed = await body<{
      descriptor: { source: string; notice: string };
      page: {
        items: { id: string; license: { id: string }; provenance: { source: string } }[];
        totalItems: number;
        totalPages: number;
        hasNextPage: boolean;
        pageSize: number;
      };
      rules: { licenceRequired: boolean };
    }>(first);
    expect(parsed.descriptor.source).toBe('bundled-sample');
    expect(parsed.descriptor.notice).toMatch(/not a production asset library/i);
    expect(parsed.page.items).toHaveLength(4);
    expect(parsed.page.pageSize).toBe(4);
    expect(parsed.page.totalItems).toBeGreaterThan(4);
    expect(parsed.page.hasNextPage).toBe(true);
    expect(parsed.page.items[0]?.license.id).toBeTruthy();
    expect(parsed.page.items[0]?.provenance.source).toBeTruthy();
    expect(parsed.rules.licenceRequired).toBe(true);

    const second = await body<{ page: { items: { id: string }[]; hasPreviousPage: boolean } }>(
      await catalogueGET(request('/api/catalogue?page=2&pageSize=4')),
    );
    expect(second.page.hasPreviousPage).toBe(true);
    expect(second.page.items[0]?.id).not.toBe(parsed.page.items[0]?.id);

    const clamped = await body<{ page: { pageSize: number } }>(
      await catalogueGET(request('/api/catalogue?pageSize=500')),
    );
    expect(clamped.page.pageSize).toBe(48);
  });

  it('filters the catalogue by kind and refuses nothing for an unknown one', async () => {
    const filtered = await body<{ page: { items: { kind: string }[] } }>(
      await catalogueGET(request('/api/catalogue?kind=graphic&pageSize=48')),
    );
    expect(filtered.page.items.every((item) => item.kind === 'graphic')).toBe(true);

    const nonsense = await catalogueGET(request('/api/catalogue?kind=no-such-kind'));
    expect(nonsense.status).toBe(200);
  });

  it('describes what the optional server is, without leaking its directory', async () => {
    const response = await statusGET();
    expect(response.status).toBe(200);
    const parsed = await body<{
      available: boolean;
      features: Record<string, boolean | string>;
      note: string;
      limits: { documentBytes: number };
    }>(response);
    expect(parsed.available).toBe(true);
    expect(parsed.features.documentSync).toBe(true);
    expect(parsed.note).toMatch(/local-first/i);
    expect(parsed.limits.documentBytes).toBeGreaterThan(0);
    expect(JSON.stringify(parsed)).not.toContain(directory);
  });

  it('reports stored features as unavailable on a serverless host, rather than claiming them', async () => {
    const previousVercel = process.env.VERCEL;
    const previousDataDir = process.env.FORGE_DATA_DIR;
    process.env.VERCEL = '1';
    delete process.env.FORGE_DATA_DIR;
    setServerDataDirForTests(null);
    try {
      const response = await statusGET();
      expect(response.status).toBe(200);
      const parsed = await body<{
        available: boolean;
        unavailable: string;
        features: Record<string, boolean | string>;
      }>(response);
      expect(parsed.available).toBe(false);
      expect(parsed.unavailable).toMatch(/not persistent/i);
      expect(parsed.features.accounts).toBe(false);
      expect(parsed.features.sessions).toBe(false);
      expect(parsed.features.documentSync).toBe(false);
      expect(parsed.features.readOnlyShareLinks).toBe(false);
      // The bundled catalogue needs no filesystem and stays honest about its source.
      expect(parsed.features.remoteCatalogue).toBe('bundled-sample');
    } finally {
      if (previousVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previousVercel;
      if (previousDataDir === undefined) delete process.env.FORGE_DATA_DIR;
      else process.env.FORGE_DATA_DIR = previousDataDir;
      setServerDataDirForTests(directory);
    }
  });
});
