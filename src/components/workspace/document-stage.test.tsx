import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DocumentStage } from './document-stage';
import type { SceneImages } from './use-scene-images';
import { createDocument } from '../../core/documents/factories';
import { EMPTY_SELECTION, type Selection } from '../../core/editor/selection';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { brand } from '../../core/types/brand';
import type { Canvas, ForgeDocument } from '../../core/documents/types';

/**
 * Document stage zoom.
 *
 * The defect these tests pin down: the zoom control offered 25–200%, but the preview was capped by a
 * maximum-width rule and by a portrait-specific width, so selecting 100% or 200% changed nothing for
 * a vertical document. The assertions here are about rendered geometry — the canvas box must have the
 * exact pixel size the zoom implies, the scroll area must be able to reach it, and guides must keep
 * working at every level.
 */

const landscape: Canvas = {
  width: 1600,
  height: 900,
  unit: 'px',
  dpi: 96,
  background: '#0f1115',
  transparent: false,
};
const portrait: Canvas = { ...landscape, width: 1080, height: 1920 };

function documentWith(canvas: Canvas): ForgeDocument {
  const created = createDocument({
    title: 'Zoom fixture',
    studioId: 'design',
    documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
    canvas,
  });
  if (!created.ok) throw new Error('fixture document should be valid');
  return created.value;
}

function canvasBox(): HTMLElement {
  return screen.getByTestId('document-canvas');
}

/** Guides and snapping are workspace preferences, so the stage takes them as props. */
function renderStage(canvas: Canvas, services?: TestForgeServices): void {
  const doc = documentWith(canvas);
  const forge = services ?? createTestServices();
  const images: SceneImages = {
    resolver: () => ({ error: 'this fixture has no graphics' }),
    status: new Map(),
    loading: false,
    errors: [],
    retry: () => {
      /* nothing to retry in this fixture */
    },
  };

  function Harness() {
    const [guides, setGuides] = useState(true);
    const [snapping, setSnapping] = useState(true);
    const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
    return (
      <DocumentStage
        api={{
          doc,
          commit: () => Promise.resolve(true),
          run: () => Promise.resolve(true),
          undo: () => {
            /* the stage never commits in these tests */
          },
          redo: () => {
            /* the stage never commits in these tests */
          },
        }}
        selection={selection}
        onSelectionChange={setSelection}
        images={images}
        snapping={snapping}
        onSnappingChange={setSnapping}
        showGuides={guides}
        onGuidesChange={setGuides}
      />
    );
  }

  render(
    <ForgeProvider services={forge}>
      <Harness />
    </ForgeProvider>,
  );
}

/** Makes the measured viewport deterministic; jsdom reports zero for every element by default. */
function stubViewport(width: number, height: number): () => void {
  const originalWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  const originalHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get: () => height,
  });
  return () => {
    if (originalWidth) Object.defineProperty(Element.prototype, 'clientWidth', originalWidth);
    if (originalHeight) Object.defineProperty(Element.prototype, 'clientHeight', originalHeight);
  };
}

let restoreViewport: (() => void) | null = null;

afterEach(() => {
  restoreViewport?.();
  restoreViewport = null;
});

/** Guide marks are DOM spans; the artwork itself is painted into the canvas bitmap. */
function guideMarks(): HTMLElement[] {
  return [...screen.getByTestId('artboard').querySelectorAll<HTMLElement>('span[data-guide]')];
}

async function selectZoom(option: string): Promise<void> {
  await userEvent.selectOptions(screen.getByLabelText('Zoom level'), option);
}

