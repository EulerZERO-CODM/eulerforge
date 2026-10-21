/**
 * POST /api/auth/login
 *
 * Always answers the same sentence for a wrong password and an unknown email, and always spends the
 * time of a password verification (a dummy record when no account exists), so the endpoint does not
 * become an account enumeration oracle through either wording or timing.
 */

import {
  clientKey,
  crossOriginRequest,
  failureResponse,
  jsonResponse,
  loginAccountLimiter,
  loginLimiter,
  rateLimitedResponse,
  readJsonBody,
  sessionCookie,
} from '../../../../server/http';
import { readString } from '../../../../server/fields';
import { hashPassword, verifyPassword, type PasswordHash } from '../../../../server/passwords';
import { getStore } from '../../../../server/runtime';
import { issueToken, SESSION_TTL_MS } from '../../../../server/sessions';
import { accountView, normaliseEmail } from '../../../../server/store';

export const runtime = 'nodejs';

let dummyHash: Promise<PasswordHash> | null = null;
function timingEqualiser(): Promise<PasswordHash> {
  dummyHash ??= hashPassword('not-a-real-password');
  return dummyHash;
}

export async function POST(request: Request): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const email = normaliseEmail(readString(body.value, 'email', 254) ?? '');
  const password = readString(body.value, 'password', 512) ?? '';

  // The key includes the email so one client cannot lock every account out by guessing, and one
  // account cannot be hammered from many emails.
  const limitKey = `${clientKey(request)}|${email}`;
  const limit = loginLimiter.check(limitKey);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterMs);
  // Address-independent, so rotating `X-Forwarded-For` does not buy another guess at this account.
  const accountKey = `sign-in|${email}`;
  const accountLimit = loginAccountLimiter.check(accountKey);
  if (!accountLimit.allowed) return rateLimitedResponse(accountLimit.retryAfterMs);

  if (email.length === 0 || password.length === 0) {
    return failureResponse(422, 'validation', 'Enter your email and password.');
  }

  const storeResult = await getStore();
  if (!storeResult.ok)
    return failureResponse(503, storeResult.error.kind, storeResult.error.message);
  const store = storeResult.value;

  const found = await store.findAccountByEmail(email);
  if (!found.ok) return failureResponse(503, found.error.kind, found.error.message);

  const account = found.value;
  const acceptable = await verifyPassword(password, account?.password ?? (await timingEqualiser()));
  if (!account || !acceptable) {
    return failureResponse(401, 'unauthenticated', 'That email and password do not match.');
  }
  // The budget is for guessing, not for signing in: ten correct sign-ins in a row used to lock a
  // person out of their own account for the rest of the window.
  loginLimiter.clear(limitKey);
  loginAccountLimiter.clear(accountKey);

  const issued = issueToken();
  const session = await store.createSession(account.id, {
    tokenHash: issued.tokenHash,
    ttlMs: SESSION_TTL_MS,
  });
  if (!session.ok) return failureResponse(503, session.error.kind, session.error.message);

  return jsonResponse(
    { account: accountView(account) },
    {
      headers: {
        'Set-Cookie': sessionCookie(request, issued.token, SESSION_TTL_MS / 1000),
      },
    },
  );
}
