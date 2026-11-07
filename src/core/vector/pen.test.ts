/**
 * The pen's draft state machine.
 *
 * These tests are written from the user's side of the tool: click, click-drag, close, abandon. The
 * behaviour that matters is what the preview shows and what committing produces, so most assertions
 * are about geometry rather than about the draft's internal fields.
 */

import { describe, expect, it } from 'vitest';

import { boundsOfPath } from './bounds';
import { toPathData } from './path-data';
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
} from './pen';

const dataOf = (path: Parameters<typeof toPathData>[0]): string => toPathData(path);

describe('placing nodes', () => {
  it('starts a draft on a click and extends it on the next one', () => {
    let draft = penStart({ x: 10, y: 10 });
    expect(penNodeCount(draft)).toBe(1);
    draft = penEndDrag(penAddNode(draft, { x: 40, y: 10 }));
    expect(penNodeCount(draft)).toBe(2);
    expect(dataOf(penPreview(draft)!)).toBe('M10 10L40 10');
  });

  it('shows a rubber band from the last node to the pointer', () => {
    let draft = penEndDrag(penAddNode(penStart({ x: 0, y: 0 }), { x: 20, y: 0 }));
    draft = penSetPointer(draft, { x: 20, y: 20 });
    expect(dataOf(penPreview(draft)!)).toBe('M0 0L20 0 20 20');
  });

  it('ignores a pointer move while a handle drag owns the pointer', () => {
    const started = penStart({ x: 0, y: 0 });
    expect(started.dragging).toBe(true);
    expect(penSetPointer(started, { x: 50, y: 50 })).toBe(started);
  });

  it('has nothing to preview until there is a segment', () => {
    expect(penPreview(EMPTY_PEN_DRAFT)).toBeNull();
    expect(penPreview(penEndDrag(penStart({ x: 5, y: 5 })))).toBeNull();
  });
});

describe('drawing curves', () => {
  it('mirrors the handles while dragging, so the node is smooth', () => {
    let draft = penStart({ x: 0, y: 0 });
    draft = penDragHandle(draft, { x: 10, y: 10 });
    const committed = penToPath(penEndDrag(penAddNode(draft, { x: 40, y: 0 })));
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const node = committed.value.contours[0]?.nodes[0];
    expect(node?.handleOut).toEqual({ x: 10, y: 10 });
    expect(node?.handleIn).toEqual({ x: -10, y: -10 });
    // One cubic segment, not a line: the handles are real geometry.
    expect(dataOf(committed.value)).toContain('C');
  });

  it('treats a drag back to the anchor as a click, leaving a corner', () => {
    const draft = penDragHandle(penStart({ x: 12, y: 12 }), { x: 12, y: 12 });
    const committed = penToPath(penEndDrag(penAddNode(draft, { x: 30, y: 12 })));
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.value.contours[0]?.nodes[0]?.handleOut).toBeNull();
    expect(dataOf(committed.value)).toBe('M12 12L30 12');
  });
});

describe('closing and finishing', () => {
  it('closes only when the click is near the first node of a real shape', () => {
    let draft = penStart({ x: 0, y: 0 });
    draft = penEndDrag(penAddNode(draft, { x: 20, y: 0 }));
    expect(penCanClose(draft, { x: 1, y: 1 })).toBe(false); // two nodes is a line, not a shape
    draft = penEndDrag(penAddNode(draft, { x: 20, y: 20 }));
    expect(penCanClose(draft, { x: 40, y: 40 })).toBe(false);
    expect(penCanClose(draft, { x: 1, y: 1 })).toBe(true);

    const closed = penClose(draft);
    expect(closed.closed).toBe(true);
    expect(dataOf(penPreview(closed)!)).toBe('M0 0L20 0 20 20Z');
    // A closed draft is not extended by another click.
    expect(penNodeCount(penAddNode(closed, { x: 5, y: 5 }))).toBe(3);
  });

  it('refuses to commit a single node, and says why', () => {
    const result = penToPath(penStart({ x: 1, y: 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation-failed');
      expect(result.error.detail).toContain('Escape');
    }
  });

  it('produces a path whose bounds are the drawn shape', () => {
    let draft = penStart({ x: 10, y: 20 });
    draft = penEndDrag(penAddNode(draft, { x: 50, y: 20 }));
    draft = penEndDrag(penAddNode(draft, { x: 50, y: 60 }));
    const path = penToPath(penClose(draft));
    expect(path.ok).toBe(true);
    if (!path.ok) return;
    expect(boundsOfPath(path.value)).toEqual({ minX: 10, minY: 20, maxX: 50, maxY: 60 });
  });
});
