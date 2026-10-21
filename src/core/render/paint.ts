/**
 * The scene painter.
 *
 * One function, `paintPlan`, draws a render plan into anything that behaves like a 2D canvas
 * context. The live artboard calls it after applying a zoom transform; the export pipeline calls it
 * after applying an output-scale transform. Every difference between preview and export is therefore
 * a transform, never a different drawing routine.
 *
 * The context is declared structurally — a browser `CanvasRenderingContext2D`, the offscreen export
 * context and a recording fake in tests all satisfy it.
 */

import type { Rect } from '../documents/geometry';
import { alignmentOffset, lineBaseline, paintTextLine } from './text-layout';
import type { DrawOp, EllipseOp, ImageOp, RectOp, RenderPlan, TextOp } from './plan';

export type PainterContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  globalCompositeOperation: string;
  lineWidth: number;
  lineJoin: string;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  /** Applies the output scale. Export multiplies by it; the artboard passes zoom instead. */
  scale(x: number, y: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  roundRect(x: number, y: number, width: number, height: number, radii: number): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void;
  /**
   * Images are typed as `unknown` here on purpose: the browser's `CanvasImageSource` union,
   * a decoded image from a test rasteriser and an SVG image element all have to pass through the
   * same call. The plan has already decided *which* image, so the painter only forwards it.
   */
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
};

/**
 * An isolated drawing surface.
 *
 * Some operations need an alpha mask of their own. Tinting a graphic means colouring only the
 * pixels the graphic actually covers, and a shared canvas cannot express that: the document
 * background is already painted underneath the graphic, so a wash applied there covers the
 * background as well. The graphic is therefore drawn on its own surface first, tinted there, and
 * composited back.
 */
