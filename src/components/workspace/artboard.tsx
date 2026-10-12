'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { ForgeDocument } from '../../core/documents/types';
import type { Layer, LayerId, Scene } from '../../core/documents/layer-types';
import { createRect, type Point, type Rect } from '../../core/documents/geometry';
import {
  buildSnapTargets,
  handleCursor,
  HANDLE_LABELS,
  hitTestScene,
  layersInRect,
  snapThresholdForZoom,
  toDocumentPoint,
  TRANSFORM_HANDLES,
  type TransformHandle,
} from '../../core/documents/scene-geometry';
import { toPixels } from '../../core/documents/units';
import { gridLinePositions, insetRect, bleedBand } from '../../core/documents/geometry';
import { buildRenderPlan } from '../../core/render/plan';
import { paintPlan, type PainterContext } from '../../core/render/paint';
import { contextMeasureFactory } from '../../core/render/measure';
import { cn } from '../../lib/cn';
import {
  beginMove,
  beginResize,
  gestureChangedSomething,
  gestureLabel,
  resolveGesture,
  updateGesture,
  NO_MODIFIERS,
  type GestureModifiers,
  type GestureState,
} from '../../core/editor/gesture';
import {
  EMPTY_SELECTION,
  isSelected,
  selectOnly,
  selectionFrame,
  toggleSelection,
  type Selection,
} from '../../core/editor/selection';
import type { useSceneImages } from './use-scene-images';

export type ArtboardProps = {
  readonly doc: ForgeDocument;
  readonly zoom: number;
  readonly selection: Selection;
  readonly onSelectionChange: (selection: Selection) => void;
  /** Called once, when a gesture ends and something really changed. */
  readonly onCommitFrames: (
    label: string,
    frames: readonly { readonly id: LayerId; readonly frame: Rect }[],
  ) => void;
  readonly images: ReturnType<typeof useSceneImages>;
  readonly showGuides: boolean;
  /** Whether pointer gestures snap to guides, grid lines and sibling edges. */
  readonly snapping: boolean;
  /** Guides a gesture snapped to, shown as dashed lines while dragging. */
  readonly onGuidesChange?:
    | ((guides: { readonly x: readonly number[]; readonly y: readonly number[] }) => void)
    | undefined;
  /** Device pixel ratio to rasterise at; the browser value keeps the canvas crisp. */
  readonly pixelRatio?: number | undefined;
};

type Marquee = { readonly from: Point; readonly to: Point };

/**
 * The artboard.
 *
 * Draws the real document with the same renderer the export pipeline uses, and turns pointer input
 * into selection, movement and resizing. The scene is painted into a `<canvas>`; the selection,
 * the resize handles and the marquee are DOM elements on top, so every one of them is focusable,
 * labelled and operable from the keyboard (ADR-0018).
 *
 * During a drag the canvas paints a *preview* scene and no history entry exists. Exactly one commit
 * is produced when the pointer is released — or none at all if the gesture is cancelled.
 */
