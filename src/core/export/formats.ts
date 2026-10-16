/**
 * Export and rendering formats.
 *
 * Format records describe *capabilities*, not implementation promises. `status` is the promise:
 * `available` means this build really writes that file. Phase 1 shipped the project file only; Phase 2
 * adds PNG and JPEG through the shared renderer (ADR-0016). Everything else stays `planned` and the UI
 * must present it as such (docs/DECISIONS.md -> ADR-0013).
 */

import type { DocumentTypeId } from '../documents/types';
import { brand, type Branded } from '../types/brand';

export type ExportFormatId = Branded<string, 'ExportFormatId'>;

export type ExportFormatKind = 'document' | 'raster' | 'vector' | 'video' | 'audio' | 'model3d';

export type ExportFormatCapabilities = {
  /** Can carry an alpha channel. */
  readonly transparency: boolean;
  /** Can carry motion or animation. */
  readonly animation: boolean;
  /** Suitable for print production (bleed, CMYK-ish, high DPI). */
  readonly printReady: boolean;
  /** Lossy compression is applied. */
  readonly lossy: boolean;
};

export type ExportFormat = {
  readonly id: ExportFormatId;
  readonly label: string;
  readonly extension: string;
  readonly mediaType: string;
  readonly kind: ExportFormatKind;
  readonly capabilities: ExportFormatCapabilities;
  readonly status: 'available' | 'planned';
  /** Shown to users: what the format is for, and what is not supported yet. */
  readonly notes: string;
};

const formatId = (value: string): ExportFormatId => brand<'ExportFormatId'>(value);

export const PROJECT_FILE_FORMAT_ID = formatId('forge-json');

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  {
    id: PROJECT_FILE_FORMAT_ID,
    label: "Euler's Forge project file",
    extension: 'forge.json',
    mediaType: 'application/json',
    kind: 'document',
    capabilities: { transparency: false, animation: false, printReady: false, lossy: false },
    status: 'available',
    notes:
      'The document model itself: canvas, guides, palette and metadata. Re-importable in a later phase; this is not a rendered image.',
  },
  {
    id: formatId('png'),
    label: 'PNG',
    extension: 'png',
    mediaType: 'image/png',
    kind: 'raster',
    capabilities: { transparency: true, animation: false, printReady: false, lossy: false },
    status: 'available',
    notes:
      'Lossless raster export with alpha, drawn at the canvas size multiplied by the chosen scale. Transparency is preserved exactly.',
  },
  {
    id: formatId('jpg'),
    label: 'JPEG',
    extension: 'jpg',
    mediaType: 'image/jpeg',
    kind: 'raster',
    capabilities: { transparency: false, animation: false, printReady: true, lossy: true },
    status: 'available',
    notes:
      'Smaller photographic output with a quality control. No alpha: transparent areas are flattened onto a background you choose.',
  },
  {
    id: formatId('webp'),
    label: 'WebP',
    extension: 'webp',
    mediaType: 'image/webp',
    kind: 'raster',
    capabilities: { transparency: true, animation: true, printReady: false, lossy: true },
    status: 'planned',
    notes: 'Modern web delivery format with alpha and animation support.',
  },
  {
    id: formatId('svg'),
    label: 'SVG',
    extension: 'svg',
    mediaType: 'image/svg+xml',
    kind: 'vector',
    capabilities: { transparency: true, animation: false, printReady: true, lossy: false },
    status: 'available',
    notes:
      'Vector export of paths, rectangles and ellipses, written to a real file by the browser. Text is not outlined and graphic layers are raster, so a document containing them is exported only after the panel names them (or not at all).',
  },
  {
    id: formatId('pdf'),
    label: 'PDF',
    extension: 'pdf',
    mediaType: 'application/pdf',
    kind: 'vector',
    capabilities: { transparency: true, animation: false, printReady: true, lossy: false },
    status: 'planned',
    notes:
      'Print pipeline with bleed and crop marks. Planned after the print document model lands.',
  },
  {
    id: formatId('mp4'),
    label: 'MP4 (H.264)',
    extension: 'mp4',
    mediaType: 'video/mp4',
    kind: 'video',
    capabilities: { transparency: false, animation: true, printReady: false, lossy: true },
    status: 'planned',
    notes:
      'Video delivery format. Needs the timeline and encoder infrastructure of the Video Studio.',
  },
  {
    id: formatId('webm'),
    label: 'WebM',
    extension: 'webm',
    mediaType: 'video/webm',
    kind: 'video',
    capabilities: { transparency: true, animation: true, printReady: false, lossy: true },
    status: 'planned',
    notes: 'Web-friendly video with alpha; a candidate for browser-side encoding.',
  },
  {
    id: formatId('glb'),
    label: 'glTF binary',
    extension: 'glb',
    mediaType: 'model/gltf-binary',
    kind: 'model3d',
    capabilities: { transparency: false, animation: true, printReady: false, lossy: false },
    status: 'planned',
    notes: '3D scene interchange. Exploratory: the 3D studio has no committed delivery format yet.',
  },
] as const;

export function getExportFormat(id: string): ExportFormat | undefined {
  return EXPORT_FORMATS.find((format) => (format.id as string) === id);
}

export function listExportFormats(status?: ExportFormat['status']): readonly ExportFormat[] {
  return status ? EXPORT_FORMATS.filter((format) => format.status === status) : EXPORT_FORMATS;
}

/**
 * Declared output intent per document type. `planned` formats are aspirational and must be labelled
 * as such wherever they are shown.
 */
export const DOCUMENT_OUTPUT_FORMATS: Readonly<Record<string, readonly ExportFormatId[]>> = {
  'design.canvas': [
    PROJECT_FILE_FORMAT_ID,
    formatId('png'),
    formatId('jpg'),
    formatId('pdf'),
    formatId('svg'),
  ],
  'photo.image': [PROJECT_FILE_FORMAT_ID, formatId('png'), formatId('jpg'), formatId('webp')],
  'video.timeline': [PROJECT_FILE_FORMAT_ID, formatId('mp4'), formatId('webm')],
  'motion.scene': [PROJECT_FILE_FORMAT_ID, formatId('mp4'), formatId('webm')],
  'illustration.artboard': [PROJECT_FILE_FORMAT_ID, formatId('svg'), formatId('png')],
  'three.scene': [PROJECT_FILE_FORMAT_ID, formatId('glb')],
};

export function outputFormatsFor(documentTypeId: DocumentTypeId | string): readonly ExportFormat[] {
  const ids = DOCUMENT_OUTPUT_FORMATS[String(documentTypeId)] ?? [PROJECT_FILE_FORMAT_ID];
  return ids
    .map((id) => getExportFormat(id))
    .filter((format): format is ExportFormat => format !== undefined);
}
