import type { DocumentPatch } from '../../state/document-session';
import type { ForgeDocument } from '../../core/documents/types';

/**
 * The contract every workspace panel uses to read and change the open document.
 *
 * Panels never touch the session, the store or storage directly: they call `commit` with a label and
 * a patch. That is why undo labels are always meaningful and why an invalid change can be rejected
 * in exactly one place.
 */
export type WorkspaceApi = {
  readonly doc: ForgeDocument;
  /** Applies a change. Resolves to `true` when it was recorded and persisted. */
  readonly commit: (label: string, patch: DocumentPatch) => Promise<boolean>;
  readonly undo: () => void;
  readonly redo: () => void;
};
