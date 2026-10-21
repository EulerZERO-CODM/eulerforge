/**
 * Validation schemas for the three studio payloads.
 *
 * Kept beside the document schema because a payload is part of a saved document and is loaded
 * through the same `migrateDocument` trust boundary. Every collection and number is bounded in
 * `payload.ts`; this file only states those bounds to Zod.
 */

import { z } from 'zod';

import {
  MAX_MASK_POINTS,
  MAX_MASK_RANGES,
  MAX_MASK_STROKES,
  MAX_MOTION_DURATION,
  MAX_MOTION_FPS,
  MAX_MOTION_KEYFRAMES,
  MAX_MOTION_TRACKS,
  MAX_PHOTO_ADJUSTMENTS,
  MAX_PHOTO_HREF_LENGTH,
  MAX_RETOUCH_STROKES,
  MAX_VIDEO_CLIPS,
  MAX_VIDEO_DURATION,
  MAX_VIDEO_FPS,
  MAX_VIDEO_MEDIA,
  MAX_VIDEO_TRACKS,
  MOTION_PROPERTIES,
  PHOTO_ADJUSTMENT_KINDS,
  PHOTO_ADJUSTMENT_INFO,
  PHOTO_ENGINE_PREFERENCES,
  RETOUCH_MODES,
  TITLE_POSITIONS,
} from './payload';
import { hexColorSchema } from './schema-shared';

const finite = (label: string) => z.number().finite(`${label} must be finite`);

const payloadId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i, 'must be a plain identifier');

/* --------------------------------------------------------------------------------------------- */
/* Photo                                                                                         */
/* --------------------------------------------------------------------------------------------- */

const photoSourceSchema = z.object({
  name: z.string().min(1).max(160),
  href: z
    .string()
    .min(1)
    .max(MAX_PHOTO_HREF_LENGTH)
    .refine(
      (value) => /^data:image\/(?:png|jpeg|webp);base64,/.test(value),
      'the working copy must be an embedded PNG, JPEG or WebP data URL',
    ),
  width: finite('width').int().min(1).max(8192),
  height: finite('height').int().min(1).max(8192),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  originalWidth: finite('originalWidth').int().min(1).max(100_000),
  originalHeight: finite('originalHeight').int().min(1).max(100_000),
});

const photoPointSchema = z.object({
  x: finite('x').min(-0.25).max(1.25),
  y: finite('y').min(-0.25).max(1.25),
});

const photoAdjustmentSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(PHOTO_ADJUSTMENT_KINDS),
    value: finite('value'),
    enabled: z.boolean(),
  })
  .superRefine((adjustment, context) => {
    const info = PHOTO_ADJUSTMENT_INFO[adjustment.kind];
    if (adjustment.value < info.min || adjustment.value > info.max) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: `${info.label} must be between ${String(info.min)} and ${String(info.max)}`,
      });
    }
  });

const maskStrokeSchema = z.object({
  id: z.string().min(1).max(80),
  points: z.array(photoPointSchema).min(1).max(MAX_MASK_POINTS).readonly(),
  radius: finite('radius').min(0.001).max(0.5),
  hardness: finite('hardness').min(0).max(1),
  erase: z.boolean(),
  fill: z.boolean(),
});

const photoRangeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: z.string().min(1).max(80),
      kind: z.literal('luminance'),
      min: finite('min').min(0).max(1),
      max: finite('max').min(0).max(1),
      feather: finite('feather').min(0).max(1),
    })
    .refine((range) => range.min <= range.max, {
      message: 'the luminance range must start at or below its end',
      path: ['max'],
    }),
  z.object({
    id: z.string().min(1).max(80),
    kind: z.literal('colour'),
    colour: hexColorSchema,
    tolerance: finite('tolerance').min(0).max(1),
    feather: finite('feather').min(0).max(1),
  }),
]);

const photoMaskSchema = z.object({
  strokes: z.array(maskStrokeSchema).max(MAX_MASK_STROKES).readonly(),
  // Optional so v5 documents written before range selections existed still validate.
  ranges: z.array(photoRangeSchema).max(MAX_MASK_RANGES).readonly().optional(),
  inverted: z.boolean(),
});

const retouchStrokeSchema = z.object({
  id: z.string().min(1).max(80),
  mode: z.enum(RETOUCH_MODES),
  points: z.array(photoPointSchema).min(1).max(MAX_MASK_POINTS).readonly(),
  radius: finite('radius').min(0.001).max(0.5),
  hardness: finite('hardness').min(0).max(1),
  offsetX: finite('offsetX').min(-1).max(1),
  offsetY: finite('offsetY').min(-1).max(1),
});

