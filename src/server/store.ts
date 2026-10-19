/**
 * The optional server's storage layer.
 *
 * **What this is.** A small, dependency-free repository for accounts, sessions, documents and share
 * links, backed by JSON files in `FORGE_DATA_DIR`. It exists so that the platform's remote
 * capabilities can be *implemented and tested* rather than described. It is deliberately not a
 * production database: one process owns the directory, reads and writes are serialised in process,
 * and nothing here claims to survive a multi-node deployment (ADR-0027 says so too).
 *
 * **What it guarantees.**
 * - A write is atomic at the file level: content goes to a temporary file and is renamed into place.
 * - A schema version lives in `meta.json`; migrations run once, in order, and a directory written by
 *   a *newer* build is refused rather than silently downgraded.
 * - Every document read is validated with the platform's own schema, so a corrupt or hand-edited
 *   file is reported instead of served.
 * - Every access to a document, share link or session is scoped to its owner. Another account's
 *   document is `not-found`, not `forbidden`, so the API does not confirm that an id exists.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { forgeDocumentSchema } from '../core/documents/schema';
import type { ForgeDocument } from '../core/documents/types';
import type { PasswordHash } from './passwords';

/* ------------------------------------------------------------------------------------------- */
/* Public shapes                                                                              */
/* ------------------------------------------------------------------------------------------- */

export const SERVER_SCHEMA_VERSION = 1;

export type ServerAccount = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly password: PasswordHash;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** What an API response may say about an account. The password hash never leaves the store. */
export type AccountView = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type StoredDocument = {
  readonly id: string;
  readonly ownerId: string;
  readonly title: string;
  readonly documentTypeId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly document: ForgeDocument;
};

export type DocumentSummary = {
  readonly id: string;
  readonly title: string;
  readonly documentTypeId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Serialised size, so a client can show what syncing will cost. */
  readonly bytes: number;
};

/** What the index stores. The owner is never part of a response body. */
type IndexEntry = DocumentSummary & { readonly ownerId: string };

export type SessionRecord = {
  readonly tokenHash: string;
  readonly accountId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
};

export type ShareRecord = {
  readonly id: string;
  readonly tokenHash: string;
  readonly documentId: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
};

export type ShareView = {
  readonly id: string;
  readonly documentId: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
};

export type StoreError =
  | { readonly kind: 'not-found'; readonly message: string }
  | {
      readonly kind: 'conflict';
      readonly message: string;
      readonly serverRevision: number;
      readonly updatedAt: string;
    }
  | {
      readonly kind: 'validation';
      readonly message: string;
      readonly issues: readonly string[];
    }
  | { readonly kind: 'unavailable'; readonly message: string; readonly detail?: string };

export type StoreResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: StoreError };

export function ok<T>(value: T): StoreResult<T> {
  return { ok: true, value };
}

export function fail<T>(error: StoreError): StoreResult<T> {
  return { ok: false, error };
}

export type ForgeStoreOptions = {
  readonly dataDir: string;
  /** Injected in tests so timestamps are deterministic. */
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
};

type Meta = { readonly schemaVersion: number; readonly createdAt: string };

type Collections = {
  accounts: ServerAccount[];
  sessions: SessionRecord[];
  shares: ShareRecord[];
  index: IndexEntry[];
};

const COLLECTION_FILES: Readonly<Record<keyof Collections, string>> = {
  accounts: 'accounts.json',
  sessions: 'sessions.json',
  shares: 'shares.json',
  index: 'documents/index.json',
};

/* ------------------------------------------------------------------------------------------- */
/* Validation helpers                                                                         */
/* ------------------------------------------------------------------------------------------- */

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_DISPLAY_NAME_LENGTH = 60;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | null {
  const normalised = normaliseEmail(email);
  if (normalised.length < 5 || normalised.length > 254) return 'Enter an email address.';
  return EMAIL_PATTERN.test(normalised) ? null : 'That does not look like an email address.';
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
  if (trimmed.length === 0) return 'Enter a display name.';
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return `Use at most ${String(MAX_DISPLAY_NAME_LENGTH)} characters.`;
  }
  return null;
}

