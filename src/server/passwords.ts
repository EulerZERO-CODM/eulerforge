/**
 * Password hashing for the optional server.
 *
 * The rules are the boring ones, implemented rather than assumed:
 *
 * - **scrypt**, the memory-hard KDF Node ships in its standard library. No password reaches disk in
 *   a form that can be read back, and no dependency is added for a primitive the runtime already
 *   provides.
 * - A **random salt per password**, so two people with the same password do not share a hash.
 * - The parameters are stored *with* the hash, so raising them later does not invalidate existing
 *   accounts: an old record still verifies with the parameters it was written with.
 * - Comparison is constant-time (`timingSafeEqual`), and a malformed record fails closed instead of
 *   throwing into a request handler.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Cost parameters. `N = 2^15` is ~32 MiB and ~100 ms on the class of machine this targets. */
export const SCRYPT_PARAMETERS = { N: 32_768, r: 8, p: 1, keyLength: 64 } as const;

export type PasswordHash = {
  readonly algorithm: 'scrypt';
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: string;
  readonly hash: string;
};

function derive(
  password: string,
  salt: Buffer,
  parameters: typeof SCRYPT_PARAMETERS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      parameters.keyLength,
      { N: parameters.N, r: parameters.r, p: parameters.p, maxmem: 256 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, SCRYPT_PARAMETERS);
  return {
    algorithm: 'scrypt',
    N: SCRYPT_PARAMETERS.N,
    r: SCRYPT_PARAMETERS.r,
    p: SCRYPT_PARAMETERS.p,
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
  };
}

/**
 * Verifies a password against a stored record.
 *
 * Returns `false` for every malformed-record case (wrong algorithm, bad base64, wrong lengths) —
 * a corrupt row must not become an authentication bypass, and it must not become a 500 either.
 */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  // Read through an unknown view: the record comes from disk, so its discriminated tag is runtime
  // data and cannot be trusted just because the type says it is always `scrypt`.
  const algorithm = (stored as { readonly algorithm?: unknown }).algorithm;
  if (algorithm !== 'scrypt') return false;
  if (!Number.isInteger(stored.N) || stored.N < 2 || stored.N > 1_048_576) return false;
  if (!Number.isInteger(stored.r) || stored.r < 1 || stored.r > 32) return false;
  if (!Number.isInteger(stored.p) || stored.p < 1 || stored.p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(stored.salt, 'base64');
    expected = Buffer.from(stored.hash, 'base64');
  } catch {
    return false;
  }
  if (salt.length < 8 || salt.length > 64 || expected.length < 16 || expected.length > 128) {
    return false;
  }

  let actual: Buffer;
  try {
    actual = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password.normalize('NFKC'),
        salt,
        expected.length,
        { N: stored.N, r: stored.r, p: stored.p, maxmem: 256 * 1024 * 1024 },
        (error, key) => {
          if (error) reject(error);
          else resolve(key);
        },
      );
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