export const photoPayloadSchema = z.object({
  kind: z.literal('photo'),
  version: z.literal(1),
  source: photoSourceSchema.nullable(),
  adjustments: z.array(photoAdjustmentSchema).max(MAX_PHOTO_ADJUSTMENTS).readonly(),
  mask: photoMaskSchema.nullable(),
  retouch: z.array(retouchStrokeSchema).max(MAX_RETOUCH_STROKES).readonly(),
  engine: z.enum(PHOTO_ENGINE_PREFERENCES),
});

/* --------------------------------------------------------------------------------------------- */
/* Motion                                                                                        */
/* --------------------------------------------------------------------------------------------- */

const motionEasingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linear') }),
  z.object({ kind: z.literal('ease-in') }),
  z.object({ kind: z.literal('ease-out') }),
  z.object({ kind: z.literal('ease-in-out') }),
  z.object({ kind: z.literal('hold') }),
  z.object({
    kind: z.literal('cubic'),
    x1: finite('x1').min(0).max(1),
    y1: finite('y1').min(-2).max(3),
    x2: finite('x2').min(0).max(1),
    y2: finite('y2').min(-2).max(3),
  }),
]);

const motionKeyframeSchema = z.object({
  id: z.string().min(1).max(80),
  time: finite('time').min(0).max(MAX_MOTION_DURATION),
  value: finite('value'),
  easing: motionEasingSchema,
});

const motionTrackSchema = z.object({
  layerId: payloadId,
  property: z.enum(MOTION_PROPERTIES),
  keyframes: z.array(motionKeyframeSchema).max(MAX_MOTION_KEYFRAMES).readonly(),
});

export const motionPayloadSchema = z.object({
  kind: z.literal('motion'),
  version: z.literal(1),
  duration: finite('duration').min(0.5).max(MAX_MOTION_DURATION),
  fps: finite('fps').int().min(1).max(MAX_MOTION_FPS),
  tracks: z.array(motionTrackSchema).max(MAX_MOTION_TRACKS).readonly(),
});

/* --------------------------------------------------------------------------------------------- */
/* Video                                                                                         */
/* --------------------------------------------------------------------------------------------- */

const videoMediaSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  kind: z.enum(['video', 'audio']),
  mimeType: z.string().min(1).max(120),
  duration: finite('duration').min(0).max(MAX_VIDEO_DURATION),
  width: finite('width').int().min(0).max(16_384),
  height: finite('height').int().min(0).max(16_384),
  size: finite('size').int().min(0),
});

const videoClipSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(['video', 'audio']),
  mediaId: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  start: finite('start').min(0).max(MAX_VIDEO_DURATION),
  duration: finite('duration').min(0.05).max(MAX_VIDEO_DURATION),
  inPoint: finite('inPoint').min(0).max(MAX_VIDEO_DURATION),
  volume: finite('volume').min(0).max(1),
  muted: z.boolean(),
});

const titleClipSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.literal('title'),
  text: z.string().min(1).max(200),
  start: finite('start').min(0).max(MAX_VIDEO_DURATION),
  duration: finite('duration').min(0.05).max(MAX_VIDEO_DURATION),
  color: hexColorSchema,
  background: hexColorSchema.nullable(),
  fontSize: finite('fontSize').min(8).max(400),
  position: z.enum(TITLE_POSITIONS),
});

export const videoPayloadSchema = z.object({
  kind: z.literal('video'),
  version: z.literal(1),
  duration: finite('duration').min(0.5).max(MAX_VIDEO_DURATION),
  fps: finite('fps').int().min(1).max(MAX_VIDEO_FPS),
  media: z.array(videoMediaSchema).max(MAX_VIDEO_MEDIA).readonly(),
  tracks: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        kind: z.enum(['video', 'audio', 'title']),
        name: z.string().min(1).max(80),
        clips: z
          .array(z.union([videoClipSchema, titleClipSchema]))
          .max(MAX_VIDEO_CLIPS)
          .readonly(),
      }),
    )
    .max(MAX_VIDEO_TRACKS)
    .readonly(),
});

export const studioPayloadValueSchema = z.discriminatedUnion('kind', [
  photoPayloadSchema,
  motionPayloadSchema,
  videoPayloadSchema,
]);

export const studioPayloadSchema = studioPayloadValueSchema.nullable();
