/**
 * GET /api/documents — the signed-in account's documents, newest first.
 *
 * Only summaries are returned: a list of fifty projects must not serialise fifty photo documents
 * with embedded images over the wire. The document itself is fetched when it is opened.
 */

import { failureResponse, jsonResponse } from '../../../server/http';
import { requireAccount } from '../../../server/runtime';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const lookup = await requireAccount(request);
  if (lookup.kind === 'unavailable') {
    return failureResponse(503, 'unavailable', lookup.message);
  }
  if (lookup.kind !== 'session') {
    return failureResponse(401, 'unauthenticated', 'Sign in to see your documents.');
  }
  const session = lookup.session;
  const listed = await session.store.listDocuments(session.account.id);
  if (!listed.ok) return failureResponse(503, listed.error.kind, listed.error.message);
  return jsonResponse({ documents: listed.value });
}
