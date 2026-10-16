import { describe, expect, it } from 'vitest';

import { DEFAULT_HISTORY_LIMIT, HistoryStack } from './history';

type Snapshot = { readonly value: number; readonly label: string };

/** Domain-equality predicate: two snapshots with the same value are the same edit. */
const sameValue = (a: Snapshot, b: Snapshot) => a.value === b.value;

function createStack(limit?: number) {
  return new HistoryStack<Snapshot>({
    initial: { value: 0, label: 'initial' },
    ...(limit === undefined ? {} : { limit }),
  });
}

describe('HistoryStack', () => {
  it('starts empty and cannot undo or redo', () => {
    const history = createStack();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.getState().value).toBe(0);
    expect(history.snapshot().labels).toEqual([]);
    expect(history.snapshot().depth).toBe(0);
  });

  it('records a labelled step and exposes it through the snapshot', () => {
    const history = createStack();
    const entry = history.commit('Set canvas size', { value: 1, label: 'one' });

    expect(entry).not.toBeNull();
    expect(entry?.label).toBe('Set canvas size');
    expect(history.canUndo()).toBe(true);
    expect(history.getState().value).toBe(1);
    expect(history.snapshot().labels.map((item) => item.label)).toEqual(['Set canvas size']);
    expect(history.snapshot().depth).toBe(1);
  });

  it('ignores a commit that the equality predicate calls identical', () => {
    const history = createStack();
    history.commit('First change', { value: 1, label: 'one' });
    const duplicate = history.commit(
      'Nothing changed',
      { value: 1, label: 'different label' },
      sameValue,
    );

    expect(duplicate).toBeNull();
    expect(history.snapshot().labels).toHaveLength(1);
  });

  it('undoes and redoes in order', () => {
    const history = createStack();
    history.commit('First', { value: 1, label: 'one' });
    history.commit('Second', { value: 2, label: 'two' });

    expect(history.undo()?.value).toBe(1);
    expect(history.canRedo()).toBe(true);
    expect(history.undo()?.value).toBe(0);
    expect(history.undo()).toBeNull();

    expect(history.redo()?.value).toBe(1);
    expect(history.redo()?.value).toBe(2);
    expect(history.redo()).toBeNull();
  });

  it('drops the redo branch once a new change is committed', () => {
    const history = createStack();
    history.commit('First', { value: 1, label: 'one' });
    history.undo();
    expect(history.canRedo()).toBe(true);

    history.commit('Replacement', { value: 5, label: 'five' });
    expect(history.canRedo()).toBe(false);
    expect(history.getState().value).toBe(5);
  });

  it('bounds the number of retained steps', () => {
    const history = createStack(3);
    for (let value = 1; value <= 5; value += 1) {
      history.commit(`Step ${value}`, { value, label: `v${value}` });
    }
    expect(history.snapshot().labels).toHaveLength(3);
    expect(history.snapshot().labels.map((item) => item.label)).toEqual([
      'Step 3',
      'Step 4',
      'Step 5',
    ]);

    history.undo();
    history.undo();
    history.undo();
    expect(history.undo()).toBeNull();
  });

  it('defaults to the documented limit', () => {
    expect(DEFAULT_HISTORY_LIMIT).toBe(100);
  });

  it('resets the present without recording history', () => {
    const history = createStack();
    history.commit('First', { value: 1, label: 'one' });
    history.reset({ value: 9, label: 'loaded' });

    expect(history.getState().value).toBe(9);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it('clears history but keeps the current state', () => {
    const history = createStack();
    history.commit('First', { value: 1, label: 'one' });
    history.clear();

    expect(history.getState().value).toBe(1);
    expect(history.canUndo()).toBe(false);
  });

  describe('replaceLatest', () => {
    it('collapses a continuous interaction into the entry it started', () => {
      const history = createStack();
      history.commit('Set opacity', { value: 40, label: '40%' });
      history.replaceLatest('Set opacity', { value: 55, label: '55%' });
      history.replaceLatest('Set opacity', { value: 70, label: '70%' });

      expect(history.snapshot().depth).toBe(1);
      expect(history.snapshot().labels.map((item) => item.label)).toEqual(['Set opacity']);
      expect(history.getState().value).toBe(70);
      // The entry still remembers where the interaction started, not its previous step.
      expect(history.undo()?.value).toBe(0);
      expect(history.canUndo()).toBe(false);
    });

    it('redoes the value the interaction ended on', () => {
      const history = createStack();
      history.replaceLatest('No entry yet', { value: 3, label: 'three' });
      history.commit('Set opacity', { value: 40, label: '40%' });
      history.replaceLatest('Set opacity', { value: 70, label: '70%' });

      history.undo();
      expect(history.getState().value).toBe(0);
      expect(history.redo()?.value).toBe(70);
    });

    it('renames the entry to describe where the interaction ended', () => {
      const history = createStack();
      history.commit('Set opacity', { value: 40, label: '40%' });
      const replacement = history.replaceLatest('Set opacity to 70%', { value: 70, label: '70%' });

      expect(replacement?.label).toBe('Set opacity to 70%');
      expect(replacement?.id).toBe(history.snapshot().labels[0]?.id);
      expect(history.snapshot().labels.map((item) => item.label)).toEqual(['Set opacity to 70%']);
    });

    it('returns null when there is nothing to replace', () => {
      const history = createStack();
      expect(history.replaceLatest('Set opacity', { value: 1, label: 'one' })).toBeNull();
      expect(history.canUndo()).toBe(false);
      expect(history.getState().value).toBe(0);
    });

    it('discards the redo branch, like any other new edit', () => {
      const history = createStack();
      history.commit('First', { value: 1, label: 'one' });
      history.commit('Second', { value: 2, label: 'two' });
      history.undo();
      expect(history.canRedo()).toBe(true);

      history.replaceLatest('Second, continued', { value: 7, label: 'seven' });
      expect(history.canRedo()).toBe(false);
      expect(history.getState().value).toBe(7);
    });
  });
});
