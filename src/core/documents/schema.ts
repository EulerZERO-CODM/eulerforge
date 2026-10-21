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
  AttributionRecord,
  ImageLayer,
  Layer,
  RectLayer,
  Scene,
  TextLayer,
  TextSettings,
} from './layer-types';
import {
  FONT_STACKS,
  IMAGE_FITS,
  MAX_ATTRIBUTION_RECORDS,
  MAX_FRAME_COORDINATE,
  MAX_LAYERS,
  MAX_LAYER_NAME_LENGTH,
  MAX_LAYER_SIZE,
  MAX_TEXT_LENGTH,
  MIN_LAYER_SIZE,
  TEXT_ALIGNMENTS,
} from './layer-types';
import type {
  Canvas,
  CreateDocumentInput,
  DocumentMetadata,
  ForgeDocument,
  GuideSettings,
} from './types';
import {
  MAX_AUTHOR_LABEL_LENGTH,
  MAX_DOCUMENT_TAGS,
  MAX_NOTES_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TAG_LENGTH,
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
  authorLabel: z.string().max(MAX_AUTHOR_LABEL_LENGTH),
  tags: z
    .array(z.string().min(1).max(MAX_TAG_LENGTH))
    .max(MAX_DOCUMENT_TAGS, `a document may carry at most ${String(MAX_DOCUMENT_TAGS)} tags`)
    .readonly(),
  notes: z.string().max(MAX_NOTES_LENGTH),
}) satisfies z.ZodType<DocumentMetadata>;

/* -------------------------------------------------------------------------------------------- */
/* Layers                                                                                        */
/* -------------------------------------------------------------------------------------------- */

/**
 * A finite number that survives JSON.
 *
 * `NaN` and `Infinity` are rejected explicitly: `JSON.stringify` turns them into `null`, so a value
 * that passes validation but cannot round-trip would corrupt a saved document on reload.
 */
const finiteNumber = (label: string) => z.number().finite(`${label} must be a finite number`);

const layerNameSchema = z
  .string()
  .trim()
  .min(1, 'a layer needs a name')
  .max(MAX_LAYER_NAME_LENGTH, `layer names are limited to ${MAX_LAYER_NAME_LENGTH} characters`);

export const layerFrameSchema = z.object({
  x: finiteNumber('x').min(-MAX_FRAME_COORDINATE).max(MAX_FRAME_COORDINATE),
  y: finiteNumber('y').min(-MAX_FRAME_COORDINATE).max(MAX_FRAME_COORDINATE),
  width: finiteNumber('width')
    .min(MIN_LAYER_SIZE, `layer width must be at least ${MIN_LAYER_SIZE}px`)
    .max(MAX_LAYER_SIZE, `layer width must be at most ${MAX_LAYER_SIZE}px`),
  height: finiteNumber('height')
    .min(MIN_LAYER_SIZE, `layer height must be at least ${MIN_LAYER_SIZE}px`)
    .max(MAX_LAYER_SIZE, `layer height must be at most ${MAX_LAYER_SIZE}px`),
});

const baseLayerShape = {
  id: idSchema('LayerId'),
  name: layerNameSchema,
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: finiteNumber('opacity')
    .min(0, 'opacity cannot be below 0')
    .max(1, 'opacity cannot exceed 1'),
  frame: layerFrameSchema,
};

/**
 * Weights are listed as literals rather than inferred from `FONT_WEIGHTS` so that the compile-time
 * guard below can prove the schema and the domain type agree; the UI reads the domain list.
 */
export const textSettingsSchema = z.object({
  content: z.string().max(MAX_TEXT_LENGTH, `text is limited to ${MAX_TEXT_LENGTH} characters`),
  fontStackId: z.enum(FONT_STACKS),
  fontSize: finiteNumber('fontSize')
    .min(4, 'font size must be at least 4px')
    .max(800, 'font size must be at most 800px'),
  fontWeight: z.union([
    z.literal(300),
    z.literal(400),
    z.literal(500),
    z.literal(600),
    z.literal(700),
    z.literal(800),
  ]),
  lineHeight: finiteNumber('lineHeight')
    .min(0.5, 'line height must be at least 0.5x')
    .max(4, 'line height must be at most 4x'),
  letterSpacing: finiteNumber('letterSpacing').min(-50).max(200),
  align: z.enum(TEXT_ALIGNMENTS),
  color: hexColorSchema,
}) satisfies z.ZodType<TextSettings>;

export const shapeSettingsSchema = z.object({
  fill: hexColorSchema.nullable(),
  stroke: hexColorSchema.nullable(),
  strokeWidth: finiteNumber('strokeWidth').min(0).max(200),
  cornerRadius: finiteNumber('cornerRadius').min(0).max(5_000),
});

