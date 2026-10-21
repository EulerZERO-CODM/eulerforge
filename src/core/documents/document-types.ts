/**
 * Document type registry.
 *
 * A document type describes *what kind of thing* a project is (a design canvas, an image, a
 * timeline …), independent of the studio that owns it. Studios reference these ids; the workspace
 * router uses them to pick a renderer: `design.canvas` gets the design workspace and
 * `illustration.artboard` gets the vector workspace. Every other type is still planned.
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
    availability: 'available',
    renderer: 'WebGL2 fragment-pass compositor with a Canvas 2D reference fallback (implemented)',
  },
  {
    id: typeId('video.timeline'),
    label: 'Video timeline',
    description: 'Time-based sequence with video, audio and title tracks.',
    studioId: 'video',
    unit: 's',
    availability: 'available',
    renderer:
      'Timeline model + decoded <video> elements composited onto a 2D canvas; MediaRecorder for a real-time capture',
  },
  {
    id: typeId('motion.scene'),
    label: 'Motion scene',
    description: 'Keyframed composition of shapes, text and imported artwork.',
    studioId: 'motion',
    unit: 's',
    availability: 'available',
    renderer: 'Scene evaluated per frame with the shared render plan; PNG frame sequence export',
  },
  {
    id: typeId('illustration.artboard'),
    label: 'Vector artboard',
    description: 'Resolution-independent paths, strokes and fills.',
    studioId: 'illustration',
    unit: 'px',
    availability: 'available',
    renderer:
      'Canvas 2D artboard painted through the shared renderer, with DOM node/handle overlays and a framework-free path kernel (implemented)',
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

/** The vector artboard type, used by the workspace router to pick the vector editing surface. */
export const ILLUSTRATION_ARTBOARD_ID = typeId('illustration.artboard');

/**
 * The document type a studio creates projects with.
 *
 * A studio may eventually own several document types (a design canvas and a multi-artboard print
 * document, say), so the creation flow asks for the *studio's* type rather than assuming one. Today
 * every available studio has exactly one, and a studio with none returns `undefined` so a caller can
 * refuse instead of inventing a document.
 */
export function primaryDocumentTypeForStudio(studioId: string): DocumentTypeDefinition | undefined {
  return documentTypesForStudio(studioId)[0];
}
