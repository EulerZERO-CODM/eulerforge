'use client';

import { useEffect, useRef, useState } from 'react';

import type { MotionEasing } from '../../core/documents/payload';
import {
  applyEasing,
  cubicEasing,
  easingPoints,
  type BezierPoints,
} from '../../core/motion/easing';

const DEFAULT_POINTS: BezierPoints = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

const WIDTH = 240;
const HEIGHT = 160;
const PADDING = 16;

/** Pointer capture is absent in jsdom; a canvas without it still receives moves over itself. */
function capturePointer(target: HTMLCanvasElement, pointerId: number): void {
  const capture = (target as { setPointerCapture?: (id: number) => void }).setPointerCapture;
  capture?.call(target, pointerId);
}

/**
 * The graph editor.
 *
 * It draws the curve the evaluator will actually solve, and drags the two cubic control points in
 * the same normalised space the payload stores. Preset easings are shown but not editable — dragging
 * one converts it to a custom curve, which is what a person expects when they move a handle.
 *
 * The same values are editable as four number inputs underneath, so the control is usable without a
 * pointer and its exact values are readable.
 */
export function EasingCurveEditor({
  easing,
  onChange,
}: {
  readonly easing: MotionEasing;
  /** Called once per completed drag (pointer up), never per move. */
  readonly onChange: (easing: MotionEasing) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<'one' | 'two' | null>(null);
  /**
   * In-flight drag points, tagged with the easing they were derived from.
   *
   * Deriving rather than copying into state in an effect means selecting another keyframe shows its
   * own curve immediately, and a drag that is not in progress can never shadow a committed value.
   */
  const [draft, setDraft] = useState<{ source: MotionEasing; points: BezierPoints } | null>(null);
  const points: BezierPoints =
    draft && draft.source === easing ? draft.points : (easingPoints(easing) ?? DEFAULT_POINTS);

  function moveHandle(next: BezierPoints): void {
    setDraft({ source: easing, points: next });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    const innerWidth = WIDTH - PADDING * 2;
    const innerHeight = HEIGHT - PADDING * 2;
    const toX = (x: number): number => PADDING + x * innerWidth;
    const toY = (y: number): number => PADDING + (1 - y) * innerHeight;

    context.strokeStyle = 'rgba(255,255,255,0.12)';
    context.lineWidth = 1;
    for (let step = 0; step <= 4; step += 1) {
      const x = PADDING + (step / 4) * innerWidth;
      const y = PADDING + (step / 4) * innerHeight;
      context.beginPath();
      context.moveTo(x, PADDING);
      context.lineTo(x, HEIGHT - PADDING);
      context.stroke();
      context.beginPath();
      context.moveTo(PADDING, y);
      context.lineTo(WIDTH - PADDING, y);
      context.stroke();
    }

    // Control polygon, so the handles are obviously related to the curve.
    context.strokeStyle = 'rgba(255,180,90,0.45)';
    context.beginPath();
    context.moveTo(toX(0), toY(0));
    context.lineTo(toX(points.x1), toY(points.y1));
    context.moveTo(toX(1), toY(1));
    context.lineTo(toX(points.x2), toY(points.y2));
    context.stroke();

    context.strokeStyle = '#ffb45a';
    context.lineWidth = 2;
    context.beginPath();
    for (let step = 0; step <= 120; step += 1) {
      const progress = step / 120;
      const value = applyEasing({ kind: 'cubic', ...points }, progress);
      const x = toX(progress);
      const y = toY(Math.min(1, Math.max(0, value)));
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();

    for (const [index, point] of [
      { x: points.x1, y: points.y1 },
      { x: points.x2, y: points.y2 },
    ].entries()) {
      context.beginPath();
      context.fillStyle = index === 0 ? '#ffb45a' : '#f4f4f5';
      context.arc(toX(point.x), toY(point.y), 4, 0, Math.PI * 2);
      context.fill();
    }
  }, [points]);

  function pointerToPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const x = (event.clientX - rect.left) / rect.width;
    const y = 1 - (event.clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(3, Math.max(-2, y)) };
  }

  function applyDrag(event: { clientX: number; clientY: number }): void {
    if (!dragging.current) return;
    const point = pointerToPoint(event);
    moveHandle(
      dragging.current === 'one'
        ? { ...points, x1: point.x, y1: point.y }
        : { ...points, x2: point.x, y2: point.y },
    );
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        data-testid="easing-curve"
        role="img"
        aria-label={`Easing curve from (0, 0) through control points (${points.x1.toFixed(2)}, ${points.y1.toFixed(2)}) and (${points.x2.toFixed(2)}, ${points.y2.toFixed(2)}) to (1, 1).`}
        className="bg-ink-950 border-line w-full cursor-crosshair rounded-sm border"
        style={{ aspectRatio: `${String(WIDTH)} / ${String(HEIGHT)}` }}
        onPointerDown={(event) => {
          const point = pointerToPoint(event);
          const distanceOne = Math.hypot(point.x - points.x1, point.y - points.y1);
          const distanceTwo = Math.hypot(point.x - points.x2, point.y - points.y2);
          dragging.current = distanceOne <= distanceTwo ? 'one' : 'two';
          capturePointer(event.currentTarget, event.pointerId);
          applyDrag(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) applyDrag(event);
        }}
        onPointerUp={() => {
          dragging.current = null;
          onChange(cubicEasing(points));
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
      />
      <div className="grid grid-cols-4 gap-1.5">
        {(
          [
            ['x1', points.x1],
            ['y1', points.y1],
            ['x2', points.x2],
            ['y2', points.y2],
          ] as const
        ).map(([key, value]) => (
          <label key={key} className="block">
            <span className="text-fg-subtle text-[10px] uppercase">{key}</span>
            <input
              type="number"
              step={0.01}
              aria-label={`Easing ${key}`}
              value={Number(value.toFixed(2))}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                moveHandle({ ...points, [key]: next });
              }}
              onBlur={() => {
                onChange(cubicEasing(points));
              }}
              className="border-line bg-ink-950 forge-numeric focus-visible:outline-accent w-full rounded-sm border px-1.5 py-1 text-xs focus-visible:outline-2"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
