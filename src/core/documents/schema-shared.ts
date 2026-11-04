/**
 * Schema fragments shared between the document schema and the studio payload schemas.
 *
 * They live in their own module so `schema.ts` can import `payload-schema.ts` without a cycle: the
 * payload schema validates a payload that is embedded in a document, and the document schema
 * validates everything else around it.
 */

import { z } from 'zod';

/** `#rrggbb`, the only colour notation the document model stores. */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex colour such as #1f2933');
