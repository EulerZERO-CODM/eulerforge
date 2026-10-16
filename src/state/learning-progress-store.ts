/**
 * Learning progress.
 *
 * Device-local, opt-in and small: which lessons and which guided-exercise steps the user has marked
 * complete. Stored through the same `KeyValueStorage` boundary as documents so a future sync
 * adapter can reuse it.
 */

import { storageKey, type KeyValueStorage } from '../core/persistence/storage';
import { createStore, type Store } from '../lib/create-store';

export const LEARNING_PROGRESS_KEY = storageKey('learning-progress');

export type LessonProgress = {
  /** ISO timestamp when the lesson was marked complete, or null while in progress. */
  readonly completedAt: string | null;
  /** Ids of completed guided-exercise steps. */
  readonly steps: readonly string[];
};

export type LearningProgressState = {
  readonly records: Readonly<Record<string, LessonProgress>>;
  readonly loaded: boolean;
};

const EMPTY_STATE: LearningProgressState = { records: {}, loaded: false };

type PersistedShape = {
  readonly version: number;
  readonly records: Readonly<Record<string, LessonProgress>>;
};

/**
 * Reads the persisted shape defensively: the value came from storage, so its type is a claim rather
 * than a guarantee, and a corrupt record must reset progress instead of crashing the shell.
 */
function readRecords(value: unknown): Readonly<Record<string, LessonProgress>> {
  if (typeof value !== 'object' || value === null) return {};
  const candidate = value as { version?: unknown; records?: unknown };
  if (candidate.version !== 1) return {};
  if (typeof candidate.records !== 'object' || candidate.records === null) return {};
  const records: Record<string, LessonProgress> = {};
  for (const [slug, entry] of Object.entries(candidate.records)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { completedAt?: unknown; steps?: unknown };
    records[slug] = {
      completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
      steps: Array.isArray(record.steps)
        ? record.steps.filter((step): step is string => typeof step === 'string')
        : [],
    };
  }
  return records;
}

export class LearningProgressStore {
  private readonly store: Store<LearningProgressState>;

  public constructor(
    private readonly storage: KeyValueStorage,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = createStore<LearningProgressState>(EMPTY_STATE);
    this.load();
  }

  public subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  public getState(): LearningProgressState {
    return this.store.getState();
  }

  /**
   * The state a server render saw: the store is created with this value and may load afterwards, and
   * React needs the first of the two to hydrate against the markup the server sent (see `useStore`).
   */
  public get initialState(): LearningProgressState {
    return this.store.initialState;
  }

  private load(): void {
    const raw = this.storage.get(LEARNING_PROGRESS_KEY);
    if (!raw.ok || raw.value === null) {
      this.store.setState({ records: {}, loaded: true });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw.value);
      this.store.setState({ records: readRecords(parsed), loaded: true });
    } catch {
      // Progress is disposable; a corrupt record resets rather than blocking the app.
      this.store.setState({ records: {}, loaded: true });
    }
  }

  private persist(): void {
    const payload: PersistedShape = { version: 1, records: this.store.getState().records };
    this.storage.set(LEARNING_PROGRESS_KEY, JSON.stringify(payload));
  }

  public getLesson(slug: string): LessonProgress {
    return this.store.getState().records[slug] ?? { completedAt: null, steps: [] };
  }

  public isComplete(slug: string): boolean {
    return this.getLesson(slug).completedAt !== null;
  }

  public isStepComplete(slug: string, stepId: string): boolean {
    return this.getLesson(slug).steps.includes(stepId);
  }

  public setLessonComplete(slug: string, complete: boolean): void {
    const current = this.getLesson(slug);
    this.update(slug, {
      completedAt: complete ? this.now().toISOString() : null,
      steps: current.steps,
    });
  }

  public toggleLesson(slug: string): boolean {
    const next = !this.isComplete(slug);
    this.setLessonComplete(slug, next);
    return next;
  }

  public toggleStep(slug: string, stepId: string): boolean {
    const current = this.getLesson(slug);
    const complete = current.steps.includes(stepId);
    this.update(slug, {
      completedAt: current.completedAt,
      steps: complete ? current.steps.filter((id) => id !== stepId) : [...current.steps, stepId],
    });
    return !complete;
  }

  public completedLessonCount(): number {
    return Object.values(this.store.getState().records).filter(
      (record) => record.completedAt !== null,
    ).length;
  }

  public completedStepCount(): number {
    return Object.values(this.store.getState().records).reduce(
      (total, record) => total + record.steps.length,
      0,
    );
  }

  public reset(): void {
    this.storage.remove(LEARNING_PROGRESS_KEY);
    this.store.setState({ records: {}, loaded: true });
  }

  private update(slug: string, progress: LessonProgress): void {
    const previous = this.store.getState();
    this.store.setState({
      records: { ...previous.records, [slug]: progress },
      loaded: previous.loaded,
    });
    this.persist();
  }
}
