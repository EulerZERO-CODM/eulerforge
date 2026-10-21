/**
 * GET /api/auth/session
 *
 * The one endpoint the client calls on load to learn whether it is signed in. It deliberately
 * returns `200 { account: null }` for an anonymous browser: "not signed in" is a state, not an
 * error, and treating it as one is how clients end up showing red banners to first-time visitors.
 */

import { jsonResponse } from '../../../../server/http';
import { currentSession } from '../../../../server/runtime';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const { account, store } = await currentSession(request);
    const sessions = account ? await store.sessionCount(account.id) : null;
    return jsonResponse({
      account,
      activeSessions: sessions?.ok ? sessions.value : null,
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
