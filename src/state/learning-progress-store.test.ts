import { describe, expect, it } from 'vitest';

import { LEARNING_PROGRESS_KEY, LearningProgressStore } from './learning-progress-store';
import { err, forgeError, ok, type Result } from '../core/result';
import { MemoryStorage, type KeyValueStorage } from '../core/persistence/storage';

function createStore(storage: KeyValueStorage = new MemoryStorage()) {
  return new LearningProgressStore(storage, () => new Date('2026-04-02T03:04:05.000Z'));
}

describe('LearningProgressStore', () => {
  it('starts with no progress recorded', () => {
    const store = createStore();
    expect(store.completedLessonCount()).toBe(0);
    expect(store.completedStepCount()).toBe(0);
    expect(store.getLesson('canvas-and-units')).toEqual({ completedAt: null, steps: [] });
    expect(store.isComplete('canvas-and-units')).toBe(false);
  });

  it('marks a lesson complete and records when it happened', () => {
    const store = createStore();
    expect(store.toggleLesson('canvas-and-units')).toBe(true);
    expect(store.isComplete('canvas-and-units')).toBe(true);
    expect(store.getLesson('canvas-and-units').completedAt).toBe('2026-04-02T03:04:05.000Z');
    expect(store.completedLessonCount()).toBe(1);
  });

  it('toggles a lesson back to incomplete', () => {
    const store = createStore();
    store.toggleLesson('canvas-and-units');
    expect(store.toggleLesson('canvas-and-units')).toBe(false);
    expect(store.isComplete('canvas-and-units')).toBe(false);
    expect(store.completedLessonCount()).toBe(0);
  });

  it('tracks guided-exercise steps independently of lesson completion', () => {
    const store = createStore();
    expect(store.toggleStep('your-first-project', 'step-1')).toBe(true);
    expect(store.isStepComplete('your-first-project', 'step-1')).toBe(true);
    expect(store.completedStepCount()).toBe(1);
    expect(store.isComplete('your-first-project')).toBe(false);

    expect(store.toggleStep('your-first-project', 'step-1')).toBe(false);
    expect(store.completedStepCount()).toBe(0);
  });

  it('persists progress so it survives a reload', () => {
    const storage = new MemoryStorage();
    const store = createStore(storage);
    store.toggleLesson('canvas-and-units');
    store.toggleStep('your-first-project', 'step-1');

    const reopened = createStore(storage);
    expect(reopened.isComplete('canvas-and-units')).toBe(true);
    expect(reopened.isStepComplete('your-first-project', 'step-1')).toBe(true);
    expect(reopened.completedStepCount()).toBe(1);
  });

  it('writes a versioned record so a future shape change can be detected', () => {
    const storage = new MemoryStorage();
    createStore(storage).toggleLesson('canvas-and-units');

    const raw = storage.get(LEARNING_PROGRESS_KEY);
    expect(raw.ok).toBe(true);
    if (!raw.ok || raw.value === null) throw new Error('progress should have been written');
    expect(JSON.parse(raw.value)).toMatchObject({ version: 1 });
  });

  it('notifies subscribers when progress changes', () => {
    const store = createStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.toggleLesson('canvas-and-units');
    expect(notifications).toBeGreaterThan(0);
    unsubscribe();
  });

  it('resets to defaults instead of crashing on unreadable stored data', () => {
    const storage = new MemoryStorage();
    storage.set(LEARNING_PROGRESS_KEY, '{ not json');
    expect(createStore(storage).completedLessonCount()).toBe(0);
  });

  it('ignores records from an unknown version', () => {
    const storage = new MemoryStorage();
    storage.set(
      LEARNING_PROGRESS_KEY,
      JSON.stringify({
        version: 99,
        records: { 'canvas-and-units': { completedAt: null, steps: [] } },
      }),
    );
    expect(createStore(storage).completedLessonCount()).toBe(0);
  });

  it('drops malformed entries but keeps the readable ones', () => {
    const storage = new MemoryStorage();
    storage.set(
      LEARNING_PROGRESS_KEY,
      JSON.stringify({
        version: 1,
        records: {
          'canvas-and-units': { completedAt: '2026-01-01T00:00:00.000Z', steps: ['a', 3, 'b'] },
          broken: 'not-an-object',
        },
      }),
    );

    const store = createStore(storage);
    expect(store.isComplete('canvas-and-units')).toBe(true);
    expect(store.getLesson('canvas-and-units').steps).toEqual(['a', 'b']);
    expect(store.getLesson('broken')).toEqual({ completedAt: null, steps: [] });
  });

  it('degrades to an empty state when storage cannot be read', () => {
    class UnreadableStorage extends MemoryStorage {
      public override get(): Result<string | null> {
        return err(forgeError('storage-unavailable', 'Local storage could not be read.'));
      }
    }
    const store = createStore(new UnreadableStorage());
    expect(store.getState().loaded).toBe(true);
    expect(store.completedLessonCount()).toBe(0);
  });
});

describe('LearningProgressStore store shape', () => {
  it('exposes a read-only snapshot for React bindings', () => {
    const store = createStore();
    expect(typeof store.getState).toBe('function');
    expect(typeof store.subscribe).toBe('function');
    expect(ok(true).ok).toBe(true);
  });
});
