'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { ForgeDocument } from '../../core/documents/types';
import { createRect, type Point, type Rect } from '../../core/documents/geometry';
import type { Layer, LayerId, PathLayer } from '../../core/documents/layer-types';
import {
  hitTestVectorScene,
  layersInRect,
  toDocumentPoint,
} from '../../core/documents/scene-geometry';
import { buildRenderPlan } from '../../core/render/plan';
import { paintPlan, type PainterContext } from '../../core/render/paint';
import { contextMeasureFactory } from '../../core/render/measure';
import { ellipsePath, rectanglePath, starPath } from '../../core/vector/shapes';
import { moveHandle } from '../../core/vector/ops';
import type { VectorBox, VectorPath, VectorPoint } from '../../core/vector';
import { boundsOfPath } from '../../core/vector/bounds';
import {
  allNodes,
  insertionPointFor,
  nodeKey,
  pickPathTarget,
  visibleHandles,
  type NodeReference,
} from '../../core/vector/pick';
import {
  EMPTY_PEN_DRAFT,
  penAddNode,
  penCanClose,
  penClose,
  penDragHandle,
  penEndDrag,
  penNodeCount,
  penPreview,
  penSetPointer,
  penStart,
  penToPath,
  type PenDraft,
} from '../../core/vector/pen';
import { setLayerFramesCommand, type SceneCommand } from '../../core/editor/commands';
import {
  createPathLayerCommand,
  insertPathNodeCommand,
  movePathHandleCommand,
  movePathNodesCommand,
  translatePathLayerCommand,
} from '../../core/editor/vector-commands';
import { ok, type Result } from '../../core/result';
import {
  EMPTY_SELECTION,
  isSelected,
  selectOnly,
  toggleSelection,
  type Selection,
} from '../../core/editor/selection';
import { cn } from '../../lib/cn';
import { useForgeServices } from '../../state/forge-provider';
import { Button } from '../ui/button';
import { InlineNote } from '../ui/states';
import type { SceneImages } from '../workspace/use-scene-images';
import { VECTOR_TOOL_INFO, type VectorTool } from './vector-tools';
import type { WorkspaceApi } from '../workspace/workspace-api';

/** Pick radius in document units, divided by the zoom so it stays a constant size on screen. */
const PICK_RADIUS_SCREEN_PX = 7;
/** How close to the first node a click must land to close a pen path, in screen pixels. */
const PEN_CLOSE_SCREEN_PX = 10;

type Drag =
  | { readonly kind: 'pen-handle'; readonly draft: PenDraft }
  | {
      readonly kind: 'nodes';
      readonly layerId: LayerId;
      readonly from: Point;
      readonly to: Point;
      readonly refs: readonly NodeReference[];
      readonly start: readonly VectorPoint[];
      readonly original: VectorPath;
    }
  | {
      readonly kind: 'handle';
      readonly layerId: LayerId;
      readonly ref: NodeReference;
      readonly side: 'in' | 'out';
      readonly mirror: boolean;
    }
  | {
      readonly kind: 'shape';
      readonly tool: 'rectangle' | 'ellipse' | 'star';
      readonly from: Point;
      readonly to: Point;
      readonly shift: boolean;
    }
  | {
      readonly kind: 'move';
      readonly from: Point;
      readonly to: Point;
      readonly ids: readonly LayerId[];
    };

export type VectorStageProps = {
  readonly api: WorkspaceApi;
  readonly selection: Selection;
  readonly onSelectionChange: (selection: Selection) => void;
  readonly nodeSelection: readonly NodeReference[];
  readonly onNodeSelectionChange: (nodes: readonly NodeReference[]) => void;
  readonly tool: VectorTool;
  readonly onToolChange: (tool: VectorTool) => void;
  readonly images: SceneImages;
  readonly zoom: number;
  readonly onZoomChange: (zoom: number) => void;
  /** Filled with the geometry the editor currently has under the cursor, for the status line. */
  readonly onStatusChange?: ((status: string | null) => void) | undefined;
};

/**
 * The vector artboard.
 *
 * The artwork is painted with the same renderer the export pipeline uses, so what a designer sees is
 * what a file will contain. Everything editable is a DOM element on top of the canvas — nodes,
 * handles, the pen's rubber band, the shapes being dragged out — which is what makes them reachable
 * by keyboard, visible to a screen reader and testable without simulating a pointer.
 *
 * Nothing here writes to the document directly: every gesture ends in a command, which is committed
 * through the workspace API, so undo, persistence and the history labels all keep working.
 */
