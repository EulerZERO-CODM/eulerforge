import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { createStore } from './create-store';
import { useStore } from './use-store';

/**
 * Store-backed rendering across a server render and a client hydration.
 *
 * A server render builds the store, renders it and discards it, so the markup a browser is served can
 * only ever show the store's *initial* state. On the client the store is built again — and it can
 * already have loaded by the time React hydrates a component, because the shell's effects run before a
 * deferred boundary (a streamed one, or a page behind `loading.tsx`) is hydrated. These tests pin the
 * behaviour that keeps the two renders in step: the hydration render reports the initial state, and
 * the first render after it reports the live state.
 */

type State = { readonly status: 'idle' | 'ready'; readonly items: readonly string[] };

const INITIAL: State = { status: 'idle', items: [] };

function reader(store: ReturnType<typeof createStore<State>>): () => ReactNode {
  return function Reader(): ReactNode {
    const state = useStore(store);
    return <p data-testid="state">{`${state.status}:${state.items.join(',')}`}</p>;
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('useStore', () => {
  it('hydrates from the state the server rendered, then shows the live state', async () => {
    const store = createStore<State>(INITIAL);
    const Reader = reader(store);
    const serverHtml = renderToString(<Reader />);
    expect(serverHtml).toContain('idle:');

    // What the shell's effect does before a deferred boundary hydrates: the store loads.
    store.setState({ status: 'ready', items: ['alpha'] });

    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recovered: unknown[] = [];

    await act(async () => {
      hydrateRoot(container, <Reader />, {
        onRecoverableError: (error: unknown) => recovered.push(error),
      });
    });

    // The markup the server sent was kept...
    expect(recovered).toEqual([]);
    // ...and the store's real state arrived immediately afterwards, as an ordinary update.
    expect(container.textContent).toBe('ready:alpha');
  });

  it('shows the live state when it is not hydrating', () => {
    const store = createStore<State>(INITIAL);
    store.setState({ status: 'ready', items: ['beta'] });
    const Reader = reader(store);

    render(<Reader />);

    // A client-side render waits for nothing: the initial state is only the answer *while* hydrating.
    expect(screen.getByTestId('state')).toHaveTextContent('ready:beta');
  });
});
