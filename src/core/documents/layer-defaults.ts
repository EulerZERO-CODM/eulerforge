/**
 * Defaults for newly created layers.
 *
 * Kept apart from the operations so both the factory (creating a layer from a toolbar click) and the
 * migration (filling in fields a version-1 document never had) read from one source. A migration that
 * invented its own defaults would drift from what a user gets when they press the same button.
 */

import { DEFAULT_VECTOR_STYLE, type VectorStyle } from '../vector';
import type {
  FontStackId,
  ImageSettings,
  LayerType,
  ShapeSettings,
  TextSettings,
} from './layer-types';

export const DEFAULT_LAYER_OPACITY = 1;
export const DEFAULT_TEXT_COLOR = '#f4f5f7';
export const DEFAULT_SHAPE_FILL = '#e2833a';
export const DEFAULT_SHAPE_STROKE = '#0f1115';
export const DEFAULT_TEXT_FONT_SIZE = 64;
export const DEFAULT_TEXT_FONT_WEIGHT = 600;
export const DEFAULT_TEXT_LINE_HEIGHT = 1.2;
export const DEFAULT_TEXT_LETTER_SPACING = 0;
export const DEFAULT_TEXT_ALIGNMENT = 'left';
export const DEFAULT_FONT_STACK: FontStackId = 'sans';
export const DEFAULT_STROKE_WIDTH = 0;
export const DEFAULT_CORNER_RADIUS = 0;
export const DEFAULT_PLACEHOLDER_TEXT = 'Double-click to edit this text';

export type LayerDefaults = {
  readonly name: string;
  readonly text: TextSettings;
  readonly shape: ShapeSettings;
  readonly image: Omit<ImageSettings, 'href'>;
  readonly vectorStyle: VectorStyle;
};

/** Neutral wording for a text layer created from the toolbar. */
export function defaultTextSettings(overrides: Partial<TextSettings> = {}): TextSettings {
  return {
    content: DEFAULT_PLACEHOLDER_TEXT,
    fontStackId: DEFAULT_FONT_STACK,
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    fontWeight: DEFAULT_TEXT_FONT_WEIGHT,
    lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
    letterSpacing: DEFAULT_TEXT_LETTER_SPACING,
    align: DEFAULT_TEXT_ALIGNMENT,
    color: DEFAULT_TEXT_COLOR,
    ...overrides,
  };
}

export function defaultShapeSettings(overrides: Partial<ShapeSettings> = {}): ShapeSettings {
  return {
    fill: DEFAULT_SHAPE_FILL,
    stroke: null,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    cornerRadius: DEFAULT_CORNER_RADIUS,
    ...overrides,
  };
}

export function defaultImageSettings(
  href: string,
  overrides: Partial<ImageSettings> = {},
): ImageSettings {
  return {
    assetId: null,
    href,
    intrinsicWidth: 0,
    intrinsicHeight: 0,
    fit: 'contain',
    tint: null,
    ...overrides,
  };
}

export function defaultNameFor(type: LayerType): string {
  switch (type) {
    case 'text':
      return 'Text';
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'image':
      return 'Graphic';
    case 'path':
      return 'Path';
  }
}

export function layerDefaultsFor(type: LayerType): LayerDefaults {
  return {
    name: defaultNameFor(type),
    vectorStyle: DEFAULT_VECTOR_STYLE,
    text: defaultTextSettings(),
    shape: defaultShapeSettings(),
    image: {
      assetId: null,
      intrinsicWidth: 0,
      intrinsicHeight: 0,
      fit: 'contain',
      tint: null,
    },
  };
}
