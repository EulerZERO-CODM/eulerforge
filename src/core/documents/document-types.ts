/**
 * Document type registry.
 *
 * A document type describes *what kind of thing* a project is (a design canvas, an image, a
 * timeline …), independent of the studio that owns it. Studios reference these ids; the workspace
 * router uses them to pick a renderer. Only `design.canvas` has a working renderer in Phase 1.
 */

import type { DocumentTypeId } from './types';
import { brand } from '../types/brand';

export type DocumentTypeAvailability = 'available' | 'planned';

export type DocumentTypeDefinition = {
  readonly id: DocumentTypeId;
  readonly label: string;
  readonly description: string;
  /** Studio that owns this document type. */
  readonly studioId: string;
  /** Primary authoring unit. */
  readonly unit: 'px' | 'mm' | 'in' | 's' | 'scene';
  readonly availability: DocumentTypeAvailability;
  /** Renderer/surface this type will need, used for roadmap planning. */
  readonly renderer: string;
};

const typeId = (value: string): DocumentTypeId => brand<'DocumentTypeId'>(value);

export const DOCUMENT_TYPES: readonly DocumentTypeDefinition[] = [
  {
    id: typeId('design.canvas'),
    label: 'Design canvas',
    description: 'Fixed-size artboard for graphics, layouts and presentations.',
    studioId: 'design',
    unit: 'px',
    availability: 'available',
    renderer: 'DOM + CSS layout surface with SVG guide overlays (implemented)',
  },
  {
    id: typeId('photo.image'),
    label: 'Photo image',
    description: 'Single raster image with a non-destructive adjustment stack.',
    studioId: 'photo',
    unit: 'px',
    availability: 'planned',
    renderer: 'WebGL2 / WebGPU raster compositor',
  },
  {
    id: typeId('video.timeline'),
    label: 'Video timeline',
    description: 'Time-based sequence with tracks, clips, transitions and audio.',
    studioId: 'video',
    unit: 's',
    availability: 'planned',
    renderer: 'Timeline model + decoded frame preview (WebCodecs where available)',
  },
  {
    id: typeId('motion.scene'),
    label: 'Motion scene',
    description: 'Keyframed composition of shapes, text and imported artwork.',
    studioId: 'motion',
    unit: 's',
    availability: 'planned',
    renderer: 'Scene graph evaluated per frame; SVG/Canvas2D preview, frame-accurate export later',
  },
  {
    id: typeId('illustration.artboard'),
    label: 'Vector artboard',
    description: 'Resolution-independent paths, strokes and fills.',
    studioId: 'illustration',
    unit: 'px',
    availability: 'planned',
    renderer: 'Path model with SVG view layer and boolean operations',
  },
  {
    id: typeId('three.scene'),
    label: '3D scene',
    description: 'Exploratory: meshes, materials, cameras and lights.',
    studioId: 'three-d',
    unit: 'scene',
    availability: 'planned',
    renderer: 'WebGL2/WebGPU scene renderer (technology not committed)',
  },
] as const;

export function getDocumentType(id: DocumentTypeId | string): DocumentTypeDefinition | undefined {
  return DOCUMENT_TYPES.find((type) => (type.id as string) === String(id));
}

export function requireDocumentType(id: DocumentTypeId | string): DocumentTypeDefinition {
  const type = getDocumentType(id);
  if (!type) throw new Error(`Unknown document type: ${String(id)}`);
  return type;
}

export function documentTypesForStudio(studioId: string): readonly DocumentTypeDefinition[] {
  return DOCUMENT_TYPES.filter((type) => type.studioId === studioId);
}

export const DEFAULT_DOCUMENT_TYPE_ID = typeId('design.canvas');
