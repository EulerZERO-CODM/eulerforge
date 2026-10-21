import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ExportPanel } from './export-panel';
import type { SceneImages } from './use-scene-images';
import type { WorkspaceApi } from './workspace-api';
import { documentFixture, imageLayer, sceneOf } from '../../testing/layers';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';

const HREF = '/forge-assets/aurora-mesh.svg';

function panelApi(): WorkspaceApi {
  return {
    doc: documentFixture({
      title: 'Export check',
      scene: sceneOf(imageLayer('lyr-graphic', { href: HREF })),
    }),
    commit: async () => true,
    run: async () => true,
    undo: () => undefined,
    redo: () => undefined,
  };
}

function images(overrides: Partial<SceneImages> = {}): SceneImages {
  return {
    resolver: () => ({ error: 'not loaded' }),
    status: new Map(),
    loading: false,
    errors: [],
    pending: [],
    retry: () => undefined,
    ...overrides,
  };
}

/**
 * The "Every graphic can be drawn" readiness entry.
 *
 * The check is read through its own list item rather than through the panel summary, because the
 * summary also counts the rasteriser check, and jsdom has no canvas 2D context.
 */
function graphicsCheck(): HTMLElement {
  const label = screen.getByText('Every graphic can be drawn');
  const item = label.closest('li');
  if (!item) throw new Error('the graphics check should be listed');
  return item as HTMLElement;
}

async function renderPanel(sceneImages: SceneImages) {
  render(
    <ForgeProvider services={createTestServices()}>
      <ExportPanel api={panelApi()} images={sceneImages} />
    </ForgeProvider>,
  );
  // PNG is the first raster format; the project file does not draw the scene at all.
  await userEvent.selectOptions(screen.getByLabelText('Format'), 'png');
}

describe('ExportPanel readiness', () => {
  it('blocks the export while a graphic is still loading', async () => {
    await renderPanel(images({ loading: true, pending: [HREF] }));

    // The renderer refuses to draw a document with an unresolved graphic, so a checklist that
    // said "ready" here would be a promise the export cannot keep.
    expect(graphicsCheck()).toHaveTextContent('Status: blocked');
    expect(graphicsCheck()).toHaveTextContent('is still loading');
  });

  it('blocks the export when a graphic could not be loaded', async () => {
    await renderPanel(images({ errors: [HREF] }));

    expect(graphicsCheck()).toHaveTextContent('Status: blocked');
    expect(graphicsCheck()).toHaveTextContent('could not be loaded');
  });

  it('lets the export through once every graphic has loaded', async () => {
    await renderPanel(images());

    expect(graphicsCheck()).toHaveTextContent('Status: pass');
  });
});