export function Artboard({
  doc,
  zoom,
  selection,
  onSelectionChange,
  onCommitFrames,
  images,
  showGuides,
  snapping,
  pixelRatio,
}: ArtboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [gesture, setGesture] = useState<GestureState | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  // A click on an already-selected layer keeps the whole selection (so a multi-layer drag works) and
  // only collapses to that layer if the pointer never moved.
  const [collapseOnRelease, setCollapseOnRelease] = useState<LayerId | null>(null);

  const dpr = pixelRatio ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(doc.canvas.width * zoom));
  const height = Math.max(1, Math.round(doc.canvas.height * zoom));

  const targets = useMemo(
    () =>
      buildSnapTargets({
        canvas: doc.canvas,
        gridMm: doc.guides.gridMm,
        pixelsPerMm: toPixels(1, 'mm', doc.canvas.dpi),
        siblings: doc.scene.layers,
        alignmentGuides: [],
      }),
    [doc.canvas, doc.guides.gridMm, doc.scene.layers],
  );

  const preview = useMemo(
    () =>
      resolveGesture(gesture, {
        scene: doc.scene,
        canvas: doc.canvas,
        targets,
        snapEnabled: snapping,
        snapThreshold: snapThresholdForZoom(zoom),
      }),
    [gesture, doc.scene, doc.canvas, targets, zoom, snapping],
  );

  // With no gesture in flight, `preview.scene` *is* the committed scene.
  const scene = preview.scene;
  const selectedFrame = selectionFrame(scene, selection);

  // Paint whenever anything about the picture changes. Selection is drawn in the DOM overlay, so
  // selecting does not repaint the artwork.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d') as unknown as PainterContext | null;
    if (!context) return;

    const plan = buildRenderPlan(
      { ...doc, scene },
      {
        measureFont: contextMeasureFactory(context),
        resolveImage: images.resolver,
      },
    );

    context.save();
    context.scale(zoom * dpr, zoom * dpr);
    paintPlan(context, plan, { clear: true });
    context.restore();
    // Guides are *editor aids*, not artwork: they live in the DOM overlay below, so they stay one
    // pixel wide at every zoom and can never leak into an exported image.
  }, [doc, scene, images.resolver, zoom, dpr]);

  const toDocument = (event: { clientX: number; clientY: number }): Point => {
    const surface = surfaceRef.current;
    if (!surface) return { x: 0, y: 0 };
    const bounds = surface.getBoundingClientRect();
    return toDocumentPoint(
      { x: event.clientX, y: event.clientY },
      { x: bounds.left, y: bounds.top },
      zoom,
    );
  };

  function beginPointer(event: React.PointerEvent<HTMLElement>): void {
    const point = toDocument(event);
    const hit = hitTestScene(doc.scene, point);
    const additive = event.metaKey || event.ctrlKey || event.shiftKey;

    if (!hit) {
      if (!additive) onSelectionChange(EMPTY_SELECTION);
      setMarquee({ from: point, to: point });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const alreadySelected = isSelected(selection, hit.id);
    const nextSelection = additive
      ? toggleSelection(selection, hit.id)
      : alreadySelected
        ? selection
        : selectOnly(hit.id);
    if (!additive && !alreadySelected) onSelectionChange(selectOnly(hit.id));
    setCollapseOnRelease(!additive && alreadySelected ? hit.id : null);

    setGesture({
      ...beginMove({ pointer: point, scene: doc.scene, selection: nextSelection, anchor: hit }),
      modifiers: modifiersOf(event),
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event: React.PointerEvent<HTMLElement>): void {
    const point = toDocument(event);
    if (marquee) {
      setMarquee({ from: marquee.from, to: point });
      return;
    }
    if (!gesture) {
      // Hover feedback: the cursor says whether a handle or a layer is under the pointer.
      const hovered = hitTestScene(doc.scene, point);
      setHint(hovered ? `${hovered.name}` : null);
      return;
    }
    setGesture(updateGesture(gesture, point, modifiersOf(event)));
  }

  function endPointer(event: React.PointerEvent<HTMLElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (marquee) {
      const rect = rectFromPoints(marquee.from, marquee.to);
      // A click without a drag clears the selection; a drag selects what it covers.
      if (rect.width > 2 || rect.height > 2) {
        const covered: LayerId[] = layersInRect(doc.scene, rect).map((layer) => layer.id);
        onSelectionChange(Object.freeze(covered));
      }
      setMarquee(null);
      return;
    }

    if (!gesture) return;

    if (gestureChangedSomething(gesture, preview)) {
      onCommitFrames(
        gestureLabel(gesture, doc.scene),
        gesture.start.frames.map((entry) => ({
          id: entry.id,
          frame: frameFromScene(preview.scene, entry.id) ?? entry.frame,
        })),
      );
    } else if (collapseOnRelease) {
      // A click that moved nothing is a request to select exactly one layer.
      onSelectionChange(selectOnly(collapseOnRelease));
    }
    setCollapseOnRelease(null);
    setGesture(null);
  }

  /** Escape or a cancelled pointer drops the preview: nothing is committed. */
  function cancelGesture(): void {
    setGesture(null);
    setMarquee(null);
    setHint(null);
    setCollapseOnRelease(null);
  }

  function startResize(event: React.PointerEvent<HTMLElement>, handle: TransformHandle): void {
    event.stopPropagation();
    const layer = doc.scene.layers.find((candidate) => isSelected(selection, candidate.id));
    if (!layer) return;
    const point = toDocument(event);
    const surface = surfaceRef.current;
    surface?.setPointerCapture(event.pointerId);
    setGesture({
      ...beginResize(point, layer, handle),
      modifiers: modifiersOf(event),
    });
  }

  const marqueeRect = marquee ? rectFromPoints(marquee.from, marquee.to) : null;

  return (
    <div
      className="relative shrink-0"
      style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
      data-testid="artboard"
    >
      {showGuides ? <GuideOverlay doc={doc} zoom={zoom} width={width} height={height} /> : null}

      <canvas
        ref={canvasRef}
        data-testid="document-canvas"
        width={Math.round(width * dpr)}
        height={Math.round(height * dpr)}
        style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
        className="border-line block rounded-sm border bg-[repeating-conic-gradient(#1b1f27_0%_25%,#151920_0%_50%)] bg-[length:16px_16px]"
        role="img"
        aria-label={`Artboard preview: ${String(doc.scene.layers.length)} layers, ${String(
          doc.canvas.width,
        )} by ${String(doc.canvas.height)} pixels`}
      />

      {/*
        The capture surface. It is a real focusable element with a label, so selecting, moving and
        resizing are all reachable from the keyboard as well as the pointer.
      */}
      <div
        ref={surfaceRef}
        data-testid="artboard-surface"
        className="absolute inset-0 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--color-focus)]"
        onPointerDown={beginPointer}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={cancelGesture}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancelGesture();
        }}
        title={hint ?? undefined}
      >
        {selectedFrame ? (
          <div
            data-testid="selection-overlay"
            className="pointer-events-none absolute border border-[color:var(--color-accent)]"
            style={box(scaleRect(selectedFrame, zoom))}
          >
            {TRANSFORM_HANDLES.map((handle) => (
              <button
                key={handle}
                type="button"
                aria-label={`Resize ${HANDLE_LABELS[handle].toLowerCase()}`}
                data-testid={`handle-${handle}`}
                className="bg-surface-raised border-accent pointer-events-auto absolute h-3 w-3 rounded-[2px] border"
                style={handleStyle(handle, scaleRect(selectedFrame, zoom))}
                onPointerDown={(event) => {
                  startResize(event, handle);
                }}
                onPointerMove={movePointer}
                onPointerUp={endPointer}
                onPointerCancel={cancelGesture}
              />
            ))}
          </div>
        ) : null}

        {gesture && (preview.guidesX.length > 0 || preview.guidesY.length > 0) ? (
          <SnappingGuides
            guidesX={preview.guidesX}
            guidesY={preview.guidesY}
            zoom={zoom}
            width={width}
            height={height}
          />
        ) : null}

        {marqueeRect ? (
          <div
            data-testid="marquee"
            className="border-accent/70 bg-accent/10 pointer-events-none absolute border"
            style={box(scaleRect(marqueeRect, zoom))}
          />
        ) : null}
      </div>
    </div>
  );
}

