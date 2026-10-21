/**
 * Session tokens.
 *
 * A session token is 256 random bits, sent to the browser in an HttpOnly cookie. The server stores
 * only its SHA-256 digest, so a copy of the data directory does not hand an attacker working
 * sessions. Tokens are opaque: no account id, no claims, no signature to verify — the record in the
 * store *is* the authority, which makes revocation a delete rather than a denylist.
 */

import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'forge_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type IssuedToken = {
  /** The value that goes to the client. Never stored. */
  readonly token: string;
  /** What the store keeps, and what a lookup compares. */
  readonly tokenHash: string;
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueToken(): IssuedToken {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/** A token-shaped string, so a garbage cookie never reaches a store lookup. */
export function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
