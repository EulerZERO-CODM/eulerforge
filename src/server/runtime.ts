/**
 * Process-level wiring for the optional server.
 *
 * One `ForgeStore` per data directory, initialised once and shared by every route handler. The
 * directory comes from `FORGE_DATA_DIR` (default `.data` beside the app), and tests can point it at a
 * temporary directory with `setServerDataDirForTests`. No credential is read from an environment
 * variable: passwords are user-chosen and hashed, session tokens are generated, and the data
 * directory is the only piece of configuration that matters.
 */

import { join } from 'node:path';

import { readCookie } from './http';
import { hashToken, looksLikeToken, SESSION_COOKIE } from './sessions';
import { ForgeStore, type AccountView, type StoreResult } from './store';

let overrideDirectory: string | null = null;
const stores = new Map<string, Promise<StoreResult<ForgeStore>>>();

export function serverDataDir(): string {
  return overrideDirectory ?? process.env.FORGE_DATA_DIR ?? join(process.cwd(), '.data');
}

/**
 * Explains why the file store cannot be used on a serverless platform, or `null` when it can.
 *
 * A serverless deployment (Vercel and friends) gives each invocation a fresh, mostly read-only
 * filesystem. Writing accounts and documents there would look like it worked until the instance was
 * recycled — the worst kind of data loss, because the interface would have promised a save. The
 * account server is therefore *explicitly unavailable* on such a host unless the operator points
 * `FORGE_DATA_DIR` at a real persistent volume; the app itself stays fully local-first either way.
 */
export function serverlessStorageProblem(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const serverless = env.VERCEL !== undefined || env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
  if (!serverless) return null;
  if (env.FORGE_DATA_DIR !== undefined && env.FORGE_DATA_DIR.trim().length > 0) return null;
  return (
    'Accounts and cloud documents are unavailable on this deployment: its filesystem is not ' +
    'persistent. Everything else works and stays in this browser. To enable accounts, run the ' +
    'server on a host with a persistent volume and set FORGE_DATA_DIR to it (docs/SERVER.md).'
  );
}

/** Test-only seam: point the API at a temporary directory and forget any cached store. */
export function setServerDataDirForTests(directory: string | null): void {
  overrideDirectory = directory;
  stores.clear();
}

export function getStore(): Promise<StoreResult<ForgeStore>> {
  const directory = serverDataDir();
  const cached = stores.get(directory);
  if (cached) return cached;
  const created = (async (): Promise<StoreResult<ForgeStore>> => {
    const problem = overrideDirectory === null ? serverlessStorageProblem() : null;
    if (problem !== null) {
      return { ok: false, error: { kind: 'unavailable', message: problem } };
    }
    const store = new ForgeStore({ dataDir: directory });
    const initialised = await store.init();
    if (!initialised.ok) return initialised;
    return { ok: true, value: store };
  })();
  stores.set(directory, created);
  return created;
}

export type Authenticated = {
  readonly account: AccountView;
  readonly store: ForgeStore;
  /** The digest of the presented token, so a handler can revoke exactly this session. */
  readonly tokenHash: string;
};

/**
 * What a request's credentials amount to.
 *
 * "Nobody is signed in" and "this deployment cannot do accounts at all" are different answers, and
 * collapsing them into `null` made a serverless deployment tell a visitor to *sign in* to an
 * endpoint that can never accept a sign-in. Callers answer 401 for `anonymous` and 503 for
 * `unavailable`.
 */
export type AccountLookup =
  | { readonly kind: 'session'; readonly session: Authenticated }
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'unavailable'; readonly message: string };

/**
 * Resolves the session cookie to an account.
 *
 * A malformed cookie never reaches the store: it is not a token shape, so it cannot be a session.
 * A missing or expired session is `anonymous`. A store that cannot be opened is `unavailable`, with
 * the operator-facing sentence the caller returns unchanged.
 */
export async function requireAccount(request: Request): Promise<AccountLookup> {
  const storeResult = await getStore();
  if (!storeResult.ok) return { kind: 'unavailable', message: storeResult.error.message };
  const token = readCookie(request, SESSION_COOKIE);
  if (token === null || !looksLikeToken(token)) return { kind: 'anonymous' };
  const store = storeResult.value;
  const tokenHash = hashToken(token);
  const session = await store.resolveSession(tokenHash);
  if (!session.ok || session.value === null) return { kind: 'anonymous' };
  return { kind: 'session', session: { account: session.value, store, tokenHash } };
}

export async function currentSession(request: Request): Promise<{
  readonly store: ForgeStore;
  readonly account: AccountView | null;
  readonly tokenHash: string | null;
}> {
  const storeResult = await getStore();
  if (!storeResult.ok) throw new Error(storeResult.error.message);
  const store = storeResult.value;
  const token = readCookie(request, SESSION_COOKIE);
  if (token === null || !looksLikeToken(token)) return { store, account: null, tokenHash: null };
  const tokenHash = hashToken(token);
  const session = await store.resolveSession(tokenHash);
  return { store, account: session.ok ? session.value : null, tokenHash };
}
