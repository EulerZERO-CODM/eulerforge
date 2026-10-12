/**
 * Minimal external store.
 *
 * Rationale (ADR-0007): this milestone needs shared, testable state without pulling a state
 * management library into the dependency tree. The store is a plain object — it can be unit tested
 * without React — and `useStore` binds it to React with `useSyncExternalStore`, which is SSR-safe
 * when a server snapshot is supplied.
 */

export type Listener = () => void;

export type Store<TState> = {
  getState: () => TState;
  setState: (next: TState | ((previous: TState) => TState)) => void;
  subscribe: (listener: Listener) => () => void;
};

/**
 * The read side of a store. React bindings accept this, which lets a store be implemented as a class
 * that owns its own state transitions (keeping `setState` private) — the pattern used by the
 * documents, preferences, toast and learning-progress stores.
 */
export type ReadableStore<TState> = {
  getState: () => TState;
  subscribe: (listener: Listener) => () => void;
};

export function createStore<TState>(initialState: TState): Store<TState> {
  let state = initialState;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState: (next) => {
      const resolved =
        typeof next === 'function' ? (next as (previous: TState) => TState)(state) : next;
      if (Object.is(resolved, state)) return;
      state = resolved;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
