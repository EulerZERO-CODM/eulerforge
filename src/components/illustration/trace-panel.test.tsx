/**
 * The trace panel.
 *
 * Decoding an image is a browser capability jsdom does not have, so the file-to-pixels half is
 * replaced and everything else — the command that goes into history, the refusal path, the report
 * text — is exercised for real. The tracer itself is tested against synthetic buffers in
 * `src/core/vector/trace.test.ts`, and the real file path runs in Chromium.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TracePanel } from './trace-panel';
import { forgeError, ok, type Result } from '../../core/result';
import { createContour, createNode, createPath, type TraceReport } from '../../core/vector';
import type { WorkspaceApi } from '../workspace/workspace-api';
import type { SceneCommand } from '../../core/editor/commands';
import type * as ImageTrace from '../../lib/browser/image-trace';

vi.mock('../../lib/browser/image-trace', async (importOriginal) => {
  const actual = await importOriginal<typeof ImageTrace>();
  return { ...actual, traceFile: vi.fn() };
});

const { traceFile } = await import('../../lib/browser/image-trace');

function square(x: number, y: number, size: number) {
  return createPath([
    createContour(
      [
        createNode({ x, y }),
        createNode({ x: x + size, y }),
        createNode({ x: x + size, y: y + size }),
        createNode({ x, y: y + size }),
      ],
      true,
    ),
  ]);
}

const report: TraceReport = {
  width: 100,
  height: 100,
  sampleWidth: 100,
  sampleHeight: 100,
  palette: ['#ffffff', '#ff0000'],
  regions: [
    { colour: '#ffffff', path: square(0, 0, 100), area: 9_000, contours: 1, nodes: 4 },
    { colour: '#ff0000', path: square(40, 40, 20), area: 400, contours: 1, nodes: 4 },
  ],
  nodes: 8,
  droppedRegions: 1,
  tolerance: 1,
};

function apiWith(run: (command: Result<SceneCommand>) => Promise<boolean>): WorkspaceApi {
  return {
    doc: {
      id: 'doc',
      scene: { layers: [] },
      canvas: { width: 200, height: 200 },
    } as unknown as WorkspaceApi['doc'],
    commit: async () => true,
    run,
    undo: () => undefined,
    redo: () => undefined,
  };
}

function pngFile(): File {
  return new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
}

describe('the trace panel', () => {
  beforeEach(() => {
    vi.mocked(traceFile).mockReset();
  });

  it('keeps Trace image disabled until a file is chosen', () => {
    render(<TracePanel api={apiWith(async () => true)} />);
    expect(screen.getByTestId('trace-run')).toBeDisabled();
    expect(screen.getByTestId('trace-file')).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/webp',
    );
  });

  it('adds the trace as one command and reports what was traced and what was left out', async () => {
    const user = userEvent.setup();
    const commands: Result<SceneCommand>[] = [];
    vi.mocked(traceFile).mockResolvedValue(
      ok({ report, fileName: 'logo.png', source: { width: 400, height: 400 } }),
    );
    render(
      <TracePanel
        api={apiWith(async (command) => {
          commands.push(command);
          return true;
        })}
      />,
    );

    await user.upload(screen.getByTestId('trace-file'), pngFile());
    await user.click(screen.getByTestId('trace-run'));

    await waitFor(() => {
      expect(screen.getByTestId('trace-status')).toHaveTextContent(/2 editable layers/i);
    });
    expect(screen.getByTestId('trace-status')).toHaveTextContent(/8 nodes/);
    expect(screen.getByTestId('trace-status')).toHaveTextContent(/1 region below 12 px²/);
    expect(screen.getByTestId('trace-summary')).toHaveTextContent(/2 layers/);

    // The panel passes the options the user chose, and hands over one whole command.
    expect(vi.mocked(traceFile).mock.calls[0]?.[1]).toMatchObject({
      colours: 6,
      detail: 60,
      minArea: 12,
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.ok).toBe(true);
    if (!commands[0]?.ok) return;
    expect(commands[0].value.label).toBe('Trace image (2 layers)');
    expect(commands[0].value.patch.scene?.layers).toHaveLength(2);
  });

  it('explains a refusal instead of adding a layer', async () => {
    const user = userEvent.setup();
    const run = vi.fn(async () => true);
    vi.mocked(traceFile).mockResolvedValue({
      ok: false,
      error: forgeError('unsupported', 'That file type cannot be traced.', {
        detail: 'Choose a PNG, JPEG or WebP image.',
      }),
    });
    render(<TracePanel api={apiWith(run)} />);

    await user.upload(screen.getByTestId('trace-file'), pngFile());
    await user.click(screen.getByTestId('trace-run'));

    await waitFor(() => {
      expect(screen.getByTestId('trace-error')).toHaveTextContent(/PNG, JPEG or WebP/);
    });
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByTestId('trace-summary')).toBeNull();
  });

  it('reports when the document refuses the trace', async () => {
    const user = userEvent.setup();
    vi.mocked(traceFile).mockResolvedValue(
      ok({ report, fileName: 'logo.png', source: { width: 400, height: 400 } }),
    );
    render(<TracePanel api={apiWith(async () => false)} />);

    await user.upload(screen.getByTestId('trace-file'), pngFile());
    await user.click(screen.getByTestId('trace-run'));

    await waitFor(() => {
      expect(screen.getByTestId('trace-error')).toHaveTextContent(/could not be added/i);
    });
  });
});
