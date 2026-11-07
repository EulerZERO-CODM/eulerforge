/**
 * GET /api/shared/:token — a read-only view of a shared document.
 *
 * The token identifies the link; the response carries the document and nothing else about the owner.
 * A revoked, expired or unknown token is the same `404`, so a link cannot be probed.
 */

import { failureResponse, jsonResponse, storeErrorResponse } from '../../../../server/http';
import { getStore } from '../../../../server/runtime';
import { hashToken, looksLikeToken } from '../../../../server/sessions';

export const runtime = 'nodejs';

type Context = { readonly params: Promise<{ readonly token: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { token } = await context.params;
  if (!looksLikeToken(token)) {
    return failureResponse(404, 'not-found', 'That share link is not valid.');
  }
  const storeResult = await getStore();
  if (!storeResult.ok)
    return failureResponse(503, storeResult.error.kind, storeResult.error.message);

  const resolved = await storeResult.value.resolveShare(hashToken(token));
  if (!resolved.ok) return storeErrorResponse(resolved.error);

  return jsonResponse({
    document: resolved.value.document,
    revision: resolved.value.revision,
    updatedAt: resolved.value.updatedAt,
    readOnly: true,
  });
}
