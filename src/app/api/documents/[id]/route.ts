/**
 * /api/documents/:id — one document.
 *
 * `PUT` is the sync endpoint. The client sends the revision it last saw; the server refuses a stale
 * write with `409` and the *server's* revision and timestamp, so the interface can show both sides.
 * A document is validated with the platform's own schema before it is stored: the server never keeps
 * something the app would refuse to open.
 */

import {
  crossOriginRequest,
  failureResponse,
  jsonResponse,
  readJsonBody,
  storeErrorResponse,
} from '../../../../server/http';
import { readRevision, readValue } from '../../../../server/fields';
import { requireAccount } from '../../../../server/runtime';

export const runtime = 'nodejs';

type Context = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const session = await requireAccount(request);
  if (!session) return failureResponse(401, 'unauthenticated', 'Sign in to open this document.');
  const { id } = await context.params;
  const stored = await session.store.getDocument(session.account.id, id);
  if (!stored.ok) return storeErrorResponse(stored.error);
  return jsonResponse({
    document: stored.value.document,
    revision: stored.value.revision,
    updatedAt: stored.value.updatedAt,
  });
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const session = await requireAccount(request);
  if (!session) return failureResponse(401, 'unauthenticated', 'Sign in to save this document.');
  const { id } = await context.params;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const baseRevision = readRevision(body.value, 'baseRevision');
  if (baseRevision === undefined) {
    return failureResponse(422, 'validation', 'baseRevision must be a revision number or null.', {
      issues: ['baseRevision'],
    });
  }
  const document = readValue(body.value, 'document');
  if (document === undefined) {
    return failureResponse(422, 'validation', 'The request carries no document.', {
      issues: ['document'],
    });
  }

  const saved = await session.store.saveDocument({
    ownerId: session.account.id,
    id,
    document,
    baseRevision,
  });
  if (!saved.ok) return storeErrorResponse(saved.error);
  return jsonResponse({
    document: saved.value.document,
    revision: saved.value.revision,
    updatedAt: saved.value.updatedAt,
  });
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failureResponse(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const session = await requireAccount(request);
  if (!session) return failureResponse(401, 'unauthenticated', 'Sign in to delete this document.');
  const { id } = await context.params;
  const removed = await session.store.deleteDocument(session.account.id, id);
  if (!removed.ok) return storeErrorResponse(removed.error);
  return jsonResponse({ deleted: true });
}
