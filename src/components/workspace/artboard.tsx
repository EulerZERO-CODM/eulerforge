'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

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
import { createBrowserSurface } from '../../lib/browser/canvas';
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
  lockedSelectionIds,
  selectOnly,
  selectionFrame,
  toggleSelection,
  transformFrame,
  transformTargets,
  unionSelection,
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

type Marquee = {
  readonly from: Point;
  readonly to: Point;
  /**
   * A marquee started with a modifier adds to the selection instead of replacing it, and a modifier
   * click on empty space leaves the selection alone entirely.
   */
  readonly additive: boolean;
};

/**
 * The artboard.
 *
 * Draws the real document with the same renderer the export pipeline uses, and turns pointer input
 * into selection, movement and resizing. The scene is painted into a `<canvas>`; the selection,
 * the resize handles and the marquee are DOM elements on top, so every one of them is focusable,
 * labelled and operable from the keyboard (ADR-0017).
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
  // Set by a modifier click, which toggles selection rather than starting a drag.
  const [selectingOnly, setSelectingOnly] = useState(false);
  // A keyboard resize in flight, held in a ref because the keyup that ends it must resolve exactly
  // the gesture the last keydown produced, whatever React has re-rendered in between.
  const keyResizeRef = useRef<{ gesture: GestureState; point: Point } | null>(null);

  /**
   * Device pixel ratio to rasterise at.
   *
   * The server cannot know the display density, and reading the browser's value during hydration
   * would change the canvas' own width and height attributes under React: a hydration error, and a
   * second paint of the whole page. `useSyncExternalStore` gets both halves right - the hydration
   * render uses the server's answer, one device pixel per CSS pixel, and the next render uses the
   * display's real density, which the paint effect below picks up. The renderer is resolution
   * independent, so nothing about the document or its geometry depends on this.
   */
  const displayRatio = useSyncExternalStore(
    subscribeToDisplayDensity,
    readDevicePixelRatio,
    serverDevicePixelRatio,
  );
  const dpr = pixelRatio ?? displayRatio;
  const width = Math.max(1, Math.round(doc.canvas.width * zoom));
  const height = Math.max(1, Math.round(doc.canvas.height * zoom));

  /**
   * The layers the gesture in flight is changing.
   *
   * `buildSnapTargets` is documented to receive siblings *excluding* the layers being dragged, and
   * this is why: a frame's own edges are the positions it is leaving. Including them makes a short
   * drag snap back onto its starting frame - six screen pixels of pull towards where the layer
   * already was - and a drag of less than the threshold commits nothing at all.
   */
  const draggingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of gesture?.start.frames ?? []) ids.add(String(entry.id));
    return ids;
  }, [gesture]);

  const targets = useMemo(
    () =>
      buildSnapTargets({
        canvas: doc.canvas,
        gridMm: doc.guides.gridMm,
        pixelsPerMm: toPixels(1, 'mm', doc.canvas.dpi),
        siblings: doc.scene.layers.filter((layer) => !draggingIds.has(String(layer.id))),
        alignmentGuides: [],
      }),
    [doc.canvas, doc.guides.gridMm, doc.scene.layers, draggingIds],
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
  /** Everything selected: drawn as selected even when a part of it cannot be transformed. */
  const selectedFrame = selectionFrame(scene, selection);
  /**
   * What a gesture can actually change. Handles are drawn from this box, never from `selectedFrame`:
   * a locked layer inside the selection is shown as selected but must not inflate the box the
   * handles promise to resize.
   */
  const gestureBox = transformFrame(scene, selection);
  const lockedIds = lockedSelectionIds(scene, selection);
  const lockedCount = lockedIds.length;

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
    // The surface factory is what lets a tinted graphic be tinted on its own alpha mask rather
    // than over the document background.
    paintPlan(context, plan, { clear: true, createSurface: createBrowserSurface });
    context.restore();
    // Guides are *editor aids*, not artwork: they live in the DOM overlay below, so they stay one
    // pixel wide at every zoom and can never leak into an exported image.
    // `images.status` is a dependency, not a convenience: a graphic is decoded asynchronously, so
    // the plan built when the layer was added cannot draw it. Without this the canvas keeps the
    // picture it had while the graphic was still loading, and the graphic never appears.
  }, [doc, scene, images.resolver, images.status, zoom, dpr]);

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
    // Two questions, one hit test: what can be transformed here, and what is *visibly* on top?
    // A locked layer on top means "nothing happens", not "empty space", so a click on it must not
    // quietly clear the selection or pick up whatever happens to sit underneath.
    const topmost = hitTestScene(doc.scene, point, { includeLocked: true });
    const hit = topmost !== null && !topmost.locked ? topmost : null;
    const additive = event.metaKey || event.ctrlKey || event.shiftKey;

    if (topmost !== null && topmost.locked) {
      // A locked layer: it can be neither picked nor moved by a canvas gesture, so the press only
      // explains itself. The selection is left exactly as it was, including a group the user built
      // in the layer tree that contains more than just this layer.
      setHint(`“${topmost.name}” is locked — unlock it in the layer list to move or select it.`);
      setCollapseOnRelease(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (!hit) {
      // Empty space: a plain click (or drag) starts a fresh marquee, a modified one extends.
      if (!additive) onSelectionChange(EMPTY_SELECTION);
      setMarquee({ from: point, to: point, additive });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const alreadySelected = isSelected(selection, hit.id);

    if (additive) {
      // Modifier click is a selection gesture: it toggles and *does not* start a move, so adding a
      // layer to a group cannot nudge it by a pixel.
      onSelectionChange(toggleSelection(selection, hit.id));
      setSelectingOnly(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    // The selection the gesture runs with, decided *here* rather than left to the next render:
    // `onSelectionChange` schedules a state update, and React does not replace the `selection` prop
    // in the middle of this handler. Passing the old prop would let a drag on a layer that was not
    // selected capture the group it is replacing, so the visible selection and the moving layers
    // would disagree.
    const gestureSelection = alreadySelected ? selection : selectOnly(hit.id);
    if (!alreadySelected) onSelectionChange(gestureSelection);
    // Clicking a member of an existing selection keeps the group so the drag moves all of it; the
    // click only collapses to that single layer if the pointer never moved.
    // Clicking an already-selected *locked* layer keeps the group: collapsing to a layer that cannot
    // be moved would throw away a selection the user just built.
    setCollapseOnRelease(alreadySelected && !hit.locked ? hit.id : null);

    setGesture({
      ...beginMove({ pointer: point, scene: doc.scene, selection: gestureSelection, anchor: hit }),
      modifiers: modifiersOf(event),
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event: React.PointerEvent<HTMLElement>): void {
    const point = toDocument(event);
    if (marquee) {
      setMarquee({ from: marquee.from, to: point, additive: marquee.additive });
      return;
    }
    if (!gesture) {
      // Hover feedback: the cursor says whether a handle or a layer is under the pointer.
      const hovered = hitTestScene(doc.scene, point, { includeLocked: true });
      setHint(hovered === null ? null : hovered.locked ? `${hovered.name} — locked` : hovered.name);
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
      // A click without a drag leaves the selection as it was (the non-additive case already
      // cleared it on pointer-down); a drag selects what it covers, adding when modified.
      if (rect.width > 2 || rect.height > 2) {
        const covered: LayerId[] = layersInRect(doc.scene, rect).map((layer) => layer.id);
        onSelectionChange(
          marquee.additive ? unionSelection(selection, covered) : Object.freeze(covered),
        );
      }
      setMarquee(null);
      return;
    }

    if (selectingOnly) {
      setSelectingOnly(false);
      setCollapseOnRelease(null);
      return;
    }

    if (!gesture) {
      // A pointer-up that started no gesture (a locked layer, a modifier click) must not leave the
      // "collapse on release" flag armed for the next gesture.
      setCollapseOnRelease(null);
      return;
    }

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

  /**
   * Escape or a cancelled pointer drops the preview: no commit, no history entry, no half-applied
   * document. The selection is whatever the gesture's first click established, never a stale one.
   */
  function cancelGesture(): void {
    keyResizeRef.current = null;
    setGesture(null);
    setMarquee(null);
    setHint(null);
    setCollapseOnRelease(null);
    setSelectingOnly(false);
  }

  // A gesture can be cancelled from anywhere: while a pointer is captured the keyboard focus may sit
  // on a handle or an inspector field, so the listener is global but only active mid-interaction.
  const interactionActive = gesture !== null || marquee !== null;
  useEffect(() => {
    if (!interactionActive) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') cancelGesture();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [interactionActive]);

  /** Moves the transformable selection by whole document pixels — the keyboard path for a move. */
  function nudgeSelection(dx: number, dy: number): void {
    const targets = transformTargets(doc.scene, selection);
    if (targets.length === 0) return;
    onCommitFrames(
      nudgeLabel(doc.scene, targets),
      targets.map((target) => ({
        id: target.id,
        frame: createRect(
          target.frame.x + dx,
          target.frame.y + dy,
          target.frame.width,
          target.frame.height,
        ),
      })),
    );
  }

  /**
   * Starts a resize of the whole selection.
   *
   * The targets are the unlocked selected layers - the same list the handles were drawn from - so a
   * group resize scales every one of them through a single transform and lands as one commit.
   */
  function startResize(event: React.PointerEvent<HTMLElement>, handle: TransformHandle): void {
    event.stopPropagation();
    const targets = transformTargets(doc.scene, selection);
    if (targets.length === 0) return;
    const point = toDocument(event);
    const surface = surfaceRef.current;
    surface?.setPointerCapture(event.pointerId);
    setGesture({
      ...beginResize(point, targets, handle),
      modifiers: modifiersOf(event),
    });
  }

  /**
   * Resizes the selection from the keyboard, for the handle that has focus.
   *
   * The arrow keys move *that handle* by one document pixel, or ten with Shift, and Alt resizes from
   * the centre - the same modifiers the pointer path honours. It is not a shortcut around the maths:
   * the keys drive `beginResize`/`updateGesture`, so a keyboard resize is one preview and one commit
   * on keyup, exactly like a drag.
   */
  function keyResize(event: React.KeyboardEvent<HTMLElement>, handle: TransformHandle): void {
    const move = arrowDelta(event.key, event.shiftKey ? KEY_RESIZE_STEP * 10 : KEY_RESIZE_STEP);
    if (!move) return;
    // The handle sits inside the capture surface, whose own handler nudges the selection with the
    // very same keys: without this the two would both fire and the layer would move as it resized.
    event.preventDefault();
    event.stopPropagation();

    const live = keyResizeRef.current;
    if (!live) {
      // A pointer gesture in flight owns the transform; the keys must not hijack it.
      if (gesture) return;
      const frames = transformTargets(doc.scene, selection);
      if (frames.length === 0) return;
      // `beginResize` uses the pointer only as a reference, so zero is the origin and each press is
      // measured from it.
      const started = updateGesture(
        beginResize({ x: 0, y: 0 }, frames, handle),
        move,
        resizeModifiers(event),
      );
      keyResizeRef.current = { gesture: started, point: move };
      setGesture(started);
      return;
    }

    // The delta is absolute from the origin, so the ref holds the gesture as it now stands: the
    // keyup resolves the same value the preview showed.
    const point = { x: live.point.x + move.x, y: live.point.y + move.y };
    const next = updateGesture(live.gesture, point, resizeModifiers(event));
    keyResizeRef.current = { gesture: next, point };
    setGesture(next);
  }

  /** Ends a keyboard resize: one labelled commit if anything changed, nothing at all if it did not. */
  function endKeyResize(): void {
    const live = keyResizeRef.current;
    if (!live) return;
    keyResizeRef.current = null;

    const resolved = resolveGesture(live.gesture, {
      scene: doc.scene,
      canvas: doc.canvas,
      targets,
      snapEnabled: snapping,
      snapThreshold: snapThresholdForZoom(zoom),
    });
    if (gestureChangedSomething(live.gesture, resolved)) {
      onCommitFrames(
        gestureLabel(live.gesture, doc.scene),
        live.gesture.start.frames.map((entry) => ({
          id: entry.id,
          frame: frameFromScene(resolved.scene, entry.id) ?? entry.frame,
        })),
      );
    }
    setGesture(null);
  }

  /** Tabbing away from a half-finished keyboard resize abandons it, like a cancelled pointer. */
  function abandonKeyResize(): void {
    if (!keyResizeRef.current) return;
    keyResizeRef.current = null;
    setGesture(null);
  }

  const marqueeRect = marquee ? rectFromPoints(marquee.from, marquee.to) : null;

  return (
    <div
      className="relative shrink-0"
      style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
      data-testid="artboard"
      // Geometry the browser suite reads to convert document pixels into pointer coordinates at
      // whatever zoom the stage is using. Inert in the product itself.
      data-canvas-width={doc.canvas.width}
      data-canvas-height={doc.canvas.height}
      data-zoom={zoom}
    >
      {showGuides ? <GuideOverlay doc={doc} zoom={zoom} width={width} height={height} /> : null}

      <canvas
        ref={canvasRef}
        data-testid="document-canvas"
        width={Math.round(width * dpr)}
        height={Math.round(height * dpr)}
        style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
        // An outline rather than a border: a border is inside the element's box, which would squeeze
        // the painted artwork into a 1px-smaller content box and leave the picture fractionally out
        // of step with the guides, the handles and the pointer mapping, all of which are positioned
        // against the artboard's own box.
        className="outline-line block rounded-sm bg-[repeating-conic-gradient(#1b1f27_0%_25%,#151920_0%_50%)] bg-[length:16px_16px] outline outline-1"
        role="img"
        aria-label={`Artboard preview: ${String(doc.scene.layers.length)} layers, ${String(
          doc.canvas.width,
        )} by ${String(doc.canvas.height)} pixels`}
      />

      {/*
        The capture surface. It is a real focusable element with a label, so selecting, moving and
        resizing are all reachable from the keyboard as well as the pointer: arrow keys move the
        selection, Escape cancels an interaction, and every layer stays reachable from the layer list.
      */}
      <div
        ref={surfaceRef}
        data-testid="artboard-surface"
        role="group"
        aria-label="Artboard canvas"
        aria-describedby="artboard-keyboard-help"
        tabIndex={0}
        className="absolute inset-0 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--color-focus)]"
        onPointerDown={beginPointer}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={cancelGesture}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (gesture || marquee) cancelGesture();
            else onSelectionChange(EMPTY_SELECTION);
            return;
          }
          const step = event.shiftKey ? 10 : 1;
          if (event.key === 'ArrowLeft') nudgeSelection(-step, 0);
          else if (event.key === 'ArrowRight') nudgeSelection(step, 0);
          else if (event.key === 'ArrowUp') nudgeSelection(0, -step);
          else if (event.key === 'ArrowDown') nudgeSelection(0, step);
          else return;
          event.preventDefault();
        }}
        title={hint ?? undefined}
      >
        <span id="artboard-keyboard-help" className="sr-only">
          Arrow keys move the selection by one pixel, or ten with Shift. With a resize handle
          focused, they move that handle instead, and Alt resizes from the centre. Escape cancels a
          drag in progress, or clears the selection. Layers are selected from the layer list, which
          also carries every layer operation; position, size, typography and shape settings are in
          the inspector beside the artboard.
        </span>

        {selectedFrame ? (
          <div
            data-testid="selection-overlay"
            className="pointer-events-none absolute border border-[color:var(--color-accent)]"
            style={box(scaleRect(selectedFrame, zoom))}
          >
            {gestureBox ? (
              <>
                <span data-testid="selection-bounds-label" className="sr-only">
                  {describeBounds(gestureBox, zoom)}
                </span>
                {TRANSFORM_HANDLES.map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    aria-label={`Resize ${HANDLE_LABELS[handle].toLowerCase()}`}
                    data-testid={`handle-${handle}`}
                    className="bg-surface-raised border-accent pointer-events-auto absolute h-3 w-3 rounded-[2px] border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-focus)]"
                    style={handleStyle(
                      handle,
                      scaleRect(gestureBox, zoom),
                      scaleRect(selectedFrame, zoom),
                    )}
                    onPointerDown={(event) => {
                      startResize(event, handle);
                    }}
                    onPointerMove={movePointer}
                    onPointerUp={endPointer}
                    onPointerCancel={cancelGesture}
                    onKeyDown={(event) => {
                      keyResize(event, handle);
                    }}
                    onKeyUp={endKeyResize}
                    onBlur={abandonKeyResize}
                  />
                ))}
              </>
            ) : (
              <span data-testid="selection-locked-note" className="sr-only">
                {lockedCount === 0
                  ? 'Nothing in the selection can be resized.'
                  : `Every selected layer is locked, so there are no resize handles. Unlock ${lockedCount === 1 ? 'it' : 'them'} in the layer list to transform ${lockedCount === 1 ? 'it' : 'them'}.`}
              </span>
            )}
            {gestureBox && lockedCount > 0 ? (
              <span data-testid="selection-locked-note" className="sr-only">
                {`${String(lockedCount)} selected ${lockedCount === 1 ? 'layer is' : 'layers are'} locked and left out of this box: unlock ${lockedCount === 1 ? 'it' : 'them'} in the layer list to include ${lockedCount === 1 ? 'it' : 'them'}.`}
              </span>
            ) : null}
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

/**
 * Accessible description of the box the handles act on.
 *
 * Says "of N" when only part of the selection can be transformed, so a screen-reader user is told
 * what the handles will really do rather than being left to discover it.
 */
function describeBounds(frame: Rect, zoom: number): string {
  const round = (value: number) => Math.round(value);
  return `Selection bounds ${String(round(frame.x))}, ${String(round(frame.y))}, ${String(
    round(frame.width),
  )} by ${String(round(frame.height))} document pixels at ${String(Math.round(zoom * 100))} percent zoom.`;
}

/** Label for a keyboard nudge, matching what a drag of the same layers would record. */
function nudgeLabel(scene: Scene, targets: readonly { readonly id: LayerId }[]): string {
  if (targets.length > 1) return `Move ${String(targets.length)} layers`;
  const id = targets[0]?.id;
  const name = scene.layers.find((layer) => String(layer.id) === String(id))?.name ?? 'layer';
  return `Move “${name}”`;
}

/** One document pixel per arrow press from a handle, or ten with Shift: the move keys' own step. */
const KEY_RESIZE_STEP = 1;

/** The movement one arrow key asks for, or null for any other key. */
function arrowDelta(key: string, step: number): Point | null {
  if (key === 'ArrowLeft') return { x: -step, y: 0 };
  if (key === 'ArrowRight') return { x: step, y: 0 };
  if (key === 'ArrowUp') return { x: 0, y: -step };
  if (key === 'ArrowDown') return { x: 0, y: step };
  return null;
}

/**
 * Modifiers for a keyboard resize.
 *
 * Shift is the ten-pixel step here rather than the pointer's aspect-ratio lock, so it cannot also
 * mean `preserveAspectRatio`; Alt keeps its meaning of resizing from the centre.
 */
function resizeModifiers(event: { readonly altKey: boolean }): GestureModifiers {
  return { preserveAspectRatio: false, resizeFromCentre: event.altKey };
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

/**
 * The density a server render has to assume: one device pixel per CSS pixel.
 *
 * It is not a guess about the display - it is the only answer that cannot contradict what the browser
 * reports during hydration. The client resolves the real value straight afterwards.
 */
function serverDevicePixelRatio(): number {
  return 1;
}

/** The display's density, or one when the browser does not report a usable number. */
function readDevicePixelRatio(): number {
  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * Density can change while a page is open - a window dragged onto a different display - and is
 * otherwise fixed for a session, so the subscription is a media query on the current ratio.
 */
function subscribeToDisplayDensity(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(`(resolution: ${String(readDevicePixelRatio())}dppx)`);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * Where a handle sits, in the selection overlay's coordinate space.
 *
 * The overlay is drawn around the whole selection, but the handles belong to the box a gesture can
 * actually change — a locked layer inside the selection is shown as selected yet must not inflate
 * the box the handles promise to resize. The two boxes do not share an origin, so the handle is
 * measured from the gesture box and expressed relative to the overlay. Without that, a selection
 * holding a locked layer puts the handles somewhere other than the corner they claim to resize.
 */
function handleStyle(handle: TransformHandle, screen: Rect, origin: Rect): React.CSSProperties {
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
    left: `${String(screen.x - origin.x + screen.width * anchor.x - 6)}px`,
    top: `${String(screen.y - origin.y + screen.height * anchor.y - 6)}px`,
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
  const gridStep = guides.gridMm * pxPerMm;
  // One list per axis: a single list stopped at the smaller side, leaving a wide canvas without
  // grid lines across the part that sticks out.
  const gridX = guides.showGrid ? gridLinePositions(canvas.width, gridStep) : [];
  const gridY = guides.showGrid ? gridLinePositions(canvas.height, gridStep) : [];

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
      {gridX.map((position) => (
        <span
          key={`grid-x-${String(position)}`}
          data-guide="grid-x"
          className="absolute top-0 w-px bg-[rgba(244,245,247,0.12)]"
          style={{ left: `${String(position * zoom)}px`, height: `${String(height)}px` }}
        />
      ))}
      {gridY.map((position) => (
        <span
          key={`grid-y-${String(position)}`}
          data-guide="grid-y"
          className="absolute left-0 h-px bg-[rgba(244,245,247,0.12)]"
          style={{ top: `${String(position * zoom)}px`, width: `${String(width)}px` }}
        />
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

/**
 * Guide lines a gesture snapped to, drawn as dashed overlays.
 *
 * Each line carries the document coordinate it stands for, so a browser test can compare where the
 * guide is *drawn* against the target the document asked for instead of trusting the pointer maths.
 */
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
          data-testid="snap-guide-x"
          data-guide-document-x={x}
          data-guide-screen-x={x * zoom}
          className={cn('bg-accent/70 absolute top-0 w-px')}
          style={{ left: `${String(x * zoom)}px`, height: `${String(height)}px` }}
        />
      ))}
      {guidesY.map((y) => (
        <div
          key={`y-${String(y)}`}
          data-testid="snap-guide-y"
          data-guide-document-y={y}
          data-guide-screen-y={y * zoom}
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
