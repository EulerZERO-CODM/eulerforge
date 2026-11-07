'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import {
  MAX_MASK_POINTS,
  maskHasCoverage,
  type PhotoPoint,
  type PhotoPayload,
} from '../../core/documents/payload';
import { addMaskStrokeCommand, addRetouchStrokeCommand } from '../../core/photo/commands';
import { rasteriseMask, sourcePixelsOf } from '../../lib/browser/photo-engine';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';
import type { PhotoRenderState } from './use-photo-preview';
import type { PhotoTool } from './photo-tools';

const DRAFT_TINT = 'rgba(250, 204, 21, 0.85)';

/** Shortest pointer move, in normalised units, that adds a point to the stroke being painted. */
const MIN_POINT_DISTANCE = 0.004;

type DraftStroke = {
  readonly tool: PhotoTool;
  readonly points: readonly PhotoPoint[];
  readonly radius: number;
  readonly hardness: number;
};

function isPaintTool(tool: PhotoTool): boolean {
  return (
    tool === 'brush' || tool === 'lasso' || tool === 'erase' || tool === 'clone' || tool === 'heal'
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The photo preview, and the surface the mask and retouch tools paint on.
 *
 * Three stacked canvases: the rendered pixels (replaced whenever the document changes), a mask
 * overlay that is rasterised only when the mask itself changes, and a transparent interaction layer
 * that follows the pointer and hosts the keyboard painting focus. Separating them is what lets the
 * brush cursor and the in-progress stroke redraw at pointer speed without re-running the pixel
 * pipeline.
 */
/**
 * Pointer capture keeps a paint stroke alive when the pointer leaves the canvas.
 *
 * jsdom has no implementation at all and a canvas without it still receives moves over its own
 * area, so the call is optional rather than assumed.
 */
function capturePointer(target: HTMLCanvasElement, pointerId: number): void {
  const capture = (target as { setPointerCapture?: (id: number) => void }).setPointerCapture;
  capture?.call(target, pointerId);
}

export function PhotoStage({
  api,
  payload,
  render,
  tool,
  radius,
  hardness,
  maskVisible,
  onMaskVisibleChange,
  showOriginal,
  onShowOriginalChange,
  samplePoint,
  onSamplePointChange,
}: {
  readonly api: WorkspaceApi;
  readonly payload: PhotoPayload;
  readonly render: PhotoRenderState;
  readonly tool: PhotoTool;
  readonly radius: number;
  readonly hardness: number;
  readonly maskVisible: boolean;
  readonly onMaskVisibleChange: (value: boolean) => void;
  readonly showOriginal: boolean;
  readonly onShowOriginalChange: (value: boolean) => void;
  readonly samplePoint: PhotoPoint | null;
  readonly onSamplePointChange: (point: PhotoPoint | null) => void;
}) {
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const interactionRef = useRef<HTMLCanvasElement | null>(null);
  const [draft, setDraft] = useState<DraftStroke | null>(null);
  const [cursor, setCursor] = useState<PhotoPoint | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const dragging = useRef(false);

  const size = render.status === 'ready' ? render : null;
  const paintEnabled = isPaintTool(tool) && payload.source !== null;

  // Copy the rendered pixels into the visible canvas. The renderer's canvas is not handed to React:
  // it is replaced on every render, and this keeps the DOM node stable (focus, scroll, pointer focus
  // ring) while the pixels change underneath.
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !size) return;
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, size.width, size.height);
    context.drawImage(size.canvas, 0, 0);
  }, [size]);

  // Static mask overlay: re-rasterising the strokes is the expensive part, so it happens when the
  // mask changes, not on every pointer move. Range selections need the source pixels for the same
  // reason the renderer does: they describe the photograph, not the adjusted preview.
  useEffect(() => {
    const canvas = maskRef.current;
    if (!canvas || !size) return;
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, size.width, size.height);
    const mask = payload.mask;
    if (!maskVisible || !maskHasCoverage(mask) || !mask) return;
    const paintOnly = (mask.ranges ?? []).length === 0;
    const source = paintOnly ? null : sourcePixelsOf(size.source, size.width, size.height);
    if (!paintOnly && !source) return;
    const strength = rasteriseMask(mask, size.width, size.height, source);
    const image = context.createImageData(size.width, size.height);
    for (let index = 0; index < strength.length; index += 1) {
      const value = strength[index] ?? 0;
      if (value === 0) continue;
      image.data[index * 4] = 244;
      image.data[index * 4 + 1] = 114;
      image.data[index * 4 + 2] = 182;
      image.data[index * 4 + 3] = Math.round((value / 255) * 140);
    }
    context.putImageData(image, 0, 0);
  }, [size, payload.mask, maskVisible]);

  // Interaction overlay: brush ring, the stroke being painted and the clone source marker.
  useEffect(() => {
    const canvas = interactionRef.current;
    if (!canvas || !size) return;
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, size.width, size.height);

    const shortest = Math.min(size.width, size.height);

    if (draft && draft.points.length > 0) {
      context.strokeStyle = DRAFT_TINT;
      context.fillStyle = 'rgba(250, 204, 21, 0.18)';
      context.lineWidth = Math.max(1, draft.radius * 2 * shortest);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      for (const [index, point] of draft.points.entries()) {
        const x = point.x * size.width;
        const y = point.y * size.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      if (draft.points.length === 1) {
        const only = draft.points[0];
        if (only) {
          context.arc(
            only.x * size.width,
            only.y * size.height,
            Math.max(1, draft.radius * shortest),
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      } else if (draft.tool === 'lasso') {
        context.closePath();
        context.stroke();
      } else {
        context.stroke();
      }
    }

    if (cursor && paintEnabled) {
      context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(
        cursor.x * size.width,
        cursor.y * size.height,
        Math.max(2, radius * shortest),
        0,
        Math.PI * 2,
      );
      context.stroke();
    }

    if (samplePoint && (tool === 'clone' || tool === 'heal')) {
      const x = samplePoint.x * size.width;
      const y = samplePoint.y * size.height;
      const arm = Math.max(4, shortest * 0.02);
      context.strokeStyle = 'rgba(94, 234, 212, 0.95)';
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(x - arm, y);
      context.lineTo(x + arm, y);
      context.moveTo(x, y - arm);
      context.lineTo(x, y + arm);
      context.stroke();
    }
  }, [size, draft, cursor, samplePoint, paintEnabled, radius, tool]);

  function pointFrom(event: { clientX: number; clientY: number }): PhotoPoint | null {
    const canvas = interactionRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    // jsdom lays every element out at the origin with a zero-sized box; the intrinsic size is the
    // same coordinate space the browser uses for a fit-to-width canvas, so tests can address real
    // normalised positions. In a browser the CSS box is authoritative.
    const width = rect.width || canvas.width;
    const height = rect.height || canvas.height;
    if (width === 0 || height === 0) return null;
    return {
      x: clamp01((event.clientX - rect.left) / width),
      y: clamp01((event.clientY - rect.top) / height),
    };
  }

  function commit(draftStroke: DraftStroke): void {
    if (draftStroke.points.length === 0) return;
    if (draftStroke.tool === 'clone' || draftStroke.tool === 'heal') {
      const start = draftStroke.points[0];
      const offset =
        samplePoint && start
          ? { offsetX: samplePoint.x - start.x, offsetY: samplePoint.y - start.y }
          : { offsetX: -0.1, offsetY: -0.1 };
      void api
        .run(
          addRetouchStrokeCommand(api.doc, {
            mode: draftStroke.tool,
            points: draftStroke.points,
            radius: draftStroke.radius,
            hardness: draftStroke.hardness,
            ...offset,
          }),
        )
        .then((applied) => {
          if (applied) {
            setStatus(
              draftStroke.tool === 'clone'
                ? 'Clone stroke applied — undo removes it in one step.'
                : 'Heal stroke applied — undo removes it in one step.',
            );
          }
        });
      return;
    }
    void api
      .run(
        addMaskStrokeCommand(api.doc, {
          points: draftStroke.points,
          radius: draftStroke.radius,
          hardness: draftStroke.hardness,
          erase: draftStroke.tool === 'erase',
          fill: draftStroke.tool === 'lasso',
        }),
      )
      .then((applied) => {
        if (applied) setStatus(`Mask stroke added (${String(draftStroke.points.length)} points).`);
      });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!paintEnabled) return;
    const point = pointFrom(event);
    if (!point) return;
    event.preventDefault();
    // Alt-click samples a clone source. It is documented on the tool button and in the hint line.
    if ((tool === 'clone' || tool === 'heal') && event.altKey) {
      onSamplePointChange(point);
      setStatus('Clone source set. Paint to copy from it.');
      return;
    }
    dragging.current = true;
    capturePointer(event.currentTarget, event.pointerId);
    setCursor(point);
    setDraft({ tool, points: [point], radius, hardness });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!paintEnabled) return;
    const point = pointFrom(event);
    if (!point) return;
    setCursor(point);
    if (!dragging.current) return;
    setDraft((current) => {
      if (!current) return current;
      if (current.points.length >= MAX_MASK_POINTS) return current;
      const previous = current.points[current.points.length - 1];
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < MIN_POINT_DISTANCE) {
        return current;
      }
      return { ...current, points: [...current.points, point] };
    });
  }

  function handlePointerUp(): void {
    if (!dragging.current) return;
    dragging.current = false;
    setDraft((current) => {
      if (current) commit(current);
      return null;
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>): void {
    if (!paintEnabled) return;
    if (event.key === 'Escape') {
      setDraft(null);
      setStatus('Stroke cancelled.');
      return;
    }
    if (event.key === 'Enter') {
      if (draft) {
        const finished = draft;
        setDraft(null);
        commit(finished);
      }
      return;
    }
    // `user-event` reports the space bar as 'Space' in some versions and ' ' in others; a browser
    // reports ' '. Accepting both keeps the shortcut working for keyboard and assistive input alike.
    if (event.key === ' ' || event.key === 'Space') {
      event.preventDefault();
      // The dab lands where the brush cursor is: after moving the cursor with the arrow keys the
      // next Space must paint there, not back at the previous dab.
      const position = cursor ?? draft?.points[draft.points.length - 1] ?? { x: 0.5, y: 0.5 };
      setDraft((current) =>
        current
          ? { ...current, points: [...current.points, position] }
          : { tool, points: [position], radius, hardness },
      );
      setStatus(`Dab at ${Math.round(position.x * 100)}%, ${Math.round(position.y * 100)}%.`);
      return;
    }
    const step = event.shiftKey ? 0.1 : 0.02;
    const position = cursor ?? draft?.points[draft.points.length - 1] ?? { x: 0.5, y: 0.5 };
    let next: PhotoPoint | null = null;
    if (event.key === 'ArrowLeft') next = { x: clamp01(position.x - step), y: position.y };
    if (event.key === 'ArrowRight') next = { x: clamp01(position.x + step), y: position.y };
    if (event.key === 'ArrowUp') next = { x: position.x, y: clamp01(position.y - step) };
    if (event.key === 'ArrowDown') next = { x: position.x, y: clamp01(position.y + step) };
    if (next) {
      event.preventDefault();
      setCursor(next);
    }
  }

  if (render.status === 'idle' || (render.status === 'error' && payload.source === null)) {
    return (
      <div className="border-line bg-surface/40 flex min-h-72 items-center justify-center rounded-md border border-dashed p-6">
        <p className="text-fg-muted max-w-sm text-center text-sm">
          Import a PNG, JPEG or WebP to start editing. The working copy is stored inside the
          project, so reopening it does not depend on the original file.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="photo-stage-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="photo-stage-heading" className="text-fg text-sm font-semibold">
            Preview
          </h2>
          <p className="text-fg-subtle text-xs">
            {payload.source
              ? `${payload.source.width} × ${payload.source.height} working copy${
                  payload.source.originalWidth !== payload.source.width ||
                  payload.source.originalHeight !== payload.source.height
                    ? ` · imported at ${payload.source.originalWidth} × ${payload.source.originalHeight}`
                    : ''
                }`
              : 'No image'}
            {size
              ? ` · preview ${size.width} × ${size.height} · ${size.engine === 'webgl2' ? 'WebGL2' : 'Canvas 2D'} · ${Math.round(size.durationMs)} ms`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={showOriginal ? 'primary' : 'outline'}
            aria-pressed={showOriginal}
            disabled={!payload.source}
            onClick={() => {
              onShowOriginalChange(!showOriginal);
            }}
          >
            {showOriginal ? 'Showing original' : 'Show original'}
          </Button>
          <Button
            size="sm"
            variant={maskVisible ? 'secondary' : 'outline'}
            aria-pressed={maskVisible}
            onClick={() => {
              // Overlay only: the mask itself is document state and is never toggled off by display.
              setStatus(maskVisible ? 'Mask overlay hidden.' : 'Mask overlay shown.');
              onMaskVisibleChange(!maskVisible);
            }}
          >
            Mask overlay
          </Button>
        </div>
      </div>

      {showOriginal ? (
        <InlineNote tone="tip" title="Original image">
          <p>
            The stack, mask and retouch are skipped here. Nothing is committed by looking at the
            original.
          </p>
        </InlineNote>
      ) : null}

      {render.status === 'error' ? (
        <InlineNote tone="danger" title="The preview could not be rendered">
          <p>{render.message}</p>
          {render.detail ? <p className="forge-numeric text-2xs">{render.detail}</p> : null}
        </InlineNote>
      ) : null}

      {render.status === 'ready' && render.fallbackReason ? (
        <InlineNote tone="warning" title="Fell back to the CPU renderer">
          <p>{render.fallbackReason}</p>
          <p className="text-fg-subtle text-xs">
            The pixels are still the document’s pixels: the Canvas 2D renderer runs the same
            pipeline that the GPU shader mirrors, and export uses it too.
          </p>
        </InlineNote>
      ) : null}

      <div
        className="border-line bg-ink-950 relative overflow-hidden rounded-md border"
        style={{
          aspectRatio: size ? `${String(size.width)} / ${String(size.height)}` : '4 / 3',
        }}
      >
        <canvas
          ref={baseRef}
          data-testid="photo-preview"
          aria-label={payload.source ? `Photo preview: ${payload.source.name}` : 'Photo preview'}
          className="absolute inset-0 block h-full w-full"
        />
        <canvas
          ref={maskRef}
          data-testid="photo-mask-overlay"
          aria-hidden
          className="pointer-events-none absolute inset-0 block h-full w-full"
        />
        <canvas
          ref={interactionRef}
          data-testid="photo-interaction"
          role={paintEnabled ? 'application' : 'img'}
          tabIndex={paintEnabled ? 0 : -1}
          aria-label={
            paintEnabled
              ? `${tool === 'clone' ? 'Clone' : tool === 'heal' ? 'Heal' : tool === 'lasso' ? 'Lasso' : tool === 'erase' ? 'Erase' : 'Brush'} painting surface. Arrow keys move the brush, Space adds a dab, Enter finishes the stroke, Escape cancels.${tool === 'clone' || tool === 'heal' ? ' Alt-click sets the clone source.' : ''}`
              : 'Photo interaction overlay'
          }
          className={cn(
            'absolute inset-0 block h-full w-full touch-none',
            paintEnabled ? 'cursor-crosshair' : 'cursor-default',
            'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => {
            setCursor(null);
          }}
          onKeyDown={handleKeyDown}
        />
        {render.status === 'loading' && render.canvas === null ? (
          <p className="text-fg-subtle absolute inset-0 flex items-center justify-center text-sm">
            Rendering preview…
          </p>
        ) : null}
      </div>

      <div
        aria-live="polite"
        data-testid="photo-status"
        className="border-line-subtle text-2xs text-fg-subtle rounded-sm border px-3 py-2"
      >
        {status ??
          (paintEnabled
            ? 'Paint on the preview with the pointer, or focus it and use the arrow keys with Space and Enter.'
            : 'Choose Mask or Retouch to paint. Show original compares against the imported file.')}
      </div>
    </section>
  );
}
