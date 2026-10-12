/**
 * The render plan: a flat, ordered list of drawing operations derived from a document.
 *
 * The plan is the single description of what a document looks like. The live artboard and the
 * offscreen export canvas both build a plan and both hand it to `paintPlan`, which is what makes
 * "what you see is what you export" a structural property rather than a promise (ADR-0016).
 *
 * Building a plan is pure: it takes the document, a font measurer and a way to resolve image
 * sources, and returns data. Nothing here touches the DOM.
 */

import type { Rect } from '../documents/geometry';
import type {
  ImageFit,
  ImageLayer,
  Layer,
  Scene,
  ShapeSettings,
  TextSettings,
} from '../documents/layer-types';
import type { Canvas, ForgeDocument } from '../documents/types';
import { fontString, layoutText, type TextLine, type TextMeasurer } from './text-layout';

/** Anything the painter can draw into a frame. Both `HTMLImageElement` and a decoded image satisfy it. */
export type RenderImage = {
  readonly width: number;
  readonly height: number;
};

/** Resolves a layer's `href` to a decoded image, or a reason why it cannot be drawn. */
export type ImageResolver = (
  href: string,
) => { readonly image: RenderImage } | { readonly error: string } | undefined;

/** Produces a measurer for a CSS font string. Canvas contexts are stateful, so this is a factory. */
export type MeasureFactory = (font: string) => TextMeasurer;

export type RenderIssueKind = 'image-unavailable' | 'text-overflow' | 'empty-layer';

export type RenderIssue = {
  readonly kind: RenderIssueKind;
  readonly layerId: string | null;
  readonly layerName: string;
  readonly message: string;
  /** True when the issue means the export cannot honestly be called complete. */
  readonly blocking: boolean;
};

export type BackgroundOp = {
  readonly kind: 'background';
  readonly color: string;
  /** Canvas-sized rectangle; the painter needs real geometry because `fillRect` is not unbounded. */
  readonly frame: Rect;
};

export type RectOp = {
  readonly kind: 'rect';
  readonly layerId: string;
  readonly layerName: string;
  readonly frame: Rect;
  readonly shape: ShapeSettings;
  readonly opacity: number;
};

export type EllipseOp = {
  readonly kind: 'ellipse';
  readonly layerId: string;
  readonly layerName: string;
  readonly frame: Rect;
  readonly shape: ShapeSettings;
  readonly opacity: number;
};

export type ImageOp = {
  readonly kind: 'image';
  readonly layerId: string;
  readonly layerName: string;
  readonly frame: Rect;
  readonly href: string;
  readonly image: RenderImage;
  readonly fit: ImageFit;
  readonly opacity: number;
  readonly tint: string | null;
};

export type TextOp = {
  readonly kind: 'text';
  readonly layerId: string;
  readonly layerName: string;
  readonly frame: Rect;
  readonly settings: TextSettings;
  readonly lines: readonly TextLine[];
  readonly lineHeightPx: number;
  readonly overflows: boolean;
  readonly opacity: number;
};

export type DrawOp = BackgroundOp | RectOp | EllipseOp | ImageOp | TextOp;

export type RenderPlan = {
  /** Full document size in document pixels, before any output scale. */
  readonly size: { readonly width: number; readonly height: number };
  /** `null` means "leave the canvas transparent" — a real state, not a missing value. */
  readonly background: string | null;
  /** Background is only painted when the document declares one. */
  readonly ops: readonly DrawOp[];
  readonly issues: readonly RenderIssue[];
  /** True when at least one issue means the composition is incomplete. */
  readonly blocked: boolean;
};

export type BuildPlanOptions = {
  readonly measureFont: MeasureFactory;
  readonly resolveImage?: ImageResolver;
  /** Paint the canvas background. Offscreen export passes `false` for transparent PNGs. */
  readonly includeBackground?: boolean;
  /**
   * Force a specific background, ignoring the document.
   *
   * Used by JPEG export, which cannot store alpha and must therefore flatten onto a colour the
   * caller chose explicitly instead of whatever the encoder decides alpha means.
   */
  readonly backgroundOverride?: string | null | undefined;
};

