/**
 * Validation schemas for the document domain.
 *
 * Zod is used at every trust boundary: user input, `localStorage` payloads and future network
 * responses. The compile-time assertion at the bottom of this file guarantees the schema output
 * stays assignable to the hand-written domain types in `./types.ts`.
 */

import { z } from 'zod';

import { brand, type Branded } from '../types/brand';
import type {
  Canvas,
  CreateDocumentInput,
  DocumentMetadata,
  ForgeDocument,
  GuideSettings,
} from './types';
import { MAX_CANVAS_PX, MIN_CANVAS_PX } from './units';

/** Branded-but-validated identifier: lowercase-ish slug ids such as `design.canvas`. */
export const idSchema = <TName extends string>(_name: TName) =>
  z
    .string()
    .min(1, 'must not be empty')
    .max(80, 'must be 80 characters or fewer')
    .regex(
      /^[a-z0-9][a-z0-9._:-]*$/i,
      'may only contain letters, numbers, dot, dash, colon, underscore',
    )
    .transform((value): Branded<string, TName> => brand<TName>(value));

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex colour such as #1f2933');

export const canvasSchema = z.object({
  width: z
    .number()
    .int('width must be a whole number of pixels')
    .min(MIN_CANVAS_PX, `width must be at least ${MIN_CANVAS_PX}px`)
    .max(MAX_CANVAS_PX, `width must be at most ${MAX_CANVAS_PX}px`),
  height: z
    .number()
    .int('height must be a whole number of pixels')
    .min(MIN_CANVAS_PX, `height must be at least ${MIN_CANVAS_PX}px`)
    .max(MAX_CANVAS_PX, `height must be at most ${MAX_CANVAS_PX}px`),
  unit: z.enum(['px', 'mm', 'in']),
  dpi: z.number().min(36, 'dpi must be at least 36').max(1200, 'dpi must be at most 1200'),
  background: hexColorSchema,
  transparent: z.boolean(),
}) satisfies z.ZodType<Canvas>;

export const guideSettingsSchema = z.object({
  safeMarginMm: z.number().min(0).max(100),
  bleedMm: z.number().min(0).max(50),
  showGrid: z.boolean(),
  gridMm: z.number().min(1).max(100),
  showCentreLines: z.boolean(),
}) satisfies z.ZodType<GuideSettings>;

export const documentMetadataSchema = z.object({
  authorLabel: z.string().max(80),
  tags: z
    .array(z.string().min(1).max(40))
    .max(12, 'a document may carry at most 12 tags')
    .readonly(),
  notes: z.string().max(2000),
}) satisfies z.ZodType<DocumentMetadata>;

export const forgeDocumentSchema = z.object({
  id: idSchema('DocumentId'),
  schemaVersion: z.number().int().min(1),
  studioId: z.string().min(1),
  documentTypeId: idSchema('DocumentTypeId'),
  title: z
    .string()
    .min(1, 'a document needs a title')
    .max(120, 'title must be 120 characters or fewer'),
  summary: z.string().max(400),
  canvas: canvasSchema,
  guides: guideSettingsSchema,
  palette: z.array(hexColorSchema).max(12).readonly(),
  metadata: documentMetadataSchema,
  status: z.enum(['draft', 'in-review', 'ready', 'archived']),
  revision: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createDocumentInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'give the project a name')
    .max(120, 'project names are limited to 120 characters'),
  summary: z.string().trim().max(400).optional(),
  studioId: z.string().min(1),
  documentTypeId: idSchema('DocumentTypeId'),
  canvas: canvasSchema,
  guides: guideSettingsSchema.partial().optional(),
  palette: z.array(hexColorSchema).max(12).readonly().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).readonly().optional(),
});

/** Human-readable, field-addressed messages for anything shaped like a Zod error. */
export function formatIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string[] {
  return issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/* -------------------------------------------------------------------------------------------- */
/* Compile-time guard: schema output must remain assignable to the domain model in ./types.ts.    */
/* -------------------------------------------------------------------------------------------- */

type Assignable<T extends U, U> = T;

export type _ForgeDocumentSchemaMatchesDomain = Assignable<
  z.infer<typeof forgeDocumentSchema>,
  ForgeDocument
>;
export type _CanvasSchemaMatchesDomain = Assignable<z.infer<typeof canvasSchema>, Canvas>;
export type _GuideSchemaMatchesDomain = Assignable<
  z.infer<typeof guideSettingsSchema>,
  GuideSettings
>;
export type _MetadataSchemaMatchesDomain = Assignable<
  z.infer<typeof documentMetadataSchema>,
  DocumentMetadata
>;
export type _CreateDocumentInputSchemaMatchesDomain = Assignable<
  z.infer<typeof createDocumentInputSchema>,
  CreateDocumentInput
>;
