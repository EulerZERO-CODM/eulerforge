/**
 * Length units and conversion.
 *
 * Digital canvases are stored in CSS-independent device pixels; print canvases are authored in
 * millimetres or inches and converted at a stated DPI. Conversion is centralised here so that the
 * document model never carries mixed units.
 */

export const MM_PER_INCH = 25.4;
export const MIN_CANVAS_PX = 16;
export const MAX_CANVAS_PX = 20_000;
/** Digital/screen reference resolution. */
export const SCREEN_DPI = 96;
/** Print reference resolution used for new print documents. */
export const PRINT_DPI = 300;

export type LengthUnit = 'px' | 'mm' | 'in';

export const LENGTH_UNITS: readonly LengthUnit[] = ['px', 'mm', 'in'] as const;

export const LENGTH_UNIT_LABELS: Readonly<Record<LengthUnit, string>> = {
  px: 'Pixels',
  mm: 'Millimetres',
  in: 'Inches',
};

/** Converts a length expressed in `unit` into pixels at the given DPI. */
export function toPixels(value: number, unit: LengthUnit, dpi: number): number {
  switch (unit) {
    case 'px':
      return value;
    case 'mm':
      return (value / MM_PER_INCH) * dpi;
    case 'in':
      return value * dpi;
    default: {
      const exhaustive: never = unit;
      throw new Error(`Unsupported length unit: ${String(exhaustive)}`);
    }
  }
}

/** Converts a pixel length into `unit` at the given DPI. */
export function fromPixels(pixels: number, unit: LengthUnit, dpi: number): number {
  switch (unit) {
    case 'px':
      return pixels;
    case 'mm':
      return (pixels / dpi) * MM_PER_INCH;
    case 'in':
      return pixels / dpi;
    default: {
      const exhaustive: never = unit;
      throw new Error(`Unsupported length unit: ${String(exhaustive)}`);
    }
  }
}

export function isValidDpi(dpi: number): boolean {
  return Number.isFinite(dpi) && dpi >= 36 && dpi <= 1200;
}

/**
 * Formats a pixel measurement for display in the requested unit.
 * Pixels are shown as integers, physical units with at most one decimal place.
 */
export function formatLength(pixels: number, unit: LengthUnit, dpi: number): string {
  if (unit === 'px') {
    return `${Math.round(pixels)} px`;
  }
  const converted = fromPixels(pixels, unit, dpi);
  const rounded = Math.round(converted * 10) / 10;
  return `${rounded} ${unit}`;
}
