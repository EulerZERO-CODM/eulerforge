import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentAside } from './document-aside';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices, type TestForgeServices } from '../../testing/forge-services';
import { brand } from '../../core/types/brand';
import type { DocumentSession } from '../../state/document-session';
import type { CreateDocumentInput } from '../../core/documents/types';

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/doc-fixed',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const documentTypeId = brand<'DocumentTypeId'>('design.canvas');
const documentId = 'doc-fixed';

const input: CreateDocumentInput = {
  title: 'Launch poster',
  studioId: 'design',
  documentTypeId,
  canvas: {
    width: 1080,
    height: 1080,
    unit: 'px',
    dpi: 96,
    background: '#0f1115',
    transparent: false,
  },
  palette: ['#ff8a3d', '#0f1115'],
};

/**
 * Renders the rail against a real session and re-renders it whenever the session changes, which is
 * what `useDocumentSession` does in the workspace itself. Nothing here is stubbed: edits go through
 * `DocumentSession.commit`, are persisted into the in-memory repository and come back through the
 * store.
 */
function renderAside(services: TestForgeServices, session: DocumentSession) {
  const view = () => {
    const state = session.getState();
    return (
      <ForgeProvider services={services}>
        <DocumentAside
          api={{
            doc: state.document,
            commit: async (label, patch) => (await session.commit(label, patch)).ok,
            undo: () => {
              void session.undo();
            },
            redo: () => {
              void session.redo();
            },
          }}
          history={state.history}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          onUndo={() => {
            void session.undo();
          }}
          onRedo={() => {
            void session.redo();
          }}
        />
      </ForgeProvider>
    );
  };

  const { rerender } = render(view());
  session.subscribe(() => {
    rerender(view());
  });
}

describe('DocumentAside', () => {
  let services: TestForgeServices;
  let session: DocumentSession;

  beforeEach(async () => {
    services = createTestServices({ generateId: () => documentId });
    const created = await services.documents.create(input);
    if (!created.ok) throw new Error('fixture document should be valid');

    const opened = services.documents.session(documentId);
    if (!opened) throw new Error('session should exist');
    session = opened;

    renderAside(services, session);
  });

  it('renders the inspector, export checks and history in one rail', () => {
    expect(screen.getByRole('complementary', { name: /document inspector/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /canvas/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /export/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /history/i })).toBeInTheDocument();
  });

  it('renames the project through the real session and records a labelled step', async () => {
    const user = userEvent.setup();
    const name = screen.getByLabelText('Name');

    await user.clear(name);
    await user.type(name, 'Spring launch poster');
    await user.tab();

    await waitFor(() => {
      expect(services.documents.getById(documentId)?.title).toBe('Spring launch poster');
    });
    expect(screen.getByText('Rename project')).toBeInTheDocument();
  });

  it('refuses an empty name, explains why and keeps the saved value', async () => {
    const user = userEvent.setup();
    const name = screen.getByLabelText('Name');

    await user.clear(name);
    await user.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(/name/i);
    expect(services.documents.getById(documentId)?.title).toBe('Launch poster');
  });

  it('bumps the revision once per committed edit, not once per keystroke', async () => {
    const user = userEvent.setup();
    expect(screen.getByLabelText('Revision')).toHaveValue('1');

    await user.type(screen.getByLabelText('Summary'), 'September release announcement');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByLabelText('Revision')).toHaveValue('2');
    });
    expect(session.getState().history).toHaveLength(1);
  });

  it('applies a canvas preset as one undoable step', async () => {
    const user = userEvent.setup();
    expect(screen.getByLabelText('Width')).toHaveValue('1080');

    await user.selectOptions(screen.getByLabelText('Preset'), 'social.story');

    await waitFor(() => {
      expect(screen.getByLabelText('Height')).toHaveValue('1920');
    });
    expect(screen.getByText('Apply Story / Reel cover preset')).toBeInTheDocument();
  });

  it('reports export readiness for the project file with no blocking issues', () => {
    expect(screen.getByText('Ready to export')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download project file/i })).toBeEnabled();
  });

  it('blocks a planned format and says plainly that no file will be produced', async () => {
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Format'), 'png');

    expect(await screen.findByRole('button', { name: /download unavailable/i })).toBeDisabled();
    expect(screen.getByText(/not implemented in this build/i)).toBeInTheDocument();
  });

  it('enables undo only once there is something to undo', async () => {
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();

    await user.type(screen.getByLabelText('Summary'), 'Something worth undoing');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    });
  });

  it('restores the previous value when undo runs', async () => {
    const user = userEvent.setup();
    const summary = screen.getByLabelText('Summary');

    await user.type(summary, 'First draft');
    await user.tab();
    await waitFor(() => {
      expect(services.documents.getById(documentId)?.summary).toBe('First draft');
    });

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(services.documents.getById(documentId)?.summary).toBe('');
    });
  });
});
