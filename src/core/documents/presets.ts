/**
 * Canvas presets.
 *
 * Dimensions are real, widely used starting points rather than invented numbers; print presets
 * carry their physical unit and reference DPI so the document model can round-trip them.
 */

import { brand } from '../types/brand';
import type { CanvasPreset, CanvasPresetId, CanvasPresetCategory } from './types';
import { fromPixels, PRINT_DPI, SCREEN_DPI, toPixels } from './units';

const presetId = (value: string): CanvasPresetId => brand<'CanvasPresetId'>(value);

export const CANVAS_PRESETS: readonly CanvasPreset[] = [
  {
    id: presetId('social.square'),
    label: 'Square post',
    description: 'Instagram / Facebook feed post',
    category: 'social',
    size: { width: 1080, height: 1080 },
    unit: 'px',
    dpi: SCREEN_DPI,
    background: '#0f1115',
  },
  {
    id: presetId('social.portrait'),
    label: 'Portrait post',
    description: 'Higher-reach 4:5 feed post',
    category: 'social',
    size: { width: 1080, height: 1350 },
    unit: 'px',
    dpi: SCREEN_DPI,
    background: '#0f1115',
  },
  {
    id: presetId('social.story'),
    label: 'Story / Reel cover',
    description: '9:16 vertical, thumb-safe centre',
    category: 'social',
    size: { width: 1080, height: 1920 },
    unit: 'px',
    dpi: SCREEN_DPI,
    background: '#0f1115',
  },
  {
    id: presetId('web.og'),
    label: 'Link preview',
    description: 'Open Graph / Twitter card image',
    category: 'web',
    size: { width: 1200, height: 630 },
    unit: 'px',
    dpi: SCREEN_DPI,
    background: '#0f1115',
  },
  {
    id: presetId('web.banner'),
    label: 'Wide banner',
    description: 'Site header or channel art',
    category: 'web',
    size: { width: 1500, height: 500 },
    unit: 'px',
    dpi: SCREEN_DPI,
    background: '#0f1115',
  },
  {
    id: presetId('video.thumbnail'),
    label: 'Video thumbnail',
    description: '16:9 video still or cover',
    category: 'video',
    size: { width: 1280, height: 720 },
    unit: 'px',
    dpi: SCREEN_DPI,
    background: '#0f1115',
  },
  {
    id: presetId('video.fullhd'),
    label: 'Full HD frame',
    description: '1920 × 1080 production frame',
    category: 'video',
    size: { width: 1920, height: 1080 },
    unit: 'px',
    dpi: SCREEN_DPI,
    background: '#0f1115',
  },
  {
    id: presetId('presentation.wide'),
    label: 'Widescreen slide',
    description: '16:9 presentation slide',
    category: 'presentation',
    size: { width: 1920, height: 1080 },
    unit: 'px',
    dpi: SCREEN_DPI,
    background: '#0f1115',
  },
  {
    id: presetId('presentation.hd'),
    label: 'Standard slide',
    description: '4:3 presentation slide',
    category: 'presentation',
    size: { width: 1600, height: 1200 },
    unit: 'px',
    dpi: SCREEN_DPI,
    background: '#0f1115',
  },
  {
    id: presetId('print.a4'),
    label: 'A4 print',
    description: '210 × 297 mm at 300 dpi',
    category: 'print',
    size: sizeInPixels(210, 297, 'mm', PRINT_DPI),
    unit: 'mm',
    dpi: PRINT_DPI,
    background: '#ffffff',
  },
  {
    id: presetId('print.a3'),
    label: 'A3 poster',
    description: '297 × 420 mm at 300 dpi',
    category: 'print',
    size: sizeInPixels(297, 420, 'mm', PRINT_DPI),
    unit: 'mm',
    dpi: PRINT_DPI,
    background: '#ffffff',
  },
  {
    id: presetId('print.letter'),
    label: 'US Letter',
    description: '8.5 × 11 in at 300 dpi',
    category: 'print',
    size: sizeInPixels(8.5, 11, 'in', PRINT_DPI),
    unit: 'in',
    dpi: PRINT_DPI,
    background: '#ffffff',
  },
  {
    id: presetId('print.business-card'),
    label: 'Business card',
    description: '85 × 55 mm at 300 dpi',
    category: 'print',
    size: sizeInPixels(85, 55, 'mm', PRINT_DPI),
    unit: 'mm',
    dpi: PRINT_DPI,
    background: '#ffffff',
  },
] as const;

/** Converts a physical preset size into rounded pixels. */
export function sizeInPixels(
  width: number,
  height: number,
  unit: 'px' | 'mm' | 'in',
  dpi: number,
): { width: number; height: number } {
  return {
    width: Math.round(toPixels(width, unit, dpi)),
    height: Math.round(toPixels(height, unit, dpi)),
  };
}

/** Physical dimensions of a pixel canvas, rounded for the preset labels. */
export function physicalSize(px: number, unit: 'mm' | 'in', dpi: number): number {
  return Math.round(fromPixels(px, unit, dpi) * 10) / 10;
}

export function getCanvasPreset(id: string): CanvasPreset | undefined {
  return CANVAS_PRESETS.find((preset) => (preset.id as string) === id);
}

export function listCanvasPresets(category?: CanvasPresetCategory): readonly CanvasPreset[] {
  if (!category) return CANVAS_PRESETS;
  return CANVAS_PRESETS.filter((preset) => preset.category === category);
}
