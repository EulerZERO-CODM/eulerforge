/**
 * Font measurement.
 *
 * Measuring happens through the *same context that will paint*: a plan built with one renderer's
 * metrics and painted by another is how text ends up wrapping differently in the preview and the
 * export. The factory sets the font once and returns a cheap per-string measurer.
 */

import type { TextPaintContext } from './text-layout';
import type { MeasureFactory } from './plan';

export function contextMeasureFactory(context: TextPaintContext): MeasureFactory {
  return (font: string) => {
    context.font = font;
    return (text: string) => context.measureText(text).width;
  };
}
