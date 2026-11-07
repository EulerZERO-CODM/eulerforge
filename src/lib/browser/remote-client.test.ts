import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSession } from './remote-client';

/**
 * The first question the account panel asks has to be answered, even when the network is not.
 *
 * A `fetch` that never settles is a real browser condition: a captive portal, a proxy that blackholes
 * the connection, or a server that accepts the connection and then says nothing. The panel cannot
 * distinguish that from "still checking", so without a timeout it says "Checking whether the optional
 * server is running…" for as long as the tab is open. This pins the timeout and the sentence it
 * produces.
 */

describe('fetchSession', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('reports an unreachable server when the request never settles', async () => {
    // A promise that never resolves: the request is in flight forever.
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    ) as typeof fetch;

    const pending = fetchSession();
    await vi.advanceTimersByTimeAsync(10_000);
    const state = await pending;

    expect(state.status).toBe('unavailable');
    if (state.status === 'unavailable') {
      expect(state.notice).toMatch(/could not be reached/i);
      expect(state.notice).toMatch(/still works in this browser/i);
    }
  });

  it('does not impose its own timeout when the caller supplies a signal', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return Promise.resolve(
        new Response(JSON.stringify({ account: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const state = await fetchSession(controller.signal);
    expect(state.status).toBe('anonymous');
    expect(seen).toBe(controller.signal);
  });
});
