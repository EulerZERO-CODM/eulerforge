import type { CommitOptions, DocumentPatch } from '../../state/document-session';
import type { SceneCommand } from '../../core/editor/commands';
import type { ForgeDocument } from '../../core/documents/types';
import type { Result } from '../../core/result';

/**
 * The contract every workspace panel uses to read and change the open document.
 *
 * Panels never touch the session, the store or storage directly: they call `commit` with a label and
 * a patch. That is why undo labels are always meaningful and why an invalid change can be rejected
 * in exactly one place.
 */
export type WorkspaceApi = {
  readonly doc: ForgeDocument;
  /**
   * Applies a change. Resolves to `true` when it was recorded and persisted.
   *
   * `options.coalesceKey` groups the steps of a continuous interaction (a slider drag, a colour
   * picker session) into one undoable step: see `CommitOptions` in the session.
   */
  readonly commit: (
    label: string,
    patch: DocumentPatch,
    options?: CommitOptions,
  ) => Promise<boolean>;
  /**
   * Applies an editor command.
   *
   * Takes the command's `Result` rather than a bare command so a panel can pass the outcome of a
   * builder without unwrapping it: a failure (a layer that no longer exists, an invalid value) is
   * reported to the user instead of being dropped on the floor.
   */
  readonly run: (command: Result<SceneCommand>, options?: CommitOptions) => Promise<boolean>;
  readonly undo: () => void;
  readonly redo: () => void;
};