export function VectorStage({
  api,
  selection,
  onSelectionChange,
  nodeSelection,
  onNodeSelectionChange,
  tool,
  onToolChange,
  images,
  zoom,
  onZoomChange,
  onStatusChange,
}: VectorStageProps) {
  const { toasts } = useForgeServices();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<PenDraft>(EMPTY_PEN_DRAFT);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  // Where the handle being dragged currently is. Held separately from the document so the artwork
  // under it can be previewed with the handle applied, without committing anything.
  const [handlePoint, setHandlePoint] = useState<Point | null>(null);

  const doc = api.doc;
  const width = Math.max(1, Math.round(doc.canvas.width * zoom));
  const height = Math.max(1, Math.round(doc.canvas.height * zoom));
  const activeLayer = selectedPathLayer(doc, selection);
  const editing = activeLayer?.vector.path ?? null;
  const activeEditing = editing;

  // One preview path for the tool in flight: the pen draft or the shape being dragged out. It is
  // drawn with the committed artwork, so the preview cannot look different from the result.
  const previewPath: VectorPath | null = useMemo(() => {
    if (drag?.kind === 'shape') {
      const box = boxFromPoints(drag.from, drag.to, drag.shift);
      if (box.maxX - box.minX <= 0 && box.maxY - box.minY <= 0) return null;
      if (drag.tool === 'rectangle') return rectanglePath(box);
      if (drag.tool === 'ellipse') return ellipsePath(box);
      return starPath(box, 5);
    }
    if (drag?.kind === 'handle' && handlePoint && activeEditing) {
      const moved = moveHandle(
        activeEditing,
        drag.ref.contourIndex,
        drag.ref.nodeIndex,
        drag.side,
        handlePoint,
        drag.mirror ? 'opposite' : 'none',
      );
      return moved.ok ? moved.value : null;
    }
    if (drag?.kind === 'nodes') {
      // Nodes are previewed by shifting the *original* geometry, so a drag of several nodes is
      // computed once from the committed path instead of compounding per pointer move.
      const dx = drag.to.x - drag.from.x;
      const dy = drag.to.y - drag.from.y;
      if (dx === 0 && dy === 0) return null;
      return shiftedPath(drag.original, drag.refs, dx, dy);
    }
    return penPreview(draft);
  }, [drag, draft, handlePoint, activeEditing]);

  // A live preview of the shape under the cursor, so drawing feels direct.
  const paintingDoc: ForgeDocument = useMemo(() => {
    if (!previewPath) return doc;
    const previewLayer = {
      id: 'preview',
      name: 'preview',
      type: 'path',
      visible: true,
      locked: true,
      opacity: 1,
      frame: frameOfPath(previewPath),
      vector: {
        path: previewPath,
        style: previewStyleFor(activeLayer, drag),
        text: activeLayer?.vector.text ?? null,
      },
    } as unknown as Layer;
    return { ...doc, scene: { layers: [...doc.scene.layers, previewLayer] } };
  }, [doc, previewPath, activeLayer, drag]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d') as unknown as PainterContext | null;
    if (!context) return;
    const plan = buildRenderPlan(paintingDoc, {
      measureFont: contextMeasureFactory(context),
      resolveImage: images.resolver,
    });
    // jsdom and SSR both leave this undefined, so a documented fallback of 1 is required here.
    const ratio = Math.min(4, Math.max(1, globalThis.devicePixelRatio || 1));
    context.save();
    context.scale(zoom * ratio, zoom * ratio);
    paintPlan(context, plan, { clear: true });
    context.restore();
  }, [paintingDoc, images.resolver, zoom]);

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

  const radius = PICK_RADIUS_SCREEN_PX / zoom;
  const closeDistance = PEN_CLOSE_SCREEN_PX / zoom;

  function beginPointer(event: React.PointerEvent<HTMLElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toDocument(event);
    const additive = event.shiftKey;

    if (tool === 'pen') {
      const first = draft.nodes[0];
      if (first && penCanClose(draft, point, closeDistance)) {
        setDraft(penClose(draft));
        return;
      }
      setDraft(draft.nodes.length === 0 ? penStart(point) : penAddNode(draft, point));
      return;
    }

    if (tool === 'rectangle' || tool === 'ellipse' || tool === 'star') {
      setDrag({ kind: 'shape', tool, from: point, to: point, shift: event.shiftKey });
      return;
    }

    if (tool === 'node' && activeLayer && editing) {
      const target = pickPathTarget(editing, point, { radius, includeHandles: true });
      if (target?.kind === 'node') {
        const refs = additive
          ? toggleRef(nodeSelection, target)
          : [{ contourIndex: target.contourIndex, nodeIndex: target.nodeIndex }];
        onNodeSelectionChange(refs);
        // A selected node in the *same* layer is what a node drag moves, so the layer stays put.
        if (target.contourIndex >= 0) {
          setDrag({
            kind: 'nodes',
            layerId: activeLayer.id,
            from: point,
            to: point,
            refs,
            start: refs.map(
              (ref) => editing.contours[ref.contourIndex]?.nodes[ref.nodeIndex]?.point ?? point,
            ),
            original: editing,
          });
        }
        return;
      }
      if (target?.kind === 'handle') {
        setDrag({
          kind: 'handle',
          layerId: activeLayer.id,
          ref: { contourIndex: target.contourIndex, nodeIndex: target.nodeIndex },
          side: target.side,
          mirror: event.shiftKey,
        });
        return;
      }
      // Anywhere else on the outline adds a node exactly under the pointer.
      const insertion = insertionPointFor(editing, point, radius);
      if (insertion) {
        void api.run(
          insertPathNodeCommand(doc, activeLayer.id, point, { maxDistance: radius * 3 }),
        );
        return;
      }
      onNodeSelectionChange([]);
      return;
    }

    // Select tool: pick a layer by its real outline, then move the selection or start a marquee.
    const hit = hitTestVectorScene(doc.scene, point, { includeLocked: true });
    if (hit?.locked) {
      surfaceRef.current?.setAttribute('title', `“${hit.name}” is locked.`);
      return;
    }
    if (!hit) {
      if (!additive) {
        onSelectionChange(EMPTY_SELECTION);
        onNodeSelectionChange([]);
      }
      setDrag({ kind: 'move', from: point, to: point, ids: [] });
      return;
    }
    const next = additive
      ? toggleSelection(selection, hit.id)
      : isSelected(selection, hit.id)
        ? selection
        : selectOnly(hit.id);
    if (next !== selection) onSelectionChange(next);
    if (hit.type === 'path') onNodeSelectionChange(allNodes(hit.vector.path));
    else onNodeSelectionChange([]);
    setDrag({
      kind: 'move',
      from: point,
      to: point,
      ids: next.filter((id) => {
        const layer = doc.scene.layers.find((candidate) => candidate.id === id);
        return layer !== undefined && !layer.locked;
      }),
    });
  }

  function movePointer(event: React.PointerEvent<HTMLElement>): void {
    const point = toDocument(event);
    if (!drag) {
      setHoverPoint(point);
      if (tool === 'pen' && draft.nodes.length > 0 && !draft.dragging) {
        setDraft(penSetPointer(draft, point));
      }
      onStatusChange?.(describeHover(doc, point));
      return;
    }
    switch (drag.kind) {
      case 'pen-handle':
        setDraft(penDragHandle(drag.draft, point));
        return;
      case 'shape':
        setDrag({ ...drag, to: point, shift: event.shiftKey });
        return;
      case 'nodes':
      case 'move':
        setDrag({ ...drag, to: point });
        return;
      case 'handle':
        setHandlePoint(point);
        return;
    }
  }

  function endPointer(event: React.PointerEvent<HTMLElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setHoverPoint(null);
    if (!drag) return;

    if (drag.kind === 'pen-handle') {
      setDraft(penEndDrag(drag.draft));
      setDrag(null);
      return;
    }

    if (drag.kind === 'shape') {
      const box = boxFromPoints(drag.from, drag.to, drag.shift);
      setDrag(null);
      if (box.maxX - box.minX < 1 && box.maxY - box.minY < 1) {
        toasts.info('That shape was too small', 'Drag out a box to create a shape.');
        return;
      }
      const path =
        drag.tool === 'rectangle'
          ? rectanglePath(box)
          : drag.tool === 'ellipse'
            ? ellipsePath(box)
            : starPath(box, 5);
      void commitCommand(
        createPathLayerCommand(doc, { path, name: defaultShapeName(drag.tool) }),
        `Create ${drag.tool}`,
      );
      return;
    }

    if (drag.kind === 'nodes') {
      const dx = drag.to.x - drag.from.x;
      const dy = drag.to.y - drag.from.y;
      setDrag(null);
      if (dx === 0 && dy === 0) return;
      if (drag.refs.length === 1) {
        const ref = drag.refs[0]!;
        const start = drag.start[0] ?? { x: 0, y: 0 };
        void commitCommand(
          movePathNodesCommand(doc, drag.layerId, [
            { ref, to: { x: start.x + dx, y: start.y + dy } },
          ]),
          'Move node',
        );
        return;
      }
      void commitCommand(
        movePathNodesCommand(
          doc,
          drag.layerId,
          drag.refs.map((ref, index) => {
            const start = drag.start[index] ?? { x: 0, y: 0 };
            return { ref, to: { x: start.x + dx, y: start.y + dy } };
          }),
        ),
        `Move ${String(drag.refs.length)} nodes`,
      );
      return;
    }

    if (drag.kind === 'handle') {
      const point = handlePoint ?? toDocument(event);
      setDrag(null);
      setHandlePoint(null);
      void commitCommand(
        movePathHandleCommand(
          doc,
          drag.layerId,
          drag.ref,
          drag.side,
          point,
          drag.mirror ? 'opposite' : 'none',
        ),
        'Drag handle',
      );
      return;
    }

    const dx = drag.to.x - drag.from.x;
    const dy = drag.to.y - drag.from.y;
    setDrag(null);

    if (drag.ids.length === 0) {
      // A marquee: the *pointer* moved, so select what it covered.
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        const covered = layersInRect(doc.scene, rectFromPoints(drag.from, drag.to)).map(
          (layer) => layer.id,
        );
        if (covered.length > 0) onSelectionChange(Object.freeze(covered));
      }
      return;
    }

    const single = drag.ids.length === 1 ? drag.ids[0] : undefined;
    const translate =
      single === undefined
        ? translatePathLayerCommand(doc, '', 0, 0)
        : translatePathLayerCommand(doc, single, dx, dy);

    if (dx === 0 && dy === 0) return;
    if (single !== undefined && translate.ok) {
      void commitScene(translate.value);
      return;
    }
    void commitCommand(
      setLayerFramesCommand(
        doc,
        drag.ids.map((id) => {
          const layer = doc.scene.layers.find((candidate) => candidate.id === id);
          const frame = layer?.frame ?? createRect(0, 0, 1, 1);
          return { id, frame: { ...frame, x: frame.x + dx, y: frame.y + dy } };
        }),
        drag.ids.length > 1 ? `Move ${String(drag.ids.length)} shapes` : 'Move shape',
      ),
      'Move shapes',
    );
  }

  /** Commits a command that is already known to be valid (a kernel result was checked above). */
  async function commitScene(command: SceneCommand, key?: string): Promise<boolean> {
    return api.run(ok(command), key === undefined ? {} : { coalesceKey: `vector:${key}` });
  }

  /**
   * Commits a command, reporting a refusal the same way every other panel does.
   *
   * Coalescing is opt-in and reserved for a *continuous* interaction: holding an arrow key produces a
   * keydown per repeat, and those belong to one undo step. A completed gesture is a discrete action —
   * two rectangles drawn one after another are two entries, not one — so the default is a new entry.
   */
  async function commitCommand(
    command: Result<SceneCommand>,
    fallback: string,
    options: { readonly coalesce?: boolean } = {},
  ): Promise<boolean> {
    if (!command.ok) {
      toasts.warning('That edit was not applied', command.error.message);
      return false;
    }
    return options.coalesce === true
      ? api.run(command, { coalesceKey: `vector:${fallback}` })
      : api.run(command);
  }

  function cancel(): void {
    if (drag?.kind === 'pen-handle') setDraft(penEndDrag(drag.draft));
    setDrag(null);
    setHoverPoint(null);
    setHandlePoint(null);
  }

  /** Finishes the pen draft as an open path, or explains why there is nothing to finish. */
  function finishPen(): void {
    if (draft.nodes.length === 0) return;
    if (draft.nodes.length === 1) {
      toasts.info(
        'A path needs at least two nodes',
        'Place another node, or press Escape to cancel.',
      );
      return;
    }
    const path = penToPath(draft);
    setDraft(EMPTY_PEN_DRAFT);
    void commitCommand(
      createPathLayerCommand(doc, { path: path.ok ? path.value : { contours: [] }, name: 'Path' }),
      'Draw path',
    );
  }

  function cancelPen(): void {
    setDraft(EMPTY_PEN_DRAFT);
    if (drag?.kind === 'pen-handle') setDrag(null);
  }

  const handles = editing ? visibleHandles(editing) : [];
  // Where a click would add a node: the marker is drawn from the same query the command runs, so
  // what the dot promises is what clicking does.
  const insertion =
    tool === 'node' && editing && hoverPoint
      ? insertionPointFor(editing, hoverPoint, radius)
      : null;

  return (
    <section
      aria-label="Vector artboard"
      className="border-line bg-surface-raised/50 flex min-h-0 flex-col overflow-hidden rounded-md border"
      data-testid="vector-stage"
    >
      <div className="border-line-subtle flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
        <span className="text-2xs text-fg-subtle mr-1 font-semibold tracking-wider uppercase">
          Tools
        </span>
        {(Object.keys(VECTOR_TOOL_INFO) as VectorTool[]).map((id) => {
          const info = VECTOR_TOOL_INFO[id];
          return (
            <Button
              key={id}
              variant={tool === id ? 'primary' : 'outline'}
              size="sm"
              aria-pressed={tool === id}
              title={`${info.label} (${info.key}) — ${info.hint}`}
              data-testid={`tool-${id}`}
              onClick={() => {
                onToolChange(id);
                if (id !== 'pen') cancelPen();
              }}
            >
              {info.label}
            </Button>
          );
        })}

        <span className="text-2xs text-fg-subtle ml-2">
          {draft.nodes.length > 0 ? (
            <>
              Drawing: {String(penNodeCount(draft))} node
              {penNodeCount(draft) === 1 ? '' : 's'}
              <Button
                variant="link"
                size="sm"
                className="ml-1"
                data-testid="finish-path"
                onClick={finishPen}
              >
                Finish path
              </Button>
              <Button
                variant="link"
                size="sm"
                className="ml-1"
                data-testid="cancel-path"
                onClick={cancelPen}
              >
                Cancel
              </Button>
            </>
          ) : (
            toolStatusText(tool, activeLayer !== null)
          )}
        </span>

        <span className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            aria-label="Zoom out"
            onClick={() => {
              onZoomChange(Math.max(0.1, Math.round((zoom - 0.25) * 100) / 100));
            }}
          >
            −
          </Button>
          <span className="forge-numeric text-2xs text-fg-muted" data-testid="vector-zoom">
            {String(Math.round(zoom * 100))}%
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="Zoom in"
            onClick={() => {
              onZoomChange(Math.min(8, Math.round((zoom + 0.25) * 100) / 100));
            }}
          >
            +
          </Button>
        </span>
      </div>

      <div className="forge-scroll flex flex-1 overflow-auto p-4">
        <div className="m-auto">
          <div
            className="relative shrink-0"
            style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
            data-testid="vector-artboard"
            data-canvas-width={doc.canvas.width}
            data-canvas-height={doc.canvas.height}
            data-zoom={zoom}
          >
            <canvas
              ref={canvasRef}
              data-testid="vector-canvas"
              width={Math.round(width * Math.min(4, Math.max(1, globalThis.devicePixelRatio || 1)))}
              height={Math.round(
                height * Math.min(4, Math.max(1, globalThis.devicePixelRatio || 1)),
              )}
              style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
              className="outline-line block rounded-sm bg-[repeating-conic-gradient(#1b1f27_0%_25%,#151920_0%_50%)] bg-[length:16px_16px] outline outline-1"
              role="img"
              aria-label={`Vector artboard: ${String(doc.scene.layers.length)} layers, ${String(
                doc.canvas.width,
              )} by ${String(doc.canvas.height)} pixels`}
            />

            <div
              ref={surfaceRef}
              data-testid="vector-surface"
              role="group"
              aria-label="Vector canvas"
              aria-describedby="vector-keyboard-help"
              tabIndex={0}
              className="absolute inset-0 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--color-focus)]"
              style={{ cursor: tool === 'pen' ? 'crosshair' : 'default' }}
              onPointerDown={beginPointer}
              onPointerMove={movePointer}
              onPointerUp={endPointer}
              onPointerCancel={cancel}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  if (draft.nodes.length > 0) cancelPen();
                  else cancel();
                  return;
                }
                if (event.key === 'Enter' && draft.nodes.length > 0) {
                  event.preventDefault();
                  finishPen();
                  return;
                }
                const toolKey = event.target === event.currentTarget ? event.key : '';
                if (toolKey) {
                  const next = toolKeyFor(toolKey);
                  if (next && !event.metaKey && !event.ctrlKey && !event.altKey) {
                    event.preventDefault();
                    onToolChange(next);
                    return;
                  }
                }
                const step = event.shiftKey ? 10 : 1;
                const delta = arrowDelta(event.key, step);
                if (!delta) return;
                event.preventDefault();
                if (tool === 'node' && activeLayer && nodeSelection.length > 0) {
                  const path = activeLayer.vector.path;
                  void commitCommand(
                    movePathNodesCommand(
                      doc,
                      activeLayer.id,
                      nodeSelection.map((ref) => {
                        const node = path.contours[ref.contourIndex]?.nodes[ref.nodeIndex];
                        return {
                          ref,
                          to: {
                            x: (node?.point.x ?? 0) + delta.x,
                            y: (node?.point.y ?? 0) + delta.y,
                          },
                        };
                      }),
                      nodeSelection.length > 1
                        ? `Nudge ${String(nodeSelection.length)} nodes on “${activeLayer.name}”`
                        : `Nudge node on “${activeLayer.name}”`,
                    ),
                    'Nudge nodes',
                    { coalesce: true },
                  );
                  return;
                }
                if (selection.length > 0) {
                  void commitCommand(
                    setLayerFramesCommand(
                      doc,
                      selection.map((id) => {
                        const layer = doc.scene.layers.find((candidate) => candidate.id === id);
                        const frame = layer?.frame ?? createRect(0, 0, 1, 1);
                        return {
                          id,
                          frame: { ...frame, x: frame.x + delta.x, y: frame.y + delta.y },
                        };
                      }),
                      selection.length > 1
                        ? `Move ${String(selection.length)} shapes`
                        : 'Move shape',
                    ),
                    'Move shape',
                    { coalesce: true },
                  );
                }
              }}
            >
              <span id="vector-keyboard-help" className="sr-only">
                Arrow keys move the selected nodes, or the selected shapes when the node tool is not
                active; Shift moves by ten pixels. V selects, A edits nodes, P draws with the pen,
                R, E and S draw a rectangle, ellipse and star. Enter finishes a pen path and Escape
                cancels it.
              </span>

              {activeLayer && tool === 'node' ? (
                <>
                  <div
                    data-testid="vector-selection-box"
                    className="pointer-events-none absolute border border-dashed border-[color:var(--color-accent)]/70"
                    style={boxStyle(activeLayer.frame, zoom)}
                  />
                  {handles.map((handle) => {
                    const node = editing?.contours[handle.contourIndex]?.nodes[handle.nodeIndex];
                    const stored = handle.side === 'in' ? node?.handleIn : node?.handleOut;
                    const dragging =
                      drag?.kind === 'handle' &&
                      drag.side === handle.side &&
                      drag.ref.contourIndex === handle.contourIndex &&
                      drag.ref.nodeIndex === handle.nodeIndex;
                    const point = dragging && handlePoint ? handlePoint : stored;
                    if (!point || !node) return null;
                    return (
                      <span key={`h-${nodeKey(handle)}-${handle.side}`}>
                        <span
                          aria-hidden
                          className="bg-accent/60 pointer-events-none absolute h-px origin-left"
                          style={lineStyle(node.point, point, zoom)}
                        />
                        <button
                          type="button"
                          aria-label={`${handle.side === 'in' ? 'Incoming' : 'Outgoing'} handle of node ${String(handle.nodeIndex + 1)}`}
                          data-testid={`handle-${handle.contourIndex}-${handle.nodeIndex}-${handle.side}`}
                          className="bg-surface-raised border-accent absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--color-focus)]"
                          style={pointStyle(point, zoom)}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            surfaceRef.current?.setPointerCapture(event.pointerId);
                            setDrag({
                              kind: 'handle',
                              layerId: activeLayer.id,
                              ref: {
                                contourIndex: handle.contourIndex,
                                nodeIndex: handle.nodeIndex,
                              },
                              side: handle.side,
                              mirror: event.shiftKey,
                            });
                          }}
                          onPointerMove={movePointer}
                          onPointerUp={endPointer}
                        />
                      </span>
                    );
                  })}
                  {allNodes(editing!).map((ref) => {
                    const node = editing?.contours[ref.contourIndex]?.nodes[ref.nodeIndex];
                    if (!node) return null;
                    const selected = nodeSelection.some(
                      (candidate) =>
                        candidate.contourIndex === ref.contourIndex &&
                        candidate.nodeIndex === ref.nodeIndex,
                    );
                    return (
                      <button
                        key={nodeKey(ref)}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`Node ${String(ref.nodeIndex + 1)} of contour ${String(ref.contourIndex + 1)}`}
                        data-testid={`node-${ref.contourIndex}-${ref.nodeIndex}`}
                        className={cn(
                          'absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--color-focus)]',
                          selected
                            ? 'bg-accent border-accent'
                            : 'bg-surface-raised border-accent/80',
                        )}
                        style={pointStyle(node.point, zoom)}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          surfaceRef.current?.setPointerCapture(event.pointerId);
                          const refs = event.shiftKey ? toggleRef(nodeSelection, ref) : [ref];
                          onNodeSelectionChange(refs);
                          setDrag({
                            kind: 'nodes',
                            layerId: activeLayer.id,
                            from: toDocument(event),
                            to: toDocument(event),
                            refs,
                            start: refs.map((candidate) => {
                              const node =
                                editing.contours[candidate.contourIndex]?.nodes[
                                  candidate.nodeIndex
                                ];
                              if (!node) throw new Error('the dragged node left the path');
                              return node.point;
                            }),
                            original: editing,
                          });
                        }}
                        onPointerMove={movePointer}
                        onPointerUp={endPointer}
                      />
                    );
                  })}
                </>
              ) : null}

              {tool !== 'node' && selection.length > 0 ? (
                <>
                  {selection.map((id) => {
                    const layer = doc.scene.layers.find((candidate) => candidate.id === id);
                    if (!layer) return null;
                    return (
                      <div
                        key={`sel-${String(id)}`}
                        data-testid={`vector-selection-${String(id)}`}
                        className="border-accent pointer-events-none absolute border"
                        style={boxStyle(layer.frame, zoom)}
                      />
                    );
                  })}
                </>
              ) : null}

              {insertion && tool === 'node' ? (
                <span
                  data-testid="vector-insertion-marker"
                  aria-hidden
                  className="bg-accent/70 pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={pointStyle(insertion.point, zoom)}
                />
              ) : null}

              {draft.nodes.length > 0 ? (
                <div className="pointer-events-none absolute inset-0" data-testid="pen-draft">
                  {draft.nodes.map((node, index) => (
                    <span
                      key={`pen-${String(index)}`}
                      className="bg-accent border-surface absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                      style={pointStyle(node.point, zoom)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <p className="border-line-subtle text-2xs text-fg-subtle border-t px-3 py-2">
        {draft.nodes.length > 0
          ? 'Click the first node to close the shape, Enter to finish it open, Escape to cancel.'
          : 'Every edit is undoable: node moves, handle drags, shapes, paint and boolean operations each record one history entry.'}
      </p>

      {activeLayer === null && selection.length > 0 ? (
        <div className="px-3 pb-3">
          <InlineNote tone="info" title="The node tool needs a vector shape">
            <p>
              {selection.length === 1
                ? 'The selected layer is a shape or text layer. Use “Convert to paths” in the inspector to make it editable node by node.'
                : 'Several layers are selected. Select one shape to edit its nodes, or combine them with a boolean operation.'}
            </p>
          </InlineNote>
        </div>
      ) : null}
    </section>
  );
}

function toolStatusText(tool: VectorTool, hasPath: boolean): string {
  if (tool === 'node' && !hasPath) return 'Select a vector shape to edit its nodes.';
  return VECTOR_TOOL_INFO[tool].hint;
}

function toolKeyFor(key: string): VectorTool | null {
  const upper = key.toUpperCase();
  const map: Record<string, VectorTool> = {
    V: 'select',
    A: 'node',
    P: 'pen',
    R: 'rectangle',
    E: 'ellipse',
    S: 'star',
  };
  return map[upper] ?? null;
}

function arrowDelta(key: string, step: number): Point | null {
  if (key === 'ArrowLeft') return { x: -step, y: 0 };
  if (key === 'ArrowRight') return { x: step, y: 0 };
  if (key === 'ArrowUp') return { x: 0, y: -step };
  if (key === 'ArrowDown') return { x: 0, y: step };
  return null;
}

function toggleRef(list: readonly NodeReference[], ref: NodeReference): readonly NodeReference[] {
  const exists = list.some(
    (candidate) =>
      candidate.contourIndex === ref.contourIndex && candidate.nodeIndex === ref.nodeIndex,
  );
  return exists
    ? list.filter(
        (candidate) =>
          candidate.contourIndex !== ref.contourIndex || candidate.nodeIndex !== ref.nodeIndex,
      )
    : [...list, ref];
}

function selectedPathLayer(doc: ForgeDocument, selection: Selection): PathLayer | null {
  for (const id of selection) {
    const layer = doc.scene.layers.find((candidate) => candidate.id === id);
    if (layer && layer.type === 'path') return layer;
  }
  return null;
}

function boxFromPoints(from: Point, to: Point, square: boolean): VectorBox {
  let minX = Math.min(from.x, to.x);
  let minY = Math.min(from.y, to.y);
  let maxX = Math.max(from.x, to.x);
  let maxY = Math.max(from.y, to.y);
  if (square) {
    const size = Math.max(maxX - minX, maxY - minY);
    maxX = minX + size;
    maxY = minY + size;
    if (to.x < from.x) minX = maxX - size;
    if (to.y < from.y) minY = maxY - size;
  }
  return { minX, minY, maxX, maxY };
}

function rectFromPoints(from: Point, to: Point): Rect {
  return createRect(
    Math.min(from.x, to.x),
    Math.min(from.y, to.y),
    Math.abs(from.x - to.x),
    Math.abs(from.y - to.y),
  );
}

function frameOfPath(path: VectorPath): Rect {
  const bounds = boundsOfPath(path);
  if (!bounds) return createRect(0, 0, 1, 1);
  return createRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

/**
 * The paint a preview wears.
 *
 * A shape being dragged out shows as an outline in the accent colour so it reads as "not committed
 * yet"; a node drag previews the layer's own paint, because that is what the artwork will look like.
 */
function previewStyleFor(layer: PathLayer | null, drag: Drag | null) {
  if (!layer || drag?.kind === 'shape' || drag === null) {
    return { fill: '#7c5cff', stroke: '#e5e7eb', strokeWidth: 1 };
  }
  return layer.vector.style;
}

function shiftedPath(
  path: VectorPath,
  refs: readonly NodeReference[],
  dx: number,
  dy: number,
): VectorPath {
  const keys = new Set(refs.map(nodeKey));
  return {
    contours: path.contours.map((contour, contourIndex) => ({
      closed: contour.closed,
      nodes: contour.nodes.map((node, nodeIndex) =>
        keys.has(`${String(contourIndex)}:${String(nodeIndex)}`)
          ? {
              point: { x: node.point.x + dx, y: node.point.y + dy },
              handleIn: node.handleIn ? { x: node.handleIn.x + dx, y: node.handleIn.y + dy } : null,
              handleOut: node.handleOut
                ? { x: node.handleOut.x + dx, y: node.handleOut.y + dy }
                : null,
            }
          : node,
      ),
    })),
  };
}

function defaultShapeName(tool: 'rectangle' | 'ellipse' | 'star'): string {
  return tool === 'rectangle' ? 'Rectangle' : tool === 'ellipse' ? 'Ellipse' : 'Star';
}

function boxStyle(rect: Rect, zoom: number): React.CSSProperties {
  return {
    left: `${String(rect.x * zoom)}px`,
    top: `${String(rect.y * zoom)}px`,
    width: `${String(rect.width * zoom)}px`,
    height: `${String(rect.height * zoom)}px`,
  };
}

function pointStyle(point: VectorPoint, zoom: number): React.CSSProperties {
  return { left: `${String(point.x * zoom)}px`, top: `${String(point.y * zoom)}px` };
}

function lineStyle(from: VectorPoint, to: VectorPoint, zoom: number): React.CSSProperties {
  const dx = (to.x - from.x) * zoom;
  const dy = (to.y - from.y) * zoom;
  return {
    left: `${String(from.x * zoom)}px`,
    top: `${String(from.y * zoom)}px`,
    width: `${String(Math.hypot(dx, dy))}px`,
    transform: `rotate(${String((Math.atan2(dy, dx) * 180) / Math.PI)}deg)`,
  };
}

function describeHover(doc: ForgeDocument, point: Point): string | null {
  const hit = hitTestVectorScene(doc.scene, point);
  if (!hit) return null;
  if (hit.type === 'path') {
    const count = hit.vector.path.contours.reduce(
      (total, contour) => total + contour.nodes.length,
      0,
    );
    return `${hit.name} — ${String(count)} nodes`;
  }
  return hit.name;
}
