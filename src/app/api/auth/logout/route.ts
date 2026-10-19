/**
 * POST /api/auth/logout
 *
 * Deletes the session record the cookie points at and clears the cookie. Idempotent: signing out of
 * an already-signed-out browser is a success, not a 401.
 */

import {
  clearedSessionCookie,
  crossOriginRequest,
  failureResponse,
  jsonResponse,
} from '../../../../server/http';
import { getStore, requireAccount } from '../../../../server/runtime';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const session = await requireAccount(request);
  if (session) {
    await session.store.deleteSession(session.tokenHash);
  } else {
    // Still check that the store is reachable: clearing a cookie while the server is down would
    // look like a successful sign-out and leave the session alive on the server.
    const store = await getStore();
    if (!store.ok) return failureResponse(503, store.error.kind, store.error.message);
  }
  return jsonResponse(
    { signedOut: true },
    { headers: { 'Set-Cookie': clearedSessionCookie(request) } },
  );
}
