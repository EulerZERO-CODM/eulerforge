/**
 * Document patch shape.
 *
 * Lives in the domain layer rather than in the session so that commands (`src/core/editor`) can
 * describe a change without importing the browser-facing state module.
 */

import type { ForgeDocument } from './types';

/** Every mutable field of a document; identity and creation time are not editable. */
export type DocumentPatch = Partial<Omit<ForgeDocument, 'id' | 'schemaVersion' | 'createdAt'>>;
