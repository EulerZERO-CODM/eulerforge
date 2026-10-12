import { describe, expect, it } from 'vitest';

import {
  LENGTH_UNITS,
  MM_PER_INCH,
  PRINT_DPI,
  SCREEN_DPI,
  formatLength,
  fromPixels,
  isValidDpi,
  toPixels,
} from './units';

describe('toPixels', () => {
  it('leaves pixel values untouched', () => {
    expect(toPixels(1080, 'px', SCREEN_DPI)).toBe(1080);
  });

  it('converts millimetres and inches at the stated DPI', () => {
    expect(toPixels(MM_PER_INCH, 'mm', PRINT_DPI)).toBeCloseTo(PRINT_DPI, 6);
    expect(toPixels(2, 'in', PRINT_DPI)).toBe(600);
  });

  it('is reversible to within a rounding error', () => {
    for (const unit of LENGTH_UNITS) {
      const pixels = toPixels(37.5, unit, PRINT_DPI);
      expect(fromPixels(pixels, unit, PRINT_DPI)).toBeCloseTo(37.5, 6);
    }
  });
});

describe('isValidDpi', () => {
  it('accepts the documented range', () => {
    expect(isValidDpi(36)).toBe(true);
    expect(isValidDpi(1200)).toBe(true);
    expect(isValidDpi(SCREEN_DPI)).toBe(true);
  });

  it('rejects values outside the range and non-numbers', () => {
    expect(isValidDpi(35)).toBe(false);
    expect(isValidDpi(1201)).toBe(false);
    expect(isValidDpi(Number.NaN)).toBe(false);
  });
});

describe('formatLength', () => {
  it('rounds pixels to whole numbers', () => {
    expect(formatLength(1080.4, 'px', SCREEN_DPI)).toBe('1080 px');
  });

  it('shows one decimal place for physical units', () => {
    expect(formatLength(toPixels(210, 'mm', PRINT_DPI), 'mm', PRINT_DPI)).toBe('210 mm');
    expect(formatLength(96, 'in', SCREEN_DPI)).toBe('1 in');
  });
});
