'use client';

import { useCallback, useSyncExternalStore } from 'react';

import type { ReadableStore } from '../lib/create-store';

/**
 * Binds an external store to React.
 *
 * The server snapshot is the store's current state, which keeps server and first client render
 * consistent for stores created with a deterministic initial value. Stores that read
 * browser-only data start in a loading state and hydrate after mount.
 *
 * The callbacks are created here rather than passing `store.subscribe`/`store.getState` directly:
 * class-based stores expose them as prototype methods, and handing React a detached method would
 * lose its `this` binding.
 */
export function useStore<TState>(store: ReadableStore<TState>): TState {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getState(), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
