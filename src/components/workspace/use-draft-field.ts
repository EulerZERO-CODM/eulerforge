'use client';

import { useRef, useState } from 'react';

/**
 * Controlled-input helper for inspector fields.
 *
 * Text fields keep a local draft while the user types, commit on blur or Enter (Escape reverts), and
 * surface the commit's error message inline. The draft resynchronises whenever the underlying
 * document value changes — for example after an undo — so the panel never shows a stale number.
 *
 * Escape cancels the whole edit, blur included: it reverts the draft and takes focus away from the
 * field, and the blur that follows must not commit the value that was just refused. React has not
 * applied `editing: false` by the time that synchronous blur arrives, so the cancellation is recorded
 * in a ref rather than in state.
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
  /** Set while an Escape is blurring the field, so the blur it causes does not commit. */
  const cancelled = useRef(false);
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
      if (cancelled.current) {
        cancelled.current = false;
        return;
      }
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
        const element = event.currentTarget;
        // Only a focused field fires the blur this flag is guarding, so it is only armed when that
        // blur is really coming — otherwise it would swallow the next, unrelated one.
        if (element === element.ownerDocument.activeElement) {
          cancelled.current = true;
          element.blur();
        }
      }
    },
  };
}
