/**
 * GET /api/server/status — what this optional server is, and what it is not.
 *
 * The app must be able to say "the server is here, these features work, and none of them are required"
 * without probing each endpoint. Nothing here is a secret: the data directory path is **not**
 * included, and no credential is ever generated or read from the environment.
 */

import { MAX_DOCUMENT_BYTES, SERVER_SCHEMA_VERSION } from '../../../../server/store';
import { getStore } from '../../../../server/runtime';
import { jsonResponse } from '../../../../server/http';
import { MAX_BODY_BYTES } from '../../../../server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = await getStore();
  return jsonResponse({
    server: 'eulerforge-file-store',
    schemaVersion: SERVER_SCHEMA_VERSION,
    available: store.ok,
    ...(store.ok ? {} : { unavailable: store.error.message }),
    features: {
      accounts: true,
      sessions: true,
      documentSync: true,
      readOnlyShareLinks: true,
      remoteCatalogue: 'bundled-sample',
    },
    limits: {
      documentBytes: MAX_DOCUMENT_BYTES,
      requestBytes: MAX_BODY_BYTES,
    },
    note: 'Optional. The app is local-first: with this server unreachable, every studio, save, reopen and export continues to work against this browser’s storage. Storage is a JSON file store for one process, not a deployment claim.',
  });
}
