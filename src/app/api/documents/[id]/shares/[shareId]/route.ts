/**
 * DELETE /api/documents/:id/shares/:shareId — revoke one link.
 *
 * Scoped to the owner twice: the store checks the share's owner and the document id in the path, so
 * a link id guessed from elsewhere cannot be revoked, and cannot be used to probe whether it exists
 * (the answer is the same `404`).
 */

import {
  crossOriginRequest,
  failureResponse,
  jsonResponse,
  storeErrorResponse,
} from '../../../../../../server/http';
import { requireAccount } from '../../../../../../server/runtime';

export const runtime = 'nodejs';

type Context = {
  readonly params: Promise<{ readonly id: string; readonly shareId: string }>;
};

export async function DELETE(request: Request, context: Context): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const lookup = await requireAccount(request);
  if (lookup.kind === 'unavailable') {
    return failureResponse(503, 'unavailable', lookup.message);
  }
  if (lookup.kind !== 'session') {
    return failureResponse(401, 'unauthenticated', 'Sign in to revoke share links.');
  }
  const session = lookup.session;
  const { id, shareId } = await context.params;

  const shares = await session.store.listShares(session.account.id, id);
  if (!shares.ok) return storeErrorResponse(shares.error);
  if (!shares.value.some((share) => share.id === shareId)) {
    return failureResponse(404, 'not-found', 'No such share link.');
  }
  const revoked = await session.store.revokeShare(session.account.id, shareId);
  if (!revoked.ok) return storeErrorResponse(revoked.error);
  return jsonResponse({ deleted: true });
}
