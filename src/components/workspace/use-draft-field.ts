'use client';

import { useState } from 'react';

/**
 * Controlled-input helper for inspector fields.
 *
 * Text fields keep a local draft while the user types, commit on blur or Enter (Escape reverts), and
 * surface the commit's error message inline. The draft resynchronises whenever the underlying
 * document value changes — for example after an undo — so the panel never shows a stale number.
 */
export type UseDraftFieldOptions = {
  /** Formatted value from the document. */
  readonly value: string;
  /** Applies the raw input. Returns an error message, or null on success. */
  readonly onCommit: (raw: string) => string | null;
};

export type DraftField = {
  readonly draft: string;
  readonly error: string | null;
  readonly editing: boolean;
  readonly setDraft: (value: string) => void;
  readonly commit: () => void;
  readonly revert: () => void;
  readonly onBlur: () => void;
  /** Handles Enter (commit) and Escape (revert) for inputs and textareas. */
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

export function useDraftField({ value, onCommit }: UseDraftFieldOptions): DraftField {
  const [draft, setDraftState] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // React's documented "adjust state when a prop changes" pattern: when the document value moves
  // (after an undo, for example) and the field is not being edited, resynchronise during render
  // rather than in an effect, which would cost an extra render pass.
  const [lastKnownValue, setLastKnownValue] = useState(value);
  if (!editing && value !== lastKnownValue) {
    setLastKnownValue(value);
    setDraftState(value);
    setError(null);
  }

  return {
    draft,
    error,
    editing,
    setDraft: (next) => {
      setEditing(true);
      setDraftState(next);
      setError(null);
    },
    commit: () => {
      const message = onCommit(draft);
      if (message) {
        setError(message);
        return;
      }
      setEditing(false);
      setError(null);
    },
    revert: () => {
      setDraftState(value);
      setError(null);
      setEditing(false);
    },
    onBlur: () => {
      if (!editing) return;
      const message = onCommit(draft);
      if (message) {
        setError(message);
        return;
      }
      setEditing(false);
      setError(null);
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const message = onCommit(draft);
        if (message) {
          setError(message);
          return;
        }
        setEditing(false);
        setError(null);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setDraftState(value);
        setError(null);
        setEditing(false);
        event.currentTarget.blur();
      }
    },
  };
}
