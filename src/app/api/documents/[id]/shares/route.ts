/**
 * /api/documents/:id/shares — read-only share links for one document.
 *
 * The raw token is returned **once**, when the link is created, and never again: the server keeps a
 * SHA-256 digest, so a stolen data directory cannot be turned into working links. An optional expiry
 * is expressed in days and capped, because "forever" is occasionally right and "ten years" never is.
 */

import {
  crossOriginRequest,
  failureResponse,
  jsonResponse,
  readJsonBody,
  storeErrorResponse,
} from '../../../../../server/http';
import { readNumber } from '../../../../../server/fields';
import { requireAccount } from '../../../../../server/runtime';
import { issueToken } from '../../../../../server/sessions';
import { shareView } from '../../../../../server/store';

export const runtime = 'nodejs';

const MAX_TTL_DAYS = 365;

type Context = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const session = await requireAccount(request);
  if (!session) return failureResponse(401, 'unauthenticated', 'Sign in to manage share links.');
  const { id } = await context.params;
  const shares = await session.store.listShares(session.account.id, id);
  if (!shares.ok) return storeErrorResponse(shares.error);
  return jsonResponse({ shares: shares.value });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const session = await requireAccount(request);
  if (!session) return failureResponse(401, 'unauthenticated', 'Sign in to share a document.');
  const { id } = await context.params;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const days = readNumber(body.value, 'expiresInDays') ?? 7;
  if (!Number.isFinite(days) || days <= 0 || days > MAX_TTL_DAYS) {
    return failureResponse(
      422,
      'validation',
      `Choose an expiry between 1 and ${String(MAX_TTL_DAYS)} days.`,
      {
        issues: ['expiresInDays'],
      },
    );
  }

  const issued = issueToken();
  const created = await session.store.createShare({
    ownerId: session.account.id,
    documentId: id,
    tokenHash: issued.tokenHash,
    ttlMs: Math.round(days * 24 * 60 * 60 * 1000),
  });
  if (!created.ok) return storeErrorResponse(created.error);

  return jsonResponse(
    {
      // The one and only time this value exists on the server side of the response.
      token: issued.token,
      url: `/shared/${issued.token}`,
      share: shareView(created.value),
    },
    { status: 201 },
  );
}