export type PaintSurface = {
  /** The surface's own 2D context. */
  readonly context: PainterContext;
  readonly width: number;
  readonly height: number;
  /**
   * Draws the finished surface onto another context.
   *
   * The painter only knows the surface through this function, so no adapter has to expose a DOM
   * object to the core.
   */
  readonly draw: (
    target: PainterContext,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
};

export type PaintPlanOptions = {
  /**
   * Clears the target before painting. Offscreen export clears; the artboard keeps the surrounding
   * workspace visible and only clears the artboard rectangle.
   */
  readonly clear?: boolean;
  /** Limit painting to the canvas footprint; the export canvas is exactly that size. */
  readonly clearRect?: Rect;
  /**
   * Creates an isolated surface for the operations that need one.
   *
   * When it is absent, or returns `null`, a graphic that would have been tinted is drawn
   * untinted: losing the tint is a smaller fault than replacing the artwork with a rectangle of
   * colour.
   */
  readonly createSurface?: (width: number, height: number) => PaintSurface | null;
};

/**
 * Paints a plan in order: op 0 first (bottom of the stack), the last op on top.
 *
 * @returns notes about anything that could not be drawn exactly as planned.
 */
export function paintPlan(
  context: PainterContext,
  plan: RenderPlan,
  options: PaintPlanOptions = {},
): readonly string[] {
  const clearRect = options.clearRect ?? {
    x: 0,
    y: 0,
    width: plan.size.width,
    height: plan.size.height,
  };
  if (options.clear !== false) {
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.clearRect(clearRect.x, clearRect.y, clearRect.width, clearRect.height);
    context.restore();
  }

  const warnings: string[] = [];
  for (const op of plan.ops) {
    for (const warning of paintOp(context, op, options)) warnings.push(warning);
  }
  return warnings;
}

export function paintOp(
  context: PainterContext,
  op: DrawOp,
  options: PaintPlanOptions = {},
): readonly string[] {
  switch (op.kind) {
    case 'background':
      context.save();
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = op.color;
      context.fillRect(op.frame.x, op.frame.y, op.frame.width, op.frame.height);
      context.restore();
      return [];
    case 'rect':
      paintShape(context, op, () => {
        const frame = op.frame;
        if (op.shape.cornerRadius > 0) {
          const radius = Math.min(op.shape.cornerRadius, Math.min(frame.width, frame.height) / 2);
          context.roundRect(frame.x, frame.y, frame.width, frame.height, radius);
        } else {
          context.moveTo(frame.x, frame.y);
          context.lineTo(frame.x + frame.width, frame.y);
          context.lineTo(frame.x + frame.width, frame.y + frame.height);
          context.lineTo(frame.x, frame.y + frame.height);
          context.closePath();
        }
      });
      return [];
    case 'ellipse':
      paintShape(context, op, () => {
        const frame = op.frame;
        context.ellipse(
          frame.x + frame.width / 2,
          frame.y + frame.height / 2,
          frame.width / 2,
          frame.height / 2,
          0,
          0,
          Math.PI * 2,
        );
      });
      return [];
    case 'image':
      return paintImage(context, op, options);
    case 'text':
      paintText(context, op);
      return [];
  }
}

function paintShape(context: PainterContext, op: RectOp | EllipseOp, path: () => void): void {
  const { fill, stroke, strokeWidth } = op.shape;
  if (fill === null && stroke === null) return;

  context.save();
  context.globalAlpha = op.opacity;
  context.globalCompositeOperation = 'source-over';
  context.lineJoin = 'miter';

  if (fill !== null) {
    context.beginPath();
    path();
    context.fillStyle = fill;
    context.fill();
  }

  if (stroke !== null && strokeWidth > 0) {
    context.beginPath();
    path();
    context.strokeStyle = stroke;
    context.lineWidth = strokeWidth;
    context.stroke();
  }

  context.restore();
}

/**
 * Draws an image layer.
 *
 * `contain` fits the graphic inside the frame and leaves the remaining space empty; `cover` fills
 * the frame and crops the overflow; `stretch` deliberately distorts. The placement maths is pure
 * arithmetic on the op, so a recording context in a test and a real rasteriser in the browser
 * receive identical coordinates.
 *
 * A tint is applied on an isolated surface, never on the shared canvas: `source-atop` only means
 * "colour the graphic's own pixels" while the graphic is the only thing on the surface. Applied on
 * the shared canvas the document background would be underneath the graphic, the wash would cover
 * it, and the artwork would be replaced by a rectangle of colour.
 */
function paintImage(
  context: PainterContext,
  op: ImageOp,
  options: PaintPlanOptions,
): readonly string[] {
  const placement = imagePlacement(op);
  context.save();
  context.globalAlpha = op.opacity;
  context.globalCompositeOperation = 'source-over';
  context.imageSmoothingEnabled = true;

  if (op.tint) {
    const tinted = paintTintedImage(context, op, placement, options);
    if (!tinted) {
      // No isolated surface is available, so the graphic is drawn as it is. Losing the tint is a
      // smaller fault than losing the artwork.
      drawImageOp(context, op, placement);
      context.restore();
      return [
        `“${op.layerName}” was not tinted: this environment cannot isolate a graphic to tint it.`,
      ];
    }
    context.restore();
    return [];
  }

  drawImageOp(context, op, placement);
  context.restore();
  return [];
}

function drawImageOp(context: PainterContext, op: ImageOp, placement: ImagePlacement): void {
  context.drawImage(
    op.image,
    placement.source.x,
    placement.source.y,
    placement.source.width,
    placement.source.height,
    placement.destination.x,
    placement.destination.y,
    placement.destination.width,
    placement.destination.height,
  );
}

/**
 * Draws the graphic on its own surface, washes it with the tint and composites it back.
 *
 * @returns false when no surface could be created, in which case nothing was drawn.
 */
function paintTintedImage(
  context: PainterContext,
  op: ImageOp,
  placement: ImagePlacement,
  options: PaintPlanOptions,
): boolean {
  const create = options.createSurface;
  if (!create) return false;

  const width = Math.max(1, Math.round(placement.source.width));
  const height = Math.max(1, Math.round(placement.source.height));
  const surface = create(width, height);
  if (!surface) return false;

  const surfaceContext = surface.context;
  surfaceContext.save();
  surfaceContext.globalAlpha = 1;
  surfaceContext.globalCompositeOperation = 'source-over';
  surfaceContext.drawImage(
    op.image,
    placement.source.x,
    placement.source.y,
    placement.source.width,
    placement.source.height,
    0,
    0,
    width,
    height,
  );
  // The surface holds the graphic and nothing else, so `source-atop` now means exactly what the
  // tint is supposed to mean: the colour lands on the graphic's own opaque pixels, and the
  // transparent parts of the graphic stay transparent.
  surfaceContext.globalCompositeOperation = 'source-atop';
  surfaceContext.fillStyle = op.tint ?? '#000000';
  surfaceContext.fillRect(0, 0, width, height);
  surfaceContext.restore();

  context.globalCompositeOperation = 'source-over';
  surface.draw(
    context,
    placement.destination.x,
    placement.destination.y,
    placement.destination.width,
    placement.destination.height,
  );
  return true;
}

export type ImagePlacement = {
  /** Region of the graphic to read. */
  readonly source: Rect;
  /** Region of the canvas to write. */
  readonly destination: Rect;
};

/** Scale factor between the graphic and its frame for the layer's fit mode. */
export function imageFitScale(
  fit: ImageOp['fit'],
  intrinsic: { readonly width: number; readonly height: number },
  frame: Rect,
): number {
  if (intrinsic.width <= 0 || intrinsic.height <= 0) return 1;
  const horizontal = frame.width / intrinsic.width;
  const vertical = frame.height / intrinsic.height;
  switch (fit) {
    case 'stretch':
      return 1;
    case 'cover':
      return Math.max(horizontal, vertical);
    case 'contain':
      return Math.min(horizontal, vertical);
  }
}

/**
 * Source and destination rectangles for an image layer.
 *
 * The source rectangle is always paired with the destination it maps onto, so a caller cannot apply
 * one without the other and silently stretch a graphic.
 */
export function imagePlacement(op: ImageOp): ImagePlacement {
  const intrinsic = { width: op.image.width, height: op.image.height };
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    return {
      source: { x: 0, y: 0, width: 0, height: 0 },
      destination: op.frame,
    };
  }

  if (op.fit === 'stretch') {
    return {
      source: { x: 0, y: 0, width: intrinsic.width, height: intrinsic.height },
      destination: op.frame,
    };
  }

  const scale = imageFitScale(op.fit, intrinsic, op.frame);

  if (op.fit === 'cover') {
    const visibleWidth = Math.min(intrinsic.width, op.frame.width / scale);
    const visibleHeight = Math.min(intrinsic.height, op.frame.height / scale);
    return {
      source: {
        x: (intrinsic.width - visibleWidth) / 2,
        y: (intrinsic.height - visibleHeight) / 2,
        width: visibleWidth,
        height: visibleHeight,
      },
      destination: op.frame,
    };
  }

  const width = intrinsic.width * scale;
  const height = intrinsic.height * scale;
  return {
    source: { x: 0, y: 0, width: intrinsic.width, height: intrinsic.height },
    destination: {
      x: op.frame.x + (op.frame.width - width) / 2,
      y: op.frame.y + (op.frame.height - height) / 2,
      width,
      height,
    },
  };
}

