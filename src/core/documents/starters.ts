/**
 * Layout starters.
 *
 * A starter is a documented *starting arrangement*, not a rendered template: Phase 1 cannot place
 * text or shapes on a canvas yet, so promising a finished layout would be a lie. What a starter can
 * honestly do is choose the canvas, name the project, and set the guides that describe where the
 * layout's regions belong — which is exactly what the workspace then shows on the stage.
 *
 * Each starter therefore records the regions its guides describe, so the interface can explain the
 * intent instead of implying that artwork already exists.
 */

import { DEFAULT_GUIDES } from './factories';
import { getCanvasPreset } from './presets';
import type { CanvasPresetId, GuideSettings } from './types';
import { brand, type Branded } from '../types/brand';

export type LayoutStarterId = Branded<string, 'LayoutStarterId'>;

const starterId = (value: string): LayoutStarterId => brand<'LayoutStarterId'>(value);

export type LayoutStarterRegion = {
  readonly label: string;
  /** How the guides describe this region, in plain language. */
  readonly guidance: string;
};

export type LayoutStarter = {
  readonly id: LayoutStarterId;
  readonly label: string;
  readonly description: string;
  /** Preselected canvas for this arrangement. Must name a real preset. */
  readonly presetId: CanvasPresetId;
  /** Suggested project name, so the flow starts populated rather than empty. */
  readonly titleSuggestion: string;
  /** Guide settings applied to the new document. */
  readonly guides: GuideSettings;
  /** What the guides mean. Rendered where the starter is offered and in the review step. */
  readonly regions: readonly LayoutStarterRegion[];
};

export const LAYOUT_STARTERS: readonly LayoutStarter[] = [
  {
    id: starterId('subject-title'),
    label: 'Subject with title block',
    description:
      'A large subject area in the upper two thirds, with a title band underneath and a badge corner.',
    presetId: getCanvasPreset('video.thumbnail')?.id ?? brand<'CanvasPresetId'>('video.thumbnail'),
    titleSuggestion: 'Thumbnail — subject and title',
    guides: { ...DEFAULT_GUIDES, safeMarginMm: 10, gridMm: 20, showGrid: false },
    regions: [
      {
        label: 'Subject area',
        guidance:
          'Everything inside the safe margin is guaranteed visible; keep the subject there.',
      },
      {
        label: 'Title band',
        guidance: 'The centre lines mark the lower third where the title text will sit.',
      },
      {
        label: 'Badge corner',
        guidance: 'The grid measures a square badge in the bottom-right corner.',
      },
    ],
  },
  {
    id: starterId('centred-hero'),
    label: 'Centred hero',
    description:
      'One focal element in the middle of a square canvas, with generous safe margins for social crops.',
    presetId: getCanvasPreset('social.square')?.id ?? brand<'CanvasPresetId'>('social.square'),
    titleSuggestion: 'Square post — centred hero',
    guides: { ...DEFAULT_GUIDES, safeMarginMm: 12, gridMm: 27, showGrid: true },
    regions: [
      {
        label: 'Hero',
        guidance:
          'The centre lines cross at the middle of the square; place the focal element there.',
      },
      {
        label: 'Safe area',
        guidance:
          'A 12 mm margin stays inside the frame when the post is cropped by a host application.',
      },
      {
        label: 'Grid',
        guidance: 'A 27 mm grid divides the square into a nine-part composition aid.',
      },
    ],
  },
  {
    id: starterId('print-margin'),
    label: 'Print page with bleed',
    description: 'A4 portrait with a 3 mm bleed band and print-safe margins already measured.',
    presetId: getCanvasPreset('print.a4')?.id ?? brand<'CanvasPresetId'>('print.a4'),
    titleSuggestion: 'A4 page with bleed',
    guides: { ...DEFAULT_GUIDES, safeMarginMm: 12, bleedMm: 3, showGrid: false },
    regions: [
      {
        label: 'Bleed',
        guidance: 'Background artwork extends 3 mm past the trim line so cutting leaves no gaps.',
      },
      {
        label: 'Safe margin',
        guidance: 'Keep text at least 12 mm from the trim; that is the border the stage draws.',
      },
      {
        label: 'Centre lines',
        guidance: 'The page centre is marked for symmetrical layouts.',
      },
    ],
  },
];

/** Resolves a `?starter=` value, tolerating unknown or missing ids. */
export function getLayoutStarter(id: string | null | undefined): LayoutStarter | undefined {
  if (!id) return undefined;
  return LAYOUT_STARTERS.find((starter) => starter.id === id);
}
