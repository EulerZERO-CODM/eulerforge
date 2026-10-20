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
import { requireAccount } from '../../../../server/runtime';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const lookup = await requireAccount(request);
  // Clearing a cookie while the store is unreachable would look like a successful sign-out and
  // leave the session alive on the server, so that case is a 503 rather than a cheerful 200.
  if (lookup.kind === 'unavailable') {
    return failureResponse(503, 'unavailable', lookup.message);
  }
  if (lookup.kind === 'session') {
    await lookup.session.store.deleteSession(lookup.session.tokenHash);
  }
  return jsonResponse(
    { signedOut: true },
    { headers: { 'Set-Cookie': clearedSessionCookie(request) } },
  );
}