describe('DocumentStage zoom', () => {
  it('renders the declared size before the scroll area has been measured', () => {
    renderStage(portrait);

    expect(canvasBox().style.width).toBe('1080px');
    expect(canvasBox().style.height).toBe('1920px');
    expect(screen.getByTestId('zoom-readout')).toHaveTextContent('declared size');
  });

  it('renders each explicit level at exactly that multiple of the declared pixel size', async () => {
    renderStage(landscape);

    await selectZoom('100');
    expect(canvasBox().style.width).toBe('1600px');
    expect(canvasBox().style.height).toBe('900px');

    await selectZoom('50');
    expect(canvasBox().style.width).toBe('800px');
    expect(canvasBox().style.height).toBe('450px');

    await selectZoom('200');
    expect(canvasBox().style.width).toBe('3200px');
    expect(canvasBox().style.height).toBe('1800px');
  });

  it('scales a portrait canvas by its own width instead of a fixed cap', async () => {
    renderStage(portrait);

    await selectZoom('100');
    expect(canvasBox().style.width).toBe('1080px');
    expect(canvasBox().style.height).toBe('1920px');

    await selectZoom('200');
    expect(canvasBox().style.width).toBe('2160px');
    expect(canvasBox().style.height).toBe('3840px');
  });

  it('never caps the canvas with a maximum-width rule, so large zoom levels stay reachable', async () => {
    renderStage(landscape);
    await selectZoom('200');

    const box = canvasBox();
    expect(box.className).not.toMatch(/max-w-|max-h-/);
    // The frame that wraps it hugs the canvas rather than stretching or clipping it.
    const frame = screen.getByTestId('artboard');
    expect(frame.style.width).toBe('3200px');
    expect(frame.style.height).toBe('1800px');
    // ...and the pane scrolls, which is how the rest of an oversized canvas is reached.
    const scrollArea = screen.getByTestId('stage-scroll-area');
    expect(scrollArea.className).toContain('overflow-auto');
    expect(scrollArea).toContainElement(box);
  });

  it('fits the canvas into the measured scroll area', () => {
    restoreViewport = stubViewport(900, 600);
    renderStage(portrait);

    // 900 - 32 padding = 868 usable width; 600 - 32 = 568 usable height; the height binds, and the
    // width follows from the document's own aspect ratio (1080 × 1920 at 568px tall).
    expect(canvasBox().style.width).toBe('320px');
    expect(canvasBox().style.height).toBe('568px');
    expect(screen.getByTestId('zoom-readout')).toHaveTextContent('Fit · 30%');
  });

  it('never magnifies past 100% when fitting a small canvas into a large pane', () => {
    restoreViewport = stubViewport(2000, 1600);
    renderStage(landscape);

    expect(canvasBox().style.width).toBe('1600px');
    expect(screen.getByTestId('zoom-readout')).toHaveTextContent('Fit · 100%');
  });

  it('stays usable on a narrow screen, where the width is what binds', () => {
    restoreViewport = stubViewport(360, 640);
    renderStage(portrait);

    const box = canvasBox();
    // 360 - 32 padding = 328 usable width; the portrait canvas fits the width, not the height.
    expect(box.style.width).toBe('328px');
    expect(Number.parseInt(box.style.height, 10)).toBeLessThanOrEqual(608);
    expect(screen.getByTestId('zoom-readout')).toHaveTextContent('Fit · 30%');
  });

  it('steps out of `fit` relative to the effective percentage', async () => {
    restoreViewport = stubViewport(900, 600);
    renderStage(portrait);

    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });

    // Fit is 30%, so zooming in lands on 50% and zooming out lands on 25%.
    await userEvent.click(zoomIn);
    expect(screen.getByLabelText('Zoom level')).toHaveValue('50');
    expect(screen.getByTestId('zoom-readout')).toHaveTextContent('50%');

    await selectZoom('fit');
    await userEvent.click(zoomOut);
    expect(screen.getByLabelText('Zoom level')).toHaveValue('25');
  });

  it('keeps the guides toggle working at every zoom level', async () => {
    renderStage(landscape);

    for (const level of ['25', '200']) {
      await selectZoom(level);
      const visible = guideMarks().length;
      expect(visible, `${level}% with guides`).toBeGreaterThan(0);

      await userEvent.click(screen.getByRole('button', { name: 'Hide guides' }));
      expect(guideMarks()).toHaveLength(0);

      await userEvent.click(screen.getByRole('button', { name: 'Show guides' }));
      expect(guideMarks()).toHaveLength(visible);
    }
  });

  it('draws guides in CSS pixels rather than in the bitmap, so they stay one pixel wide', async () => {
    renderStage(landscape);

    await selectZoom('25');
    const atQuarter = guideMarks().map((mark) => mark.getAttribute('data-guide'));
    await selectZoom('200');
    const atDouble = guideMarks().map((mark) => mark.getAttribute('data-guide'));

    expect(atQuarter).toEqual(atDouble);
    expect(atQuarter).toContain('safe');
    expect(atQuarter).toContain('centre-x');

    // The centre line follows the zoom: 1600 / 2 document pixels x 2 = 1600 CSS pixels.
    const centre = guideMarks().find((mark) => mark.getAttribute('data-guide') === 'centre-x');
    expect(centre?.style.left).toBe('1600px');
    // ...and it is never painted into the exported/artboard bitmap.
    expect(documentWith(landscape).scene.layers).toHaveLength(0);
  });

  it('exposes snapping as a toggle with a pressed state', async () => {
    renderStage(landscape);

    const snapping = screen.getByRole('button', { name: /snapping on/i });
    expect(snapping).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(snapping);
    expect(screen.getByRole('button', { name: /snapping off/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('labels the artboard for assistive technology', () => {
    renderStage(landscape);

    expect(
      screen.getByRole('img', { name: /artboard preview: 0 layers, 1600 by 900 pixels/i }),
    ).toBeInTheDocument();
  });

  it('says that the canvas is larger than the pane rather than pretending it fits', async () => {
    restoreViewport = stubViewport(900, 600);
    renderStage(landscape);
    await selectZoom('200');

    expect(screen.getByTestId('zoom-clipped-note')).toHaveTextContent(/scroll to reach it all/i);
  });

  it('states how a percentage maps to the screen, so 100% is not oversold', () => {
    renderStage(landscape);

    expect(screen.getByLabelText('Zoom level')).toHaveAttribute(
      'title',
      expect.stringContaining('device pixel') as unknown as string,
    );
    expect(
      screen.getByText(/one CSS pixel is drawn with more than one device pixel/i),
    ).toBeInTheDocument();
  });
});
