/**
 * Undo/redo history.
 *
 * A framework-free, immutable-state history stack. It is the integration point every studio will
 * use: a studio commits a labelled change, and undo/redo, the history panel and (later) command
 * serialisation all read from the same structure.
 *
 * Scope note: this is a linear history for a single document. Collaborative editing, branching and
 * persistent history are explicitly out of scope for this phase.
 */

export type HistoryEntry<TState> = {
  /** Monotonic id, stable for React keys and for future command serialisation. */
  readonly id: number;
  readonly label: string;
  /** State *before* the change was applied, so undo is a plain restore. */
  readonly previous: TState;
  readonly appliedAt: string;
};

export type HistorySnapshot<TState> = {
  readonly state: TState;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Labels oldest → newest for the history panel. */
  readonly labels: readonly { readonly id: number; readonly label: string }[];
  /** Number of undoable steps. */
  readonly depth: number;
};

export type HistoryOptions<TState> = {
  readonly initial: TState;
  /** Maximum number of undoable steps kept. Oldest entries are discarded first. */
  readonly limit?: number;
  readonly now?: () => Date;
};

export const DEFAULT_HISTORY_LIMIT = 100;

export class HistoryStack<TState> {
  private past: HistoryEntry<TState>[] = [];
  private future: HistoryEntry<TState>[] = [];
  private current: TState;
  private nextId = 1;

  private readonly limit: number;
  private readonly now: () => Date;

  public constructor(options: HistoryOptions<TState>) {
    this.current = options.initial;
    this.limit = Math.max(1, options.limit ?? DEFAULT_HISTORY_LIMIT);
    this.now = options.now ?? (() => new Date());
  }

  public getState(): TState {
    return this.current;
  }

  public canUndo(): boolean {
    return this.past.length > 0;
  }

  public canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * Commits a new state with a human label.
   * @returns the entry that was recorded, or `null` when the updater produced an identical state.
   */
  public commit(
    label: string,
    nextState: TState,
    equals?: (a: TState, b: TState) => boolean,
  ): HistoryEntry<TState> | null {
    const isEqual = equals ? equals(this.current, nextState) : Object.is(this.current, nextState);
    if (isEqual) return null;

    const entry: HistoryEntry<TState> = {
      id: this.nextId,
      label,
      previous: this.current,
      appliedAt: this.now().toISOString(),
    };
    this.nextId += 1;

    this.past.push(entry);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = nextState;
    return entry;
  }

  /**
   * Replaces the newest entry instead of adding one.
   *
   * Used for a *continuous* interaction: dragging a slider or moving through a colour picker fires a
   * change per step, and every one of those steps is the same edit. The entry keeps the state the
   * interaction started from, so undo returns to before the drag rather than to the previous step,
   * and its label is updated to describe where the interaction ended up.
   *
   * @returns the entry that was updated, or `null` when there is nothing to replace.
   */
  public replaceLatest(label: string, nextState: TState): HistoryEntry<TState> | null {
    const entry = this.past[this.past.length - 1];
    if (!entry) return null;
    const replacement: HistoryEntry<TState> = {
      ...entry,
      label,
      appliedAt: this.now().toISOString(),
    };
    this.past[this.past.length - 1] = replacement;
    // A replacement is still a new edit: anything that was undone can no longer be redone.
    this.future = [];
    this.current = nextState;
    return replacement;
  }

  /** Reverts the most recent change. Returns the new state, or `null` if there was nothing to undo. */
  public undo(): TState | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.unshift({ ...entry, previous: this.current });
    this.current = entry.previous;
    return this.current;
  }

  /** Re-applies the most recently undone change. */
  public redo(): TState | null {
    const entry = this.future.shift();
    if (!entry) return null;
    this.past.push({ ...entry, previous: this.current });
    this.current = entry.previous;
    return this.current;
  }

  /** Replaces the present without recording history. Used when loading a document. */
  public reset(state: TState): void {
    this.past = [];
    this.future = [];
    this.current = state;
  }

  /**
   * Replaces the present state without recording a history entry.
   *
   * Used after an undo or a redo: the *content* comes from an earlier state, but the caller may
   * need to adjust it before it is saved — a document, for example, has to carry a revision that
   * does not go backwards. The undo and redo stacks are left exactly as they were, so the history
   * still describes the same edits.
   */
  public replaceCurrent(state: TState): void {
    this.current = state;
  }

  public clear(): void {
    this.past = [];
    this.future = [];
  }

  public snapshot(): HistorySnapshot<TState> {
    return {
      state: this.current,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      labels: this.past.map((entry) => ({ id: entry.id, label: entry.label })),
      depth: this.past.length,
    };
  }
}
