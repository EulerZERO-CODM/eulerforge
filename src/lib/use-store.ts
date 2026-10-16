'use client';

import { useCallback, useSyncExternalStore } from 'react';

import type { ReadableStore } from '../lib/create-store';

/**
 * Binds an external store to React.
 *
 * The server snapshot is the store's *initial* state, not its current one. A server render builds the
 * store, renders it and throws it away, so the markup a browser is served shows that state. On the
 * client the store is built again and may already have loaded by the time React hydrates a component
 * — the shell's effects run before a deferred boundary (a streamed one, or a page behind a
 * `loading.tsx`) is hydrated — and reporting the loaded state in that first render made React throw
 * the server's markup away and re-render the page. The initial state is the honest answer for that
 * render; the live state follows one render later, as an ordinary update.
 *
 * The callbacks are created here rather than passing `store.subscribe`/`store.getState` directly:
 * class-based stores expose them as prototype methods, and handing React a detached method would
 * lose its `this` binding.
 */
export function useStore<TState>(store: ReadableStore<TState>): TState {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getState(), [store]);
  const getServerSnapshot = useCallback(() => store.initialState, [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
