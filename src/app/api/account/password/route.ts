/**
 * POST /api/account/password
 *
 * Changing a password requires the current one, hashes the new one, and then revokes every other
 * session. The session that made the change stays signed in; every other device is signed out,
 * which is what someone changing a password because they suspect exposure expects to happen.
 */

import {
  clientKey,
  crossOriginRequest,
  failureResponse,
  jsonResponse,
  loginLimiter,
  rateLimitedResponse,
  readJsonBody,
} from '../../../../server/http';
import { readString } from '../../../../server/fields';
import { hashPassword, verifyPassword } from '../../../../server/passwords';
import { requireAccount } from '../../../../server/runtime';
import { validatePassword } from '../../../../server/store';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const limit = loginLimiter.check(`password|${clientKey(request)}`);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterMs);

  const session = await requireAccount(request);
  if (!session) return failureResponse(401, 'unauthenticated', 'Sign in to change your password.');

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const currentPassword = readString(body.value, 'currentPassword', 512) ?? '';
  const newPassword = readString(body.value, 'newPassword', 512) ?? '';

  const issue = validatePassword(newPassword);
  if (issue !== null) {
    return failureResponse(422, 'validation', issue, { issues: ['newPassword'] });
  }
  if (newPassword === currentPassword) {
    return failureResponse(422, 'validation', 'The new password is the current one.', {
      issues: ['newPassword'],
    });
  }

  const stored = await session.store.getAccount(session.account.id);
  if (!stored.ok) return failureResponse(503, stored.error.kind, stored.error.message);
  if (!stored.value) return failureResponse(401, 'unauthenticated', 'No such account.');
  if (!(await verifyPassword(currentPassword, stored.value.password))) {
    return failureResponse(401, 'unauthenticated', 'The current password is not correct.');
  }

  const updated = await session.store.updateAccount(session.account.id, {
    password: await hashPassword(newPassword),
  });
  if (!updated.ok) return failureResponse(503, updated.error.kind, updated.error.message);

  // Revoke every other session: read the stored digests, keep the one that made this request.
  const revocation = await session.store.revokeOtherSessions(session.account.id, session.tokenHash);
  return jsonResponse({
    account: updated.value,
    revokedSessions: revocation.ok ? revocation.value : 0,
  });
}