/**
 * Image sources allowed in a document.
 *
 * Only same-origin/relative paths, `http(s)` URLs and `data:image/...` payloads. This rejects
 * `javascript:` and other schemes that would turn a saved document into a script-injection vector
 * when it is loaded back into the renderer.
 */
export const imageHrefSchema = z
  .string()
  .min(1, 'an image layer needs a source')
  .max(2048, 'image source is limited to 2048 characters')
  .refine(
    (value) => /^(?:\.{0,2}\/|\/|https?:\/\/|data:image\/)/.test(value) && !/[\s<>"']/.test(value),
    'image source must be a relative path, an http(s) URL or an image data URL',
  );

export const imageSettingsSchema = z.object({
  assetId: z.string().min(1).max(80).nullable(),
  href: imageHrefSchema,
  intrinsicWidth: finiteNumber('intrinsicWidth')
    .min(0)
    .max(MAX_CANVAS_PX * 2),
  intrinsicHeight: finiteNumber('intrinsicHeight')
    .min(0)
    .max(MAX_CANVAS_PX * 2),
  fit: z.enum(IMAGE_FITS),
  tint: hexColorSchema.nullable(),
});

export const textLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('text'),
  text: textSettingsSchema,
});

export const rectLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('rect'),
  shape: shapeSettingsSchema,
});

export const ellipseLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('ellipse'),
  shape: shapeSettingsSchema,
});

export const imageLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('image'),
  image: imageSettingsSchema,
});

export const layerSchema = z.discriminatedUnion('type', [
  textLayerSchema,
  rectLayerSchema,
  ellipseLayerSchema,
  imageLayerSchema,
]);

/**
 * The scene, with a uniqueness guard on layer ids.
 *
 * Duplicate ids would make selection, reordering and deletion ambiguous rather than merely odd, so
 * they are a validation failure instead of something the editor has to tolerate.
 */
export const sceneSchema = z
  .object({
    layers: z
      .array(layerSchema)
      .max(MAX_LAYERS, `a document may hold at most ${MAX_LAYERS} layers`)
      .readonly(),
  })
  .superRefine((scene, ctx) => {
    const seen = new Set<string>();
    scene.layers.forEach((layer, index) => {
      if (seen.has(layer.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['layers', index, 'id'],
          message: `duplicate layer id "${layer.id}"`,
        });
      }
      seen.add(layer.id);
    });
  });

export const attributionRecordSchema = z.object({
  id: z.string().min(1).max(120),
  assetId: z.string().min(1).max(80),
  assetName: z.string().min(1).max(120),
  assetKind: z.string().min(1).max(40),
  licenseId: z.string().min(1).max(80),
  licenseName: z.string().min(1).max(160),
  licenseUrl: z.string().max(2048).nullable(),
  attributionRequired: z.boolean(),
  commercialUse: z.boolean(),
  author: z.string().max(160),
  source: z.string().max(400),
  verified: z.boolean(),
  notes: z.string().max(2000),
  placedAt: z.iso.datetime(),
});

export const attributionSchema = z
  .array(attributionRecordSchema)
  .max(
    MAX_ATTRIBUTION_RECORDS,
    `a document may record at most ${MAX_ATTRIBUTION_RECORDS} attributions`,
  )
  .readonly();

export const forgeDocumentSchema = z.object({
  id: idSchema('DocumentId'),
  schemaVersion: z.number().int().min(1),
  studioId: z.string().min(1),
  documentTypeId: idSchema('DocumentTypeId'),
  title: z
    .string()
    .min(1, 'a document needs a title')
    .max(120, 'title must be 120 characters or fewer'),
  summary: z.string().max(MAX_SUMMARY_LENGTH),
  canvas: canvasSchema,
  guides: guideSettingsSchema,
  palette: z.array(hexColorSchema).max(12).readonly(),
  scene: sceneSchema,
  attribution: attributionSchema,
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
  scene: sceneSchema.optional(),
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
export type _SceneSchemaMatchesDomain = Assignable<z.infer<typeof sceneSchema>, Scene>;
export type _LayerSchemaMatchesDomain = Assignable<z.infer<typeof layerSchema>, Layer>;
export type _TextLayerSchemaMatchesDomain = Assignable<z.infer<typeof textLayerSchema>, TextLayer>;
export type _RectLayerSchemaMatchesDomain = Assignable<z.infer<typeof rectLayerSchema>, RectLayer>;
export type _ImageLayerSchemaMatchesDomain = Assignable<
  z.infer<typeof imageLayerSchema>,
  ImageLayer
>;
export type _AttributionSchemaMatchesDomain = Assignable<
  z.infer<typeof attributionRecordSchema>,
  AttributionRecord
>;
