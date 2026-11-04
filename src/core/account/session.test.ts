import { describe, expect, it } from 'vitest';

import {
  describeExpiry,
  isRetryable,
  networkFailure,
  parseAccount,
  parseApiFailure,
  parseSessionState,
  shareUrl,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validateRegistration,
  OWNERSHIP_NOTE,
} from './session';

const ACCOUNT = {
  id: 'acct-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

describe('account validation', () => {
  it('accepts an ordinary email and refuses the shapes that are not one', () => {
    expect(validateEmail('ada@example.com')).toBeNull();
    expect(validateEmail('  ADA@Example.COM ')).toBeNull();
    expect(validateEmail('')).toBe('Enter your email address.');
    expect(validateEmail('ada')).toMatch(/does not look like/);
    expect(validateEmail('ada@localhost')).toMatch(/does not look like/);
    expect(validateEmail(`${'a'.repeat(250)}@example.com`)).toMatch(/too long/);
  });

  it('requires a real password length, not merely a non-empty one', () => {
    expect(validatePassword('123456789')).toMatch(/at least 10/);
    expect(validatePassword('1234567890')).toBeNull();
    expect(validatePassword('          ')).toMatch(/only spaces/);
    expect(validatePassword('a'.repeat(201))).toMatch(/at most 200/);
  });

  it('requires a display name and bounds it', () => {
    expect(validateDisplayName('   ')).toBe('Enter a name to show.');
    expect(validateDisplayName('Ada')).toBeNull();
    expect(validateDisplayName('a'.repeat(61))).toMatch(/at most 60/);
  });

  it('reports every registration problem at once instead of one at a time', () => {
    expect(validateRegistration({ email: 'nope', displayName: '', password: 'short' })).toEqual([
      'That does not look like an email address.',
      'Enter a name to show.',
      'Use at least 10 characters.',
    ]);
    expect(
      validateRegistration({
        email: 'ada@example.com',
        displayName: 'Ada',
        password: 'correct horse',
      }),
    ).toEqual([]);
  });
});

describe('reading server responses', () => {
  it('parses a well-formed account', () => {
    expect(parseAccount(ACCOUNT)).toEqual({ ok: true, value: ACCOUNT });
  });

  it('refuses a half-account instead of filling in blanks', () => {
    const parsed = parseAccount({ ...ACCOUNT, createdAt: undefined });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toMatch(/cannot read/);
    expect(parseAccount(null).ok).toBe(false);
    expect(parseAccount('an account').ok).toBe(false);
  });

  it('distinguishes anonymous, signed in, and unreachable', () => {
    expect(parseSessionState({ account: null, activeSessions: null })).toEqual({
      status: 'anonymous',
    });
    expect(parseSessionState({ account: ACCOUNT, activeSessions: 2 })).toEqual({
      status: 'signed-in',
      account: ACCOUNT,
      activeSessions: 2,
    });
    const unavailable = parseSessionState({
      account: null,
      unavailable: 'The optional server is not reachable.',
    });
    expect(unavailable.status).toBe('unavailable');
  });

  it('turns an unreadable session body into an unavailable state, never a crash', () => {
    const state = parseSessionState('not an object');
    expect(state.status).toBe('unavailable');
    if (state.status !== 'unavailable') return;
    expect(state.notice).toMatch(/cannot read/);
  });

  it('reads an API failure with its issues and conflict details', () => {
    const failure = parseApiFailure(
      {
        error: {
          kind: 'conflict',
          message: 'Someone else saved this document since you opened it.',
          serverRevision: 7,
          updatedAt: '2026-10-18T10:00:00.000Z',
        },
      },
      409,
    );
    expect(failure).toMatchObject({
      kind: 'conflict',
      status: 409,
      serverRevision: 7,
      updatedAt: '2026-10-18T10:00:00.000Z',
      issues: [],
    });

    const validation = parseApiFailure(
      {
        error: { kind: 'validation', message: 'Check the form.', issues: ['email', 3, 'password'] },
      },
      422,
    );
    expect(validation.issues).toEqual(['email', 'password']);
  });

  it('does not trust an unknown error kind', () => {
    expect(parseApiFailure({ error: { kind: 'teapot', message: 'No.' } }, 418).kind).toBe(
      'bad-request',
    );
    expect(parseApiFailure(null, 0).kind).toBe('network');
  });

  it('only calls a failure retryable when nothing about the form needs to change', () => {
    expect(isRetryable(networkFailure())).toBe(true);
    expect(
      isRetryable(parseApiFailure({ error: { kind: 'rate-limited', message: 'Slow.' } }, 429)),
    ).toBe(true);
    expect(
      isRetryable(parseApiFailure({ error: { kind: 'validation', message: 'No.' } }, 422)),
    ).toBe(false);
    expect(
      isRetryable(parseApiFailure({ error: { kind: 'unauthorized', message: 'No.' } }, 401)),
    ).toBe(false);
  });
});

describe('share links and expiry', () => {
  it('builds a link without inventing a host', () => {
    expect(shareUrl(null, 'abc')).toBe('/shared/abc');
    expect(shareUrl('https://forge.example.com/', 'abc')).toBe(
      'https://forge.example.com/shared/abc',
    );
    expect(shareUrl('https://forge.example.com', 'a b')).toBe(
      'https://forge.example.com/shared/a%20b',
    );
  });

  it('describes an expiry honestly at every distance', () => {
    const now = new Date('2026-10-19T12:00:00.000Z');
    expect(describeExpiry(null, now)).toMatch(/No expiry/);
    expect(describeExpiry('2026-10-22T12:00:00.000Z', now)).toBe('Expires in 3 days.');
    expect(describeExpiry('2026-10-20T12:00:00.000Z', now)).toBe('Expires in 1 day.');
    expect(describeExpiry('2026-10-19T15:00:00.000Z', now)).toBe('Expires in 3 hours.');
    expect(describeExpiry('2026-10-19T12:00:30.000Z', now)).toBe('Expires in 1 hour.');
    expect(describeExpiry('2026-10-18T12:00:00.000Z', now)).toBe('Expired.');
    expect(describeExpiry('not a date', now)).toBe('Expiry unknown.');
  });

  it('states ownership and deletion in one sentence the UI can reuse', () => {
    expect(OWNERSHIP_NOTE).toMatch(/deleting the account removes/);
    expect(OWNERSHIP_NOTE).toMatch(/Local copies are not touched/);
  });
});