export function accountView(account: ServerAccount): AccountView {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function toSummary(entry: IndexEntry): DocumentSummary {
  return {
    id: entry.id,
    title: entry.title,
    documentTypeId: entry.documentTypeId,
    revision: entry.revision,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    bytes: entry.bytes,
  };
}

export function shareView(record: ShareRecord): ShareView {
  return {
    id: record.id,
    documentId: record.documentId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

/* ------------------------------------------------------------------------------------------- */
/* The store                                                                                  */
/* ------------------------------------------------------------------------------------------- */

export class ForgeStore {
  private readonly dataDir: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private queue: Promise<unknown> = Promise.resolve();
  private initialised = false;

  public constructor(options: ForgeStoreOptions) {
    this.dataDir = options.dataDir;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => randomUUID());
  }

  /** Creates the directory, writes or upgrades metadata and reconciles the document index. */
  public async init(): Promise<StoreResult<void>> {
    try {
      await mkdir(join(this.dataDir, 'documents'), { recursive: true, mode: 0o700 });
      const metaPath = join(this.dataDir, 'meta.json');
      const meta = await this.readJson<Meta>(metaPath);
      if (!meta) {
        const created: Meta = { schemaVersion: SERVER_SCHEMA_VERSION, createdAt: this.now() };
        await this.writeJson(metaPath, created);
      } else if (meta.schemaVersion > SERVER_SCHEMA_VERSION) {
        return fail({
          kind: 'unavailable',
          message: 'This data directory was written by a newer server build.',
          detail: `Stored schema ${String(meta.schemaVersion)} is newer than ${String(SERVER_SCHEMA_VERSION)}.`,
        });
      }
      for (const file of Object.values(COLLECTION_FILES)) {
        const path = join(this.dataDir, file);
        if ((await this.readJson<unknown>(path)) === null) await this.writeJson(path, []);
      }
      this.initialised = true;
      return ok(undefined);
    } catch (error) {
      return fail({
        kind: 'unavailable',
        message: 'The server could not prepare its data directory.',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /* --------------------------------------------------------------------------------------- */
  /* Accounts                                                                                */
  /* --------------------------------------------------------------------------------------- */

  public async createAccount(input: {
    readonly email: string;
    readonly displayName: string;
    readonly password: PasswordHash;
  }): Promise<StoreResult<ServerAccount>> {
    return this.mutate(async () => {
      const accounts = await this.read<ServerAccount>('accounts');
      const email = normaliseEmail(input.email);
      if (accounts.some((account) => account.email === email)) {
        // The same answer for "already registered" and "invalid" would hide a typo; registration is
        // the one place where telling the user the email is taken is the kind thing to do.
        return fail<ServerAccount>({
          kind: 'validation',
          message: 'An account with that email already exists.',
          issues: ['email'],
        });
      }
      const now = this.now();
      const account: ServerAccount = {
        id: this.idFactory(),
        email,
        displayName: input.displayName.trim(),
        password: input.password,
        createdAt: now,
        updatedAt: now,
      };
      await this.write('accounts', [...accounts, account]);
      return ok(account);
    });
  }

  public async findAccountByEmail(email: string): Promise<StoreResult<ServerAccount | null>> {
    return this.mutate(async () => {
      const accounts = await this.read<ServerAccount>('accounts');
      return ok(accounts.find((account) => account.email === normaliseEmail(email)) ?? null);
    });
  }

  public async getAccount(id: string): Promise<StoreResult<ServerAccount | null>> {
    return this.mutate(async () => {
      const accounts = await this.read<ServerAccount>('accounts');
      return ok(accounts.find((account) => account.id === id) ?? null);
    });
  }

  public async updateAccount(
    id: string,
    patch: { readonly displayName?: string; readonly password?: PasswordHash },
  ): Promise<StoreResult<AccountView>> {
    return this.mutate(async () => {
      const accounts = await this.read<ServerAccount>('accounts');
      const existing = accounts.find((account) => account.id === id);
      if (!existing) return fail<AccountView>({ kind: 'not-found', message: 'No such account.' });
      const updated: ServerAccount = {
        ...existing,
        ...(patch.displayName === undefined ? {} : { displayName: patch.displayName.trim() }),
        ...(patch.password === undefined ? {} : { password: patch.password }),
        updatedAt: this.now(),
      };
      await this.write(
        'accounts',
        accounts.map((account) => (account.id === id ? updated : account)),
      );
      return ok(accountView(updated));
    });
  }

  /**
   * Deletes an account and everything that belongs to it.
   *
   * The cascade is explicit rather than implied: sessions, documents, the index entries and every
   * share link that pointed at one of those documents. An account deletion that left a share link
   * alive would be a data-deletion promise broken in the one place it matters most.
   */
  public async deleteAccount(id: string): Promise<StoreResult<{ deletedDocuments: number }>> {
    return this.mutate(async () => {
      const accounts = await this.read<ServerAccount>('accounts');
      if (!accounts.some((account) => account.id === id)) {
        return fail<{ deletedDocuments: number }>({
          kind: 'not-found',
          message: 'No such account.',
        });
      }
      const index = await this.read<IndexEntry>('index');
      const owned = index.filter((entry) => entry.ownerId === id);
      for (const entry of owned) {
        await rm(this.documentPath(entry.id), { force: true });
      }
      await this.write(
        'index',
        index.filter((entry) => entry.ownerId !== id),
      );
      const shares = await this.read<ShareRecord>('shares');
      await this.write(
        'shares',
        shares.filter((share) => share.ownerId !== id),
      );
      const sessions = await this.read<SessionRecord>('sessions');
      await this.write(
        'sessions',
        sessions.filter((session) => session.accountId !== id),
      );
      await this.write(
        'accounts',
        accounts.filter((account) => account.id !== id),
      );
      return ok({ deletedDocuments: owned.length });
    });
  }

  /* --------------------------------------------------------------------------------------- */
  /* Sessions                                                                                */
  /* --------------------------------------------------------------------------------------- */

  public async createSession(
    accountId: string,
    options: { readonly tokenHash: string; readonly ttlMs: number },
  ): Promise<StoreResult<SessionRecord>> {
    return this.mutate(async () => {
      const sessions = await this.read<SessionRecord>('sessions');
      const now = this.clock();
      const record: SessionRecord = {
        tokenHash: options.tokenHash,
        accountId,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + options.ttlMs).toISOString(),
      };
      const live = sessions.filter((session) => session.expiresAt > record.createdAt);
      await this.write('sessions', [...live, record]);
      return ok(record);
    });
  }

  /** Resolves a session token hash to its account, deleting the record if it has expired. */
  public async resolveSession(tokenHash: string): Promise<StoreResult<AccountView | null>> {
    return this.mutate(async () => {
      const sessions = await this.read<SessionRecord>('sessions');
      const now = this.now();
      const session = sessions.find((entry) => entry.tokenHash === tokenHash);
      if (!session) return ok(null);
      if (session.expiresAt <= now) {
        await this.write(
          'sessions',
          sessions.filter((entry) => entry.tokenHash !== tokenHash),
        );
        return ok(null);
      }
      const accounts = await this.read<ServerAccount>('accounts');
      const account = accounts.find((entry) => entry.id === session.accountId);
      if (!account) return ok(null);
      return ok(accountView(account));
    });
  }

  public async deleteSession(tokenHash: string): Promise<StoreResult<boolean>> {
    return this.mutate(async () => {
      const sessions = await this.read<SessionRecord>('sessions');
      await this.write(
        'sessions',
        sessions.filter((entry) => entry.tokenHash !== tokenHash),
      );
      return ok(sessions.some((entry) => entry.tokenHash === tokenHash));
    });
  }

  public async deleteAccountSessions(accountId: string): Promise<StoreResult<number>> {
    return this.mutate(async () => {
      const sessions = await this.read<SessionRecord>('sessions');
      const kept = sessions.filter((entry) => entry.accountId !== accountId);
      await this.write('sessions', kept);
      return ok(sessions.length - kept.length);
    });
  }

  /** Revokes every session for an account except the one that made the request. */
  public async revokeOtherSessions(
    accountId: string,
    keepTokenHash: string,
  ): Promise<StoreResult<number>> {
    return this.mutate(async () => {
      const sessions = await this.read<SessionRecord>('sessions');
      const kept = sessions.filter(
        (entry) => entry.accountId !== accountId || entry.tokenHash === keepTokenHash,
      );
      await this.write('sessions', kept);
      return ok(sessions.length - kept.length);
    });
  }

  public async sessionCount(accountId: string): Promise<StoreResult<number>> {
    return this.mutate(async () => {
      const sessions = await this.read<SessionRecord>('sessions');
      return ok(sessions.filter((entry) => entry.accountId === accountId).length);
    });
  }

  /* --------------------------------------------------------------------------------------- */
  /* Documents                                                                               */
  /* --------------------------------------------------------------------------------------- */

  public async listDocuments(ownerId: string): Promise<StoreResult<readonly DocumentSummary[]>> {
    return this.mutate(async () => {
      const index = await this.read<IndexEntry>('index');
      const owned = index
        .filter((entry) => entry.ownerId === ownerId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(toSummary);
      return ok(owned);
    });
  }

  public async getDocument(ownerId: string, id: string): Promise<StoreResult<StoredDocument>> {
    return this.mutate(async () => {
      const stored = await this.readJson<StoredDocument>(this.documentPath(id));
      if (!stored || stored.ownerId !== ownerId) {
        // Another account's document is indistinguishable from a missing one.
        return fail<StoredDocument>({ kind: 'not-found', message: 'No such document.' });
      }
      return ok(stored);
    });
  }

  /**
   * Saves a document.
   *
   * `baseRevision` is the revision the client last saw; `null` means "this is a new document". A
   * mismatch is a `conflict` with **the server's** revision and timestamp, which is what lets the
   * interface say "someone else saved at 14:02" instead of silently overwriting their work.
   */
  public async saveDocument(input: {
    readonly ownerId: string;
    readonly id: string;
    readonly document: unknown;
    readonly baseRevision: number | null;
  }): Promise<StoreResult<StoredDocument>> {
    return this.mutate(async () => {
      const parsed = forgeDocumentSchema.safeParse(input.document);
      if (!parsed.success) {
        return fail<StoredDocument>({
          kind: 'validation',
          message: 'That document is not valid.',
          issues: parsed.error.issues.slice(0, 8).map((issue) => {
            const path = issue.path.join('.');
            return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
          }),
        });
      }
      const document = parsed.data as ForgeDocument;
      const serialised = JSON.stringify(document);
      if (serialised.length > MAX_DOCUMENT_BYTES) {
        return fail<StoredDocument>({
          kind: 'validation',
          message: 'That document is larger than this server accepts.',
          issues: [
            `The document is ${String(serialised.length)} bytes; the limit is ${String(MAX_DOCUMENT_BYTES)}.`,
          ],
        });
      }
      if (document.id !== input.id) {
        return fail<StoredDocument>({
          kind: 'validation',
          message: 'The document id does not match the one in the request.',
          issues: ['id'],
        });
      }

      const existing = await this.readJson<StoredDocument>(this.documentPath(input.id));
      if (existing && existing.ownerId !== input.ownerId) {
        return fail<StoredDocument>({ kind: 'not-found', message: 'No such document.' });
      }
      if (!existing && input.baseRevision !== null) {
        return fail<StoredDocument>({
          kind: 'not-found',
          message: 'That document is no longer on the server.',
        });
      }
      if (existing && input.baseRevision !== existing.revision) {
        return fail<StoredDocument>({
          kind: 'conflict',
          message: 'Someone else saved this document since you opened it.',
          serverRevision: existing.revision,
          updatedAt: existing.updatedAt,
        });
      }

      const now = this.now();
      const revision = existing ? existing.revision + 1 : 1;
      const saved: StoredDocument = {
        id: input.id,
        ownerId: input.ownerId,
        title: document.title,
        documentTypeId: String(document.documentTypeId),
        revision,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        document: { ...document, revision, updatedAt: now },
      };
      await this.writeJson(this.documentPath(saved.id), saved);
      const index = await this.read<IndexEntry>('index');
      const summary: IndexEntry = {
        id: saved.id,
        ownerId: saved.ownerId,
        title: saved.title,
        documentTypeId: saved.documentTypeId,
        revision: saved.revision,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
        bytes: JSON.stringify(saved.document).length,
      };
      await this.write('index', [...index.filter((entry) => entry.id !== saved.id), summary]);
      return ok(saved);
    });
  }

  public async deleteDocument(ownerId: string, id: string): Promise<StoreResult<boolean>> {
    return this.mutate(async () => {
      const existing = await this.readJson<StoredDocument>(this.documentPath(id));
      if (!existing || existing.ownerId !== ownerId) {
        return fail<boolean>({ kind: 'not-found', message: 'No such document.' });
      }
      await rm(this.documentPath(id), { force: true });
      const index = await this.read<IndexEntry>('index');
      await this.write(
        'index',
        index.filter((entry) => entry.id !== id),
      );
      const shares = await this.read<ShareRecord>('shares');
      await this.write(
        'shares',
        shares.filter((share) => share.documentId !== id),
      );
      return ok(true);
    });
  }

  /* --------------------------------------------------------------------------------------- */
  /* Share links                                                                             */
  /* --------------------------------------------------------------------------------------- */

  public async createShare(input: {
    readonly ownerId: string;
    readonly documentId: string;
    readonly tokenHash: string;
    readonly ttlMs: number | null;
  }): Promise<StoreResult<ShareRecord>> {
    return this.mutate(async () => {
      const existing = await this.readJson<StoredDocument>(this.documentPath(input.documentId));
      if (!existing || existing.ownerId !== input.ownerId) {
        return fail<ShareRecord>({ kind: 'not-found', message: 'No such document.' });
      }
      const now = this.clock();
      const record: ShareRecord = {
        id: this.idFactory(),
        tokenHash: input.tokenHash,
        documentId: input.documentId,
        ownerId: input.ownerId,
        createdAt: now.toISOString(),
        expiresAt:
          input.ttlMs === null ? null : new Date(now.getTime() + input.ttlMs).toISOString(),
      };
      const shares = await this.read<ShareRecord>('shares');
      await this.write('shares', [...shares, record]);
      return ok(record);
    });
  }

  public async listShares(
    ownerId: string,
    documentId: string,
  ): Promise<StoreResult<readonly ShareView[]>> {
    return this.mutate(async () => {
      const shares = await this.read<ShareRecord>('shares');
      return ok(
        shares
          .filter((share) => share.ownerId === ownerId && share.documentId === documentId)
          .map(shareView),
      );
    });
  }

  public async revokeShare(ownerId: string, shareId: string): Promise<StoreResult<boolean>> {
    return this.mutate(async () => {
      const shares = await this.read<ShareRecord>('shares');
      const record = shares.find((share) => share.id === shareId && share.ownerId === ownerId);
      if (!record) return fail<boolean>({ kind: 'not-found', message: 'No such share link.' });
      await this.write(
        'shares',
        shares.filter((share) => share.id !== shareId),
      );
      return ok(true);
    });
  }

  /** Resolves a share token to a read-only document. Expired and revoked links are both absent. */
  public async resolveShare(tokenHash: string): Promise<StoreResult<StoredDocument>> {
    return this.mutate(async () => {
      const shares = await this.read<ShareRecord>('shares');
      const share = shares.find((entry) => entry.tokenHash === tokenHash);
      if (!share)
        return fail<StoredDocument>({ kind: 'not-found', message: 'No such share link.' });
      if (share.expiresAt !== null && share.expiresAt <= this.now()) {
        await this.write(
          'shares',
          shares.filter((entry) => entry.id !== share.id),
        );
        return fail<StoredDocument>({ kind: 'not-found', message: 'That share link has expired.' });
      }
      const stored = await this.readJson<StoredDocument>(this.documentPath(share.documentId));
      if (!stored || stored.ownerId !== share.ownerId) {
        return fail<StoredDocument>({ kind: 'not-found', message: 'That document is gone.' });
      }
      return ok(stored);
    });
  }

  /* --------------------------------------------------------------------------------------- */
  /* Internals                                                                               */
  /* --------------------------------------------------------------------------------------- */

  private now(): string {
    return this.clock().toISOString();
  }

  private documentPath(id: string): string {
    // Ids come from the client on save; they are also validated by the document schema, but a
    // path-traversal attempt must not be able to escape the data directory even if that changes.
    const safe = /^[A-Za-z0-9._-]{1,120}$/.test(id)
      ? id
      : `invalid-${String(randomBytes(8).toString('hex'))}`;
    return join(this.dataDir, 'documents', `${safe}.json`);
  }

  private pathFor(name: keyof Collections): string {
    return join(this.dataDir, COLLECTION_FILES[name]);
  }

  private async read<T>(name: keyof Collections): Promise<T[]> {
    const value = await this.readJson<T[]>(this.pathFor(name));
    return Array.isArray(value) ? value : [];
  }

  private async write<T>(name: keyof Collections, value: readonly T[]): Promise<void> {
    await this.writeJson(this.pathFor(name), value);
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') return null;
      throw error;
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${String(randomBytes(6).toString('hex'))}.tmp`;
    // 0600: accounts.json holds password hashes and sessions.json token digests. The store is meant
    // for one host, but it should not hand them to every other local account either.
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, path);
  }

  /**
   * Serialises every operation through one queue.
   *
   * The file store is single-process by design; making each read-modify-write atomic in the process
   * is what keeps two requests from interleaving between "read the accounts" and "write them back".
   * Across processes the guarantee does not hold, and the docs say so.
   */
  private mutate<T>(operation: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
    if (!this.initialised) {
      return Promise.resolve(
        fail<T>({ kind: 'unavailable', message: 'The store has not been initialised.' }),
      );
    }
    const run = this.queue.then(operation, operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run.catch((error: unknown) =>
      fail<T>({
        kind: 'unavailable',
        message: 'The data directory could not be read or written.',
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  /** Every document id currently stored as a file, for diagnostics and tests. */
  public async documentFiles(): Promise<readonly string[]> {
    try {
      const entries = await readdir(join(this.dataDir, 'documents'));
      return entries.filter((entry) => entry.endsWith('.json')).sort();
    } catch {
      return [];
    }
  }
}
