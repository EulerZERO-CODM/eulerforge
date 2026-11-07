/**
 * "Carry onward", driven the way a person uses it.
 *
 * The interesting behaviour is not that a button opens a dialog — it is what the dialog promises
 * before the work moves, and what the created project actually contains afterwards. So these tests
 * read the two lists the dialog shows, press the action, and then look at the document that landed
 * in the store: its layers, its payload, its canvas and the lineage link back to the source.
 *
 * The photo path is the one place a browser is genuinely required — rasterising an artboard — so
 * that module is replaced at its own boundary, exactly as the account tests replace the network.
 * Everything above the boundary (the input built, the document created, the lineage recorded) is
 * the real code.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HandoffPanel } from './handoff-panel';
import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../../core/documents/factories';
import type { ForgeDocument } from '../../core/documents/types';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { brand } from '../../core/types/brand';
import { ok } from '../../core/result';
import type * as Handoff from '../../lib/browser/handoff';

const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/workspace/doc-source',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../lib/browser/handoff', async () => {
  const actual = await vi.importActual<typeof Handoff>('../../lib/browser/handoff');
  return { ...actual, rasteriseArtboardForPhoto: vi.fn() };
});

const { rasteriseArtboardForPhoto } = await import('../../lib/browser/handoff');

const PHOTO_SOURCE = {
  name: 'Field audit.png',
  href: 'data:image/png;base64,AAAA',
  width: 1080,
  height: 1350,
  mimeType: 'image/png' as const,
  originalWidth: 1080,
  originalHeight: 1350,
};

function design(): ForgeDocument {
  const created = createDocument(
    {
      title: 'Field audit',
      studioId: 'design',
      documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
      canvas: { ...DEFAULT_CANVAS, width: 1080, height: 1350 },
      guides: DEFAULT_GUIDES,
      palette: ['#ff8a3d'],
      scene: {
        layers: [
          {
            id: brand<'LayerId'>('lyr-title'),
            name: 'Headline',
            visible: true,
            locked: false,
            opacity: 1,
            frame: { x: 40, y: 40, width: 400, height: 90 },
            type: 'text',
            text: {
              content: 'Field audit',
              fontStackId: 'sans',
              fontSize: 48,
              fontWeight: 600,
              lineHeight: 1.2,
              letterSpacing: 0,
              align: 'left',
              color: '#ffffff',
            },
          },
        ],
      },
    },
    { generateId: () => 'doc-source' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function renderPanel(services: TestForgeServices, source: ForgeDocument) {
  render(
    <ForgeProvider services={services}>
      <HandoffPanel source={source} resolveImage={() => undefined} />
    </ForgeProvider>,
  );
}

describe('carrying work onward', () => {
  let services: TestForgeServices;

  beforeEach(() => {
    services = createTestServices();
    push.mockClear();
    vi.mocked(rasteriseArtboardForPhoto).mockReset();
    vi.mocked(rasteriseArtboardForPhoto).mockResolvedValue(ok(PHOTO_SOURCE));
  });

  it('is offered for a design and says what the destination costs', async () => {
    const user = userEvent.setup();
    renderPanel(services, design());

    await user.click(screen.getByRole('button', { name: 'Carry onward' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Animate it in Motion Studio')).toBeInTheDocument();
    expect(within(dialog).getByText('Retouch it in Photo Studio')).toBeInTheDocument();
    // The flattening is the surprising part, so it is on screen before the button is pressed.
    expect(within(dialog).getByText(/layers cannot be recovered/i)).toBeInTheDocument();
    // And the honest note that the original is untouched.
    expect(within(dialog).getByText(/stays exactly as it is/i)).toBeInTheDocument();
  });

  it('is not offered for a document no studio can take', () => {
    const photo = createDocument(
      {
        title: 'Portrait',
        studioId: 'photo',
        documentTypeId: brand<'DocumentTypeId'>('photo.image'),
        canvas: DEFAULT_CANVAS,
      },
      { generateId: () => 'doc-photo' },
    );
    if (!photo.ok) throw new Error(photo.error.message);

    renderPanel(services, photo.value);

    expect(screen.queryByRole('button', { name: 'Carry onward' })).toBeNull();
  });

  it('creates a motion project that keeps every layer and links back to the source', async () => {
    const user = userEvent.setup();
    renderPanel(services, design());

    await user.click(screen.getByRole('button', { name: 'Carry onward' }));
    await user.click(await screen.findByRole('button', { name: /Animate it in Motion Studio/ }));
    await user.click(screen.getByRole('button', { name: 'Create the motion project' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const created = services.documents.getState().documents.find((entry) => entry.lineage);
    expect(created).toBeDefined();
    if (!created) return;

    expect(created.documentTypeId).toBe('motion.scene');
    expect(created.title).toBe('Field audit — motion');
    expect(created.scene.layers.map((layer) => String(layer.id))).toEqual(['lyr-title']);
    expect(created.lineage?.sourceDocumentId).toBe('doc-source');
    expect(created.lineage?.operation).toBe('scene-copy');
    expect(push).toHaveBeenCalledWith(`/workspace/${created.id}`);
    // The layer is still a text layer: a scene copy is editable, not a picture of a layer.
    expect(created.scene.layers[0]?.type).toBe('text');
  });

  it('creates a photo project from the rendered artboard, and records the flattening', async () => {
    const user = userEvent.setup();
    renderPanel(services, design());

    await user.click(screen.getByRole('button', { name: 'Carry onward' }));
    await user.click(await screen.findByRole('button', { name: /Retouch it in Photo Studio/ }));
    await user.click(screen.getByRole('button', { name: 'Create the photo project' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(rasteriseArtboardForPhoto).toHaveBeenCalledTimes(1);

    const created = services.documents.getState().documents.find((entry) => entry.lineage);
    expect(created).toBeDefined();
    if (!created) return;

    expect(created.documentTypeId).toBe('photo.image');
    expect(created.title).toBe('Field audit — retouch');
    expect(created.scene.layers).toEqual([]);
    expect(created.lineage?.operation).toBe('raster');
    const payload = created.studioPayload;
    expect(payload?.kind).toBe('photo');
    if (payload?.kind !== 'photo') return;
    expect(payload.source?.href).toBe(PHOTO_SOURCE.href);
    expect(created.canvas.width).toBe(1080);
  });

  it('keeps the dialog open and explains a render failure instead of creating a half project', async () => {
    const user = userEvent.setup();
    vi.mocked(rasteriseArtboardForPhoto).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'unsupported',
        message: 'The artboard could not be rendered.',
        detail: 'A graphic has not finished loading.',
        retryable: true,
      },
    } as Awaited<ReturnType<typeof rasteriseArtboardForPhoto>>);

    renderPanel(services, design());

    await user.click(screen.getByRole('button', { name: 'Carry onward' }));
    await user.click(await screen.findByRole('button', { name: /Retouch it in Photo Studio/ }));
    await user.click(screen.getByRole('button', { name: 'Create the photo project' }));

    expect(await screen.findByText(/could not be rendered/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(services.documents.getState().documents).toEqual([]);
  });
});
