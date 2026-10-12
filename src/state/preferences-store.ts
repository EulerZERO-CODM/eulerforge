/**
 * Preferences store.
 *
 * Synchronous, device-local and tolerant of corrupt records (see `LocalPreferencesRepository`).
 * Exposes a `notice` so the settings screen can tell the user when stored values had to be reset
 * instead of pretending nothing happened.
 */

import { type LocalPreferencesRepository } from '../core/preferences/repository';
import type { Preferences } from '../core/preferences/types';
import { createStore, type Store } from '../lib/create-store';

export type PreferencesState = {
  readonly preferences: Preferences;
  readonly notice: string | null;
  readonly loaded: boolean;
};

export class PreferencesStore {
  private readonly store: Store<PreferencesState>;

  public constructor(
    private readonly repository: LocalPreferencesRepository,
    now: () => Date = () => new Date(),
  ) {
    void now;
    const { preferences, notice } = repository.load();
    this.store = createStore<PreferencesState>({ preferences, notice, loaded: true });
  }

  public subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  public getState(): PreferencesState {
    return this.store.getState();
  }

  /** Applies a partial update and persists it. Returns false when persistence failed. */
  public update(patch: Partial<Preferences>): boolean {
    const next = { ...this.store.getState().preferences, ...patch };
    const saved = this.repository.save(next);
    if (!saved.ok) {
      this.store.setState((previous) => ({ ...previous, notice: saved.error.message }));
      return false;
    }
    this.store.setState({ preferences: saved.value, notice: null, loaded: true });
    return true;
  }

  public reset(): boolean {
    const removed = this.repository.reset();
    if (!removed.ok) return false;
    const { preferences } = this.repository.load();
    this.store.setState({ preferences, notice: 'Preferences restored to defaults.', loaded: true });
    return true;
  }
}
