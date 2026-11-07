'use client';

import { useEffect, useRef } from 'react';

import type { ImageResolver } from '../../core/render/plan';
import { buildRenderPlan } from '../../core/render/plan';
import { contextMeasureFactory } from '../../core/render/measure';
import { paintPlan, type PainterContext } from '../../core/render/paint';
import { evaluateDocumentAt } from '../../core/motion/evaluate';
import type { ForgeDocument } from '../../core/documents/types';
import { cn } from '../../lib/cn';

/**
 * The composition preview.
 *
 * The canvas backing store is exactly the document size, and the element is scaled by CSS, so the
 * frame the preview paints is the frame export encodes — no device-pixel factor, no zoom transform
 * and no second renderer. The same `buildRenderPlan` + `paintPlan` pair the Design Studio uses draws
 * both, which is why an exported PNG can be compared with this canvas pixel for pixel.
 */
export function MotionStage({
  doc,
  time,
  className,
  canvasRef,
  onCanvas,
  resolveImage,
  imageRevision,
}: {
  readonly doc: ForgeDocument;
  readonly time: number;
  readonly className?: string;
  readonly canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  /** Handed the live canvas so the export panel can compare against what is on screen. */
  readonly onCanvas?: (canvas: HTMLCanvasElement | null) => void;
  /**
   * Resolves the artwork inside `image` layers.
   *
   * Without one, a placed graphic is an unresolved layer and the render plan reports it as a
   * blocking issue — so a composition carried over from Design Studio would lose its photograph.
   */
  readonly resolveImage?: ImageResolver;
  /** Bumped when a source settles; a dependency of the paint effect, not of the plan. */
  readonly imageRevision?: number;
}) {
  const localRef = useRef<HTMLCanvasElement>(null);
  const targetRef = canvasRef ?? localRef;

  useEffect(() => {
    const canvas = targetRef.current;
    if (!canvas) return;
    // Re-evaluate on every time change; the evaluator is pure and cheap next to painting.
    const frame = evaluateDocumentAt(doc, time);
    canvas.width = doc.canvas.width;
    canvas.height = doc.canvas.height;
    const context = canvas.getContext('2d') as unknown as PainterContext | null;
    if (!context) return;
    const plan = buildRenderPlan(frame, {
      measureFont: contextMeasureFactory(context),
      ...(resolveImage === undefined ? {} : { resolveImage }),
      includeBackground: true,
    });
    context.save();
    paintPlan(context, plan, { clear: true });
    context.restore();
    onCanvas?.(canvas);
  }, [doc, time, targetRef, onCanvas, resolveImage, imageRevision]);

  return (
    <div
      className={cn('border-line bg-ink-950 relative overflow-hidden rounded-md border', className)}
    >
      <canvas
        ref={targetRef}
        data-testid="motion-preview"
        aria-label={`Composition preview at ${time.toFixed(2)} seconds`}
        className="block h-auto w-full"
      />
    </div>
  );
}
