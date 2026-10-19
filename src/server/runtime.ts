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
 * Resolves the session cookie to an account, or `null`.
 *
 * A malformed cookie never reaches the store: it is not a token shape, so it cannot be a session. A
 * missing or expired session is also `null` — callers answer 401.
 */
export async function requireAccount(request: Request): Promise<Authenticated | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token === null || !looksLikeToken(token)) return null;
  const storeResult = await getStore();
  if (!storeResult.ok) return null;
  const store = storeResult.value;
  const tokenHash = hashToken(token);
  const session = await store.resolveSession(tokenHash);
  if (!session.ok || session.value === null) return null;
  return { account: session.value, store, tokenHash };
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