function backgroundFor(
  canvas: Canvas,
  include: boolean,
  override: string | null | undefined,
): string | null {
  if (override !== undefined) return override;
  if (!include) return null;
  if (canvas.transparent) return null;
  return canvas.background;
}

/**
 * Turns a document into an ordered plan.
 *
 * Layer order is preserved exactly as stored, so the plan's op order *is* the z-order: index 0 is
 * painted first, the last op paints on top. Hidden layers and fully transparent layers are skipped
 * here rather than at paint time, so both renderers agree on what exists.
 */
export function buildRenderPlan(document: ForgeDocument, options: BuildPlanOptions): RenderPlan {
  const issues: RenderIssue[] = [];
  const ops: DrawOp[] = [];
  const includeBackground = options.includeBackground ?? true;
  const background = backgroundFor(document.canvas, includeBackground, options.backgroundOverride);
  if (background) {
    ops.push({
      kind: 'background',
      color: background,
      frame: { x: 0, y: 0, width: document.canvas.width, height: document.canvas.height },
    });
  }

  for (const layer of document.scene.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const op = opFor(layer, options, issues);
    if (op) ops.push(op);
  }

  return {
    size: { width: document.canvas.width, height: document.canvas.height },
    background,
    ops,
    issues,
    blocked: issues.some((issue) => issue.blocking),
  };
}

function opFor(layer: Layer, options: BuildPlanOptions, issues: RenderIssue[]): DrawOp | null {
  switch (layer.type) {
    case 'rect':
    case 'ellipse': {
      const op = {
        kind: layer.type,
        layerId: layer.id,
        layerName: layer.name,
        frame: layer.frame,
        shape: layer.shape,
        opacity: layer.opacity,
      } as RectOp | EllipseOp;
      if (op.shape.fill === null && op.shape.stroke === null) {
        issues.push({
          kind: 'empty-layer',
          layerId: layer.id,
          layerName: layer.name,
          message: `"${layer.name}" has neither a fill nor a stroke, so it draws nothing.`,
          blocking: false,
        });
      }
      return op;
    }
    case 'text': {
      const measure = options.measureFont(fontString(layer.text));
      const layout = layoutText(layer.text.content, layer.text, layer.frame, measure);
      if (layout.overflows) {
        issues.push({
          kind: 'text-overflow',
          layerId: layer.id,
          layerName: layer.name,
          message: `"${layer.name}" is taller than its box and will be clipped on export.`,
          blocking: false,
        });
      }
      return {
        kind: 'text',
        layerId: layer.id,
        layerName: layer.name,
        frame: layer.frame,
        settings: layer.text,
        lines: layout.lines,
        lineHeightPx: layout.lineHeightPx,
        overflows: layout.overflows,
        opacity: layer.opacity,
      };
    }
    case 'image': {
      const resolution = options.resolveImage?.(layer.image.href);
      if (!resolution || 'error' in resolution) {
        const reason =
          resolution && 'error' in resolution
            ? resolution.error
            : 'the graphic was not loaded before drawing';
        issues.push({
          kind: 'image-unavailable',
          layerId: layer.id,
          layerName: layer.name,
          message: `Graphic "${layer.name}" could not be drawn: ${reason}.`,
          blocking: true,
        });
        return null;
      }
      return {
        kind: 'image',
        layerId: layer.id,
        layerName: layer.name,
        frame: layer.frame,
        href: layer.image.href,
        image: resolution.image,
        fit: layer.image.fit,
        opacity: layer.opacity,
        tint: layer.image.tint,
      };
    }
  }
}

/** Layers that contribute visible output, bottom-most first. Used by the inspector and checks. */
export function paintableLayers(scene: Scene): readonly Layer[] {
  return scene.layers.filter((layer) => layer.visible && layer.opacity > 0);
}

/** Convenience predicate for callers that need to know whether a layer type needs an image. */
export function needsImage(layer: Layer): layer is ImageLayer {
  return layer.type === 'image';
}

export function isShapeOp(op: DrawOp): op is RectOp | EllipseOp {
  return op.kind === 'rect' || op.kind === 'ellipse';
}

export function isRectOp(op: DrawOp): op is RectOp {
  return op.kind === 'rect';
}
