/**
 * Preferences persistence.
 *
 * Tolerant by design: a corrupt or partial preferences record falls back to defaults field by field
 * rather than blocking the application. Unlike documents (which are user data), preferences are
 * cheap to recreate, so resilience beats strictness here.
 */

import { ok, type Result } from '../result';
import { storageKey, type KeyValueStorage } from '../persistence/storage';
import { DEFAULT_PREFERENCES, preferencesSchema, type Preferences } from './types';

export const PREFERENCES_KEY = storageKey('preferences');

export type PreferencesLoadResult = {
  readonly preferences: Preferences;
  /** Non-null when stored values had to be discarded; surfaced in Settings diagnostics. */
  readonly notice: string | null;
};

export class LocalPreferencesRepository {
  public constructor(private readonly storage: KeyValueStorage) {}

  public load(): PreferencesLoadResult {
    const raw = this.storage.get(PREFERENCES_KEY);
    if (!raw.ok) {
      return { preferences: DEFAULT_PREFERENCES, notice: raw.error.message };
    }
    if (raw.value === null) {
      return { preferences: DEFAULT_PREFERENCES, notice: null };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw.value);
    } catch {
      return {
        preferences: DEFAULT_PREFERENCES,
        notice: 'Stored preferences were unreadable and have been reset to defaults.',
      };
    }

    const parsed = preferencesSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return {
        preferences: DEFAULT_PREFERENCES,
        notice:
          'Stored preferences did not match the expected shape and have been reset to defaults.',
      };
    }

    return { preferences: parsed.data, notice: null };
  }

  public save(preferences: Preferences): Result<Preferences> {
    const parsed = preferencesSchema.safeParse(preferences);
    if (!parsed.success) {
      // A programmer error rather than user input: fail loudly in development.
      throw new Error('Attempted to persist invalid preferences.');
    }
    const written = this.storage.set(PREFERENCES_KEY, JSON.stringify(parsed.data));
    return written.ok ? ok(parsed.data) : written;
  }

  public reset(): Result<void> {
    return this.storage.remove(PREFERENCES_KEY);
  }
}
