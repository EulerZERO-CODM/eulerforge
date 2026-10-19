/**
 * POST /api/auth/register
 *
 * Creates an account, starts a session and sets the cookie in the same response, so a new user is
 * signed in without a second round trip.
 */

import {
  crossOriginRequest,
  clientKey,
  failureResponse,
  jsonResponse,
  readJsonBody,
  registerLimiter,
  rateLimitedResponse,
  sessionCookie,
} from '../../../../server/http';
import { readString } from '../../../../server/fields';
import { hashPassword } from '../../../../server/passwords';
import { getStore } from '../../../../server/runtime';
import { issueToken, SESSION_TTL_MS } from '../../../../server/sessions';
import {
  accountView,
  MAX_DISPLAY_NAME_LENGTH,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from '../../../../server/store';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const limit = registerLimiter.check(clientKey(request));
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterMs);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const email = readString(body.value, 'email', 254) ?? '';
  const password = readString(body.value, 'password', 512) ?? '';
  const displayName = readString(body.value, 'displayName', 120) ?? '';
  const issues: string[] = [];
  const emailIssue = validateEmail(email);
  if (emailIssue !== null) issues.push(emailIssue);
  const nameIssue = validateDisplayName(displayName);
  if (nameIssue !== null) issues.push(nameIssue);
  const passwordIssue = validatePassword(password);
  if (passwordIssue !== null) issues.push(passwordIssue);
  if (issues.length > 0) {
    return failureResponse(422, 'validation', 'Check the form and try again.', { issues });
  }

  const storeResult = await getStore();
  if (!storeResult.ok)
    return failureResponse(503, storeResult.error.kind, storeResult.error.message);
  const store = storeResult.value;

  const created = await store.createAccount({
    email,
    displayName: displayName.slice(0, MAX_DISPLAY_NAME_LENGTH),
    password: await hashPassword(password),
  });
  if (!created.ok) {
    return failureResponse(
      created.error.kind === 'validation' ? 422 : 503,
      created.error.kind,
      created.error.message,
      created.error.kind === 'validation' ? { issues: created.error.issues } : {},
    );
  }

  const issued = issueToken();
  const session = await store.createSession(created.value.id, {
    tokenHash: issued.tokenHash,
    ttlMs: SESSION_TTL_MS,
  });
  if (!session.ok) {
    return failureResponse(503, session.error.kind, session.error.message);
  }

  return jsonResponse(
    { account: accountView(created.value) },
    {
      status: 201,
      headers: { 'Set-Cookie': sessionCookie(request, issued.token, SESSION_TTL_MS / 1000) },
    },
  );
}