function modifiersOf(event: {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): GestureModifiers {
  if (!event.shiftKey && !event.altKey) return NO_MODIFIERS;
  return { preserveAspectRatio: event.shiftKey, resizeFromCentre: event.altKey };
}

function frameFromScene(scene: Scene, id: LayerId | string): Rect | undefined {
  return scene.layers.find((layer) => String(layer.id) === String(id))?.frame;
}

function rectFromPoints(a: Point, b: Point): Rect {
  return createRect(
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
  );
}

/** Document pixels to CSS pixels inside the artboard. */
function scaleRect(rect: Rect, zoom: number): Rect {
  return createRect(rect.x * zoom, rect.y * zoom, rect.width * zoom, rect.height * zoom);
}

function box(rect: Rect): React.CSSProperties {
  return {
    left: `${String(rect.x)}px`,
    top: `${String(rect.y)}px`,
    width: `${String(rect.width)}px`,
    height: `${String(rect.height)}px`,
  };
}

function handleStyle(handle: TransformHandle, screen: Rect): React.CSSProperties {
  const anchors: Record<TransformHandle, { x: number; y: number }> = {
    nw: { x: 0, y: 0 },
    n: { x: 0.5, y: 0 },
    ne: { x: 1, y: 0 },
    e: { x: 1, y: 0.5 },
    se: { x: 1, y: 1 },
    s: { x: 0.5, y: 1 },
    sw: { x: 0, y: 1 },
    w: { x: 0, y: 0.5 },
  };
  const anchor = anchors[handle];
  return {
    left: `${String(screen.width * anchor.x - 6)}px`,
    top: `${String(screen.height * anchor.y - 6)}px`,
    cursor: handleCursor(handle),
  };
}

/**
 * The document's guides, drawn as DOM lines rather than into the bitmap.
 *
 * They are reference marks — safe margin, bleed, centre lines and the grid — so keeping them out of
 * the canvas means they never appear in an export and never blur when the artboard is zoomed.
 * Everything is `aria-hidden`: guides are decoration, and the numbers behind them are in the spec row.
 */
export function GuideOverlay({
  doc,
  zoom,
  width,
  height,
}: {
  readonly doc: ForgeDocument;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}) {
  const { canvas, guides } = doc;
  const pxPerMm = toPixels(1, 'mm', canvas.dpi);
  const safe = insetRect(canvas, guides.safeMarginMm * pxPerMm);
  const bleed = guides.bleedMm > 0 ? bleedBand(canvas, guides.bleedMm * pxPerMm) : null;
  const grid = guides.showGrid ? gridLinePositions(canvas, guides.gridMm * pxPerMm) : [];

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {bleed ? (
        <span
          data-guide="bleed"
          className="absolute border border-dashed border-[rgba(255,138,61,0.55)]"
          style={box(scaleRect(bleed, zoom))}
        />
      ) : null}
      <span
        data-guide="safe"
        className="absolute border border-[rgba(79,140,255,0.55)]"
        style={box(scaleRect(safe, zoom))}
      />
      {grid.map((position) => (
        <span key={`grid-x-${String(position)}`}>
          <span
            data-guide="grid-x"
            className="absolute top-0 w-px bg-[rgba(244,245,247,0.12)]"
            style={{ left: `${String(position * zoom)}px`, height: `${String(height)}px` }}
          />
          <span
            data-guide="grid-y"
            className="absolute left-0 h-px bg-[rgba(244,245,247,0.12)]"
            style={{ top: `${String(position * zoom)}px`, width: `${String(width)}px` }}
          />
        </span>
      ))}
      {guides.showCentreLines ? (
        <>
          <span
            data-guide="centre-x"
            className="absolute top-0 w-px bg-[rgba(56,224,200,0.5)]"
            style={{
              left: `${String((canvas.width / 2) * zoom)}px`,
              height: `${String(height)}px`,
            }}
          />
          <span
            data-guide="centre-y"
            className="absolute left-0 h-px bg-[rgba(56,224,200,0.5)]"
            style={{
              top: `${String((canvas.height / 2) * zoom)}px`,
              width: `${String(width)}px`,
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/** Guide lines a gesture snapped to, drawn as dashed overlays. */
export function SnappingGuides({
  guidesX,
  guidesY,
  zoom,
  height,
  width,
}: {
  readonly guidesX: readonly number[];
  readonly guidesY: readonly number[];
  readonly zoom: number;
  readonly height: number;
  readonly width: number;
}) {
  if (guidesX.length === 0 && guidesY.length === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {guidesX.map((x) => (
        <div
          key={`x-${String(x)}`}
          className={cn('bg-accent/70 absolute top-0 w-px')}
          style={{ left: `${String(x * zoom)}px`, height: `${String(height)}px` }}
        />
      ))}
      {guidesY.map((y) => (
        <div
          key={`y-${String(y)}`}
          className={cn('bg-accent/70 absolute left-0 h-px')}
          style={{ top: `${String(y * zoom)}px`, width: `${String(width)}px` }}
        />
      ))}
    </div>
  );
}

/** Human notes about graphics that are not ready to draw, so the artboard can say so. */
export function describeImageState(
  layers: readonly Layer[],
  status: ReadonlyMap<string, 'loading' | 'ready' | 'error'>,
): readonly string[] {
  const notes: string[] = [];
  for (const layer of layers) {
    if (layer.type !== 'image') continue;
    const state = status.get(layer.image.href);
    if (state === 'error') notes.push(`“${layer.name}” could not be loaded.`);
    else if (state !== 'ready') notes.push(`“${layer.name}” is still loading.`);
  }
  return notes;
}