function paintText(context: PainterContext, op: TextOp): void {
  context.save();
  context.globalAlpha = op.opacity;
  context.globalCompositeOperation = 'source-over';
  if (op.overflows) {
    // A text layer taller than its box is drawn clipped to the box. The export report tells the user
    // that the extra lines are clipped, and the artboard paints through this same routine, so the
    // warning, the preview and the exported file all say the same thing. Text that fits is left
    // uncut, so a glyph overhanging its measured advance is not shaved off.
    context.beginPath();
    context.rect(op.frame.x, op.frame.y, op.frame.width, op.frame.height);
    context.clip();
  }
  op.lines.forEach((line, index) => {
    paintTextLine(context, {
      line,
      settings: op.settings,
      frameWidth: op.frame.width,
      origin: {
        x: op.frame.x,
        y: op.frame.y + lineBaseline(index, op.lineHeightPx),
      },
    });
  });
  context.restore();
}

/** Horizontal position of a text line, exposed for the artboard's selection overlay. */
export function textLineOrigin(op: TextOp, index: number): { x: number; y: number } {
  const line = op.lines[index];
  const width = line?.width ?? 0;
  return {
    x: op.frame.x + alignmentOffset(op.settings.align, op.frame.width, width),
    y: op.frame.y + lineBaseline(index, op.lineHeightPx),
  };
}
