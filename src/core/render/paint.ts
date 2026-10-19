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
import {
  boundsOfPath,
  resolveGradient,
  resolvePattern,
  segmentsOf,
  stylePaintsSomething,
  type PaintSpec,
  type VectorBox,
} from '../vector';
import type { DrawOp, EllipseOp, ImageOp, PathOp, RectOp, RenderPlan, TextOp } from './plan';
import { pathTextFontString, pathTextHasContent, type PathText } from '../documents/layer-types';
import { layoutPathText } from '../vector/path-text';

/** A gradient handle: the two calls the painter makes on what `create*Gradient` returns. */
export type CanvasGradientLike = {
  addColorStop(offset: number, color: string): void;
};

export type PainterContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  globalCompositeOperation: string;
  lineWidth: number;
  lineJoin: string;
  lineCap: string;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  /** Applies the output scale. Export multiplies by it; the artboard passes zoom instead. */
  scale(x: number, y: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  closePath(): void;
  /** `rule` is the SVG fill rule name; the DOM's own `fill(fillRule?)` matches this. */
  fill(rule?: string): void;
  stroke(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    control1X: number,
    control1Y: number,
    control2X: number,
    control2Y: number,
    x: number,
    y: number,
  ): void;
  setLineDash(segments: readonly number[]): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradientLike;
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

export type PaintPlanOptions = {
  /**
   * Clears the target before painting. Offscreen export clears; the artboard keeps the surrounding
   * workspace visible and only clears the artboard rectangle.
   */
  readonly clear?: boolean;
  /** Limit painting to the canvas footprint; the export canvas is exactly that size. */
  readonly clearRect?: Rect;
};

/** Paints a plan in order: op 0 first (bottom of the stack), the last op on top. */
export function paintPlan(
  context: PainterContext,
  plan: RenderPlan,
  options: PaintPlanOptions = {},
): void {
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

  for (const op of plan.ops) paintOp(context, op);
}

export function paintOp(context: PainterContext, op: DrawOp): void {
  switch (op.kind) {
    case 'background':
      context.save();
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = op.color;
      context.fillRect(op.frame.x, op.frame.y, op.frame.width, op.frame.height);
      context.restore();
      return;
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
      return;
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
      return;
    case 'image':
      paintImage(context, op);
      return;
    case 'text':
      paintText(context, op);
      return;
    case 'path':
      paintPath(context, op);
      return;
  }
}

/**
 * Draws a vector path with a canvas context.
 *
 * Contours are walked segment by segment, so curves are drawn as curves rather than as a polygonal
 * approximation: the renderer a user sees and the SVG file they export describe the same shape.
 */
export function paintPath(context: PainterContext, op: PathOp): void {
  const { style } = op;
  // A path can be a pure guide for its own text: no fill, no stroke, and still something to draw.
  const hasText = op.text !== null && pathTextHasContent(op.text);
  if (!stylePaintsSomething(style) && !hasText) return;

  context.save();
  context.globalAlpha = op.opacity;
  context.globalCompositeOperation = 'source-over';

  // The same segment derivation the kernel uses, so a curve is painted exactly where the geometry
  // says it is and not according to a second, parallel reading of the node data.
  const trace = (): void => {
    for (const contour of op.path.contours) {
      const first = contour.nodes[0];
      if (!first) continue;
      context.moveTo(first.point.x, first.point.y);
      for (const segment of segmentsOf(contour)) {
        if (segment.kind === 'cubic' && segment.control1 && segment.control2) {
          context.bezierCurveTo(
            segment.control1.x,
            segment.control1.y,
            segment.control2.x,
            segment.control2.y,
            segment.to.x,
            segment.to.y,
          );
          continue;
        }
        context.lineTo(segment.to.x, segment.to.y);
      }
      if (contour.closed) context.closePath();
    }
  };

  /* Paint is resolved against the artwork's bounds, once, so a gradient and a pattern share the
     same frame of reference as the geometry they cover. */
  const box = boundsOfPath(op.path) ?? {
    minX: op.frame.x,
    minY: op.frame.y,
    maxX: op.frame.x + op.frame.width,
    maxY: op.frame.y + op.frame.height,
  };

  const fillPaint = style.fillPaint ?? null;
  const strokePaint = style.strokePaint ?? null;

  if ((fillPaint !== null || style.fill !== null) && style.fillOpacity > 0) {
    context.globalAlpha = op.opacity * style.fillOpacity;
    context.beginPath();
    trace();
    if (fillPaint !== null) paintWith(context, fillPaint, box, () => context.fill(style.fillRule));
    else {
      context.fillStyle = style.fill as string;
      context.fill(style.fillRule);
    }
  }

  if (
    (strokePaint !== null || style.stroke !== null) &&
    style.strokeWidth > 0 &&
    style.strokeOpacity > 0
  ) {
    context.globalAlpha = op.opacity * style.strokeOpacity;
    context.beginPath();
    trace();
    context.lineWidth = style.strokeWidth;
    context.lineJoin = style.lineJoin;
    context.lineCap = style.lineCap;
    context.setLineDash(style.dashArray);
    if (strokePaint !== null) paintWith(context, strokePaint, box, () => context.stroke());
    else {
      context.strokeStyle = style.stroke as string;
      context.stroke();
    }
    context.setLineDash([]);
  }

  context.restore();

  if (op.text && pathTextHasContent(op.text)) paintPathText(context, op.path, op.text, op.opacity);
}

/**
 * Paints text along the path's own contour.
 *
 * Each glyph is drawn at the midpoint of its advance, rotated to the tangent there, which is exactly
 * the layout `layoutPathText` computes for the SVG writer's own parameters. The measurer is the
 * context's own `measureText`, so the preview and the export agree by construction: the export calls
 * this same function with the same font, only at a different scale.
 */
function paintPathText(
  context: PainterContext,
  path: PathOp['path'],
  text: PathText,
  opacity: number,
): void {
  const font = pathTextFontString(text);
  context.save();
  context.font = font;
  const layout = layoutPathText(
    path,
    {
      content: text.content,
      fontSize: text.fontSize,
      letterSpacing: text.letterSpacing,
      startOffset: text.startOffset,
    },
    (glyph) => context.measureText(glyph).width,
  );
  if (layout.glyphs.length === 0) {
    context.restore();
    return;
  }

  // Positive y after the rotation points to the far side of the line, so "above" is zero and the
  // other two modes move the baseline past it by a fraction of the em.
  const shift =
    text.baseline === 'above'
      ? 0
      : text.baseline === 'centre'
        ? text.fontSize * 0.35
        : text.fontSize * 0.7;
  context.globalAlpha = opacity;
  context.fillStyle = text.colour;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  for (const glyph of layout.glyphs) {
    context.save();
    context.translate(glyph.x, glyph.y);
    context.rotate(glyph.angle);
    context.translate(0, shift);
    context.fillText(glyph.char, 0, 0);
    context.restore();
  }
  context.restore();
}

/**
 * Paints whatever the current path encloses, with a solid colour, a gradient or a pattern.
 *
 * The three cases differ only in how the ink gets there. A gradient is a real canvas gradient built
 * from the same resolved geometry the SVG writer emits; a pattern clips to the path and draws the
 * motif's primitives directly, which keeps the preview and the exported `<pattern>` the same picture
 * and avoids an intermediate bitmap that would have to be resampled.
 */
function paintWith(
  context: PainterContext,
  paint: PaintSpec,
  box: VectorBox,
  apply: () => void,
): void {
  if (paint.kind === 'solid') {
    context.fillStyle = paint.color;
    context.strokeStyle = paint.color;
    apply();
    return;
  }

  if (paint.kind === 'linear-gradient' || paint.kind === 'radial-gradient') {
    const resolved = resolveGradient(paint, box);
    const gradient =
      resolved.kind === 'linear'
        ? context.createLinearGradient(resolved.x1, resolved.y1, resolved.x2, resolved.y2)
        : context.createRadialGradient(
            resolved.cx,
            resolved.cy,
            0,
            resolved.cx,
            resolved.cy,
            resolved.radius,
          );
    for (const stop of resolved.stops) gradient.addColorStop(stop.offset, stop.color);
    context.fillStyle = gradient;
    context.strokeStyle = gradient;
    apply();
    return;
  }

  // A pattern: clip to the shape, then tile the motif's primitives across its bounds.
  const resolved = resolvePattern(paint, box);
  context.save();
  context.clip();
  if (resolved.background !== null) {
    context.fillStyle = resolved.background;
    context.fillRect(
      resolved.area.minX,
      resolved.area.minY,
      boxWidth(resolved.area),
      boxHeight(resolved.area),
    );
  }
  if (resolved.rotation !== 0) {
    context.translate(resolved.pivot.x, resolved.pivot.y);
    context.rotate((resolved.rotation * Math.PI) / 180);
    context.translate(-resolved.pivot.x, -resolved.pivot.y);
  }

  const width = boxWidth(resolved.area);
  const height = boxHeight(resolved.area);
  // Enough tiles to cover the bounds after rotation: the diagonal, not the width.
  const columns = Math.ceil(Math.hypot(width, height) / resolved.tile) + 2;
  const startX = resolved.grid.x;
  const startY = resolved.grid.y;
  for (let row = 0; row < columns; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const originX = startX + column * resolved.tile;
      const originY = startY + row * resolved.tile;
      for (const primitive of resolved.primitives) {
        context.fillStyle = primitive.color;
        if (primitive.kind === 'rect') {
          context.fillRect(
            originX + primitive.x,
            originY + primitive.y,
            primitive.width,
            primitive.height,
          );
        } else {
          context.beginPath();
          context.ellipse(
            originX + primitive.cx,
            originY + primitive.cy,
            primitive.radius,
            primitive.radius,
            0,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }
    }
  }
  context.restore();
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
 */
function paintImage(context: PainterContext, op: ImageOp): void {
  const placement = imagePlacement(op);
  context.save();
  context.globalAlpha = op.opacity;
  context.globalCompositeOperation = 'source-over';
  context.imageSmoothingEnabled = true;
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

  if (op.tint) {
    // `source-atop` restricts the wash to the graphic's opaque pixels, so a transparent graphic
    // keeps its transparency instead of gaining a coloured rectangle behind it.
    context.globalCompositeOperation = 'source-atop';
    context.fillStyle = op.tint;
    paintTint(context, placement, op);
  }

  context.restore();
}

function paintTint(context: PainterContext, placement: ImagePlacement, op: ImageOp): void {
  const sourceCoverage = coverage(op, placement);
  context.fillRect(sourceCoverage.x, sourceCoverage.y, sourceCoverage.width, sourceCoverage.height);
}

/** Where a tint lands: the part of the frame the graphic actually covers. */
function coverage(op: ImageOp, placement: ImagePlacement): Rect {
  if (op.fit === 'contain') return placement.destination;
  return op.frame;
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

function boxWidth(box: VectorBox): number {
  return box.maxX - box.minX;
}

function boxHeight(box: VectorBox): number {
  return box.maxY - box.minY;
}
