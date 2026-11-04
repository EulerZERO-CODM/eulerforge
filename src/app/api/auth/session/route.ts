/**
 * GET /api/auth/session
 *
 * The one endpoint the client calls on load to learn whether it is signed in. It deliberately
 * returns `200 { account: null }` for an anonymous browser: "not signed in" is a state, not an
 * error, and treating it as one is how clients end up showing red banners to first-time visitors.
 *
 * A deployment that cannot store accounts at all is a third state, and it is reported with the
 * store's own sentence. Saying "the server is not reachable" there would be a false cause: on a
 * serverless host the server answered this very request, and the reason accounts do not work is a
 * non-persistent filesystem. The account panel shows this text verbatim, so the wording is the
 * difference between a visitor understanding the limitation and concluding the app is broken.
 */

import { jsonResponse } from '../../../../server/http';
import { requireAccount } from '../../../../server/runtime';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const lookup = await requireAccount(request);
    if (lookup.kind === 'unavailable') {
      return jsonResponse(
        { account: null, activeSessions: null, unavailable: lookup.message },
        { status: 200 },
      );
    }
    if (lookup.kind !== 'session') return jsonResponse({ account: null, activeSessions: null });
    const { account, store } = lookup.session;
    const sessions = await store.sessionCount(account.id);
    return jsonResponse({
      account,
      activeSessions: sessions.ok ? sessions.value : null,
    });
  } catch {
    return jsonResponse(
      {
        account: null,
        activeSessions: null,
        unavailable:
          'The optional server is not reachable. The app keeps working with local storage only.',
      },
      { status: 200 },
    );
  }
}
