/**
 * /api/account — the signed-in user's own record.
 *
 * `DELETE` is the data-ownership promise made concrete: it removes the account, every session, every
 * document the account owns and every share link pointing at one of them, then clears the cookie. It
 * requires an explicit `confirm` string so a stray request cannot delete an account.
 */

import {
  clearedSessionCookie,
  crossOriginRequest,
  failureResponse,
  jsonResponse,
  readJsonBody,
} from '../../../server/http';
import { readString } from '../../../server/fields';
import { requireAccount } from '../../../server/runtime';
import { validateDisplayName } from '../../../server/store';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const lookup = await requireAccount(request);
  if (lookup.kind === 'unavailable') {
    return failureResponse(503, 'unavailable', lookup.message);
  }
  if (lookup.kind !== 'session') {
    return failureResponse(401, 'unauthenticated', 'Sign in to see this account.');
  }
  const session = lookup.session;
  const sessions = await session.store.sessionCount(session.account.id);
  return jsonResponse({
    account: session.account,
    activeSessions: sessions.ok ? sessions.value : null,
  });
}

export async function PATCH(request: Request): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const lookup = await requireAccount(request);
  if (lookup.kind === 'unavailable') {
    return failureResponse(503, 'unavailable', lookup.message);
  }
  if (lookup.kind !== 'session') {
    return failureResponse(401, 'unauthenticated', 'Sign in to change this account.');
  }
  const session = lookup.session;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const displayName = readString(body.value, 'displayName', 120);
  if (displayName === null) {
    return failureResponse(422, 'validation', 'Nothing to change.', { issues: ['displayName'] });
  }
  const issue = validateDisplayName(displayName);
  if (issue !== null) {
    return failureResponse(422, 'validation', issue, { issues: ['displayName'] });
  }

  const updated = await session.store.updateAccount(session.account.id, { displayName });
  if (!updated.ok) return failureResponse(503, updated.error.kind, updated.error.message);
  return jsonResponse({ account: updated.value });
}

export async function DELETE(request: Request): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const lookup = await requireAccount(request);
  if (lookup.kind === 'unavailable') {
    return failureResponse(503, 'unavailable', lookup.message);
  }
  if (lookup.kind !== 'session') {
    return failureResponse(401, 'unauthenticated', 'Sign in to delete this account.');
  }
  const session = lookup.session;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  if (readString(body.value, 'confirm', 40) !== 'delete my account') {
    return failureResponse(422, 'validation', 'Type “delete my account” to confirm.', {
      issues: ['confirm'],
    });
  }

  const deleted = await session.store.deleteAccount(session.account.id);
  if (!deleted.ok) return failureResponse(503, deleted.error.kind, deleted.error.message);

  return jsonResponse(
    {
      deleted: true,
      documents: deleted.value.deletedDocuments,
      note: 'The account, its sessions, its documents and its share links were removed from this server.',
    },
    { headers: { 'Set-Cookie': clearedSessionCookie(request) } },
  );
}
