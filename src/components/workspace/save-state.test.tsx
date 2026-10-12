import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SaveState } from './history-panel';
import { persistentStorageStatus, volatileStorageStatus } from '../../state/storage-status';

/**
 * Save-status indicator.
 *
 * This is the control that tells a user whether their work is safe, so the guarantee under test is
 * narrow and absolute: it may only say "Saved" when the write actually reaches the device, and it
 * must say something true when storage is a session-only fallback. The `storage` prop is passed in
 * rather than read from context so every case is exercised directly.
 */
const savedAt = '2026-04-01T10:00:00.000Z';

function renderState({
  dirty = false,
  saving = false,
  error = null,
  storage = persistentStorageStatus(),
}: {
  dirty?: boolean;
  saving?: boolean;
  error?: string | null;
  storage?: ReturnType<typeof persistentStorageStatus>;
} = {}) {
  return render(
    <SaveState dirty={dirty} saving={saving} savedAt={savedAt} error={error} storage={storage} />,
  );
}

describe('SaveState with durable storage', () => {
  it('reports a real save after a write', () => {
    renderState();

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/^Saved/);
    expect(status.textContent).not.toMatch(/memory/i);
  });

  it('distinguishes pending changes from a completed save', () => {
    renderState({ dirty: true });

    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    expect(screen.getByRole('status').textContent).not.toMatch(/memory/i);
  });

  it('names the failure instead of showing a stale success', () => {
    renderState({ error: 'Local storage is full. Delete a project to free space.' });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/Not saved/i);
    expect(status).toHaveTextContent(/storage is full/i);
    expect(status.textContent).not.toMatch(/^Saved/);
  });

  it('gives saving precedence over the waiting state', () => {
    renderState({ saving: true, dirty: true });

    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
  });
});

describe('SaveState with a session-only fallback', () => {
  it('never claims a save', () => {
    renderState({ storage: volatileStorageStatus('Access denied.') });

    const status = screen.getByRole('status');
    expect(status.textContent).not.toMatch(/saved/i);
    expect(status).toHaveTextContent(/in memory only/i);
    expect(status).toHaveTextContent(/reloading loses this/i);
  });

  it('keeps saying so while changes are pending', () => {
    renderState({ dirty: true, storage: volatileStorageStatus() });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Unsaved changes — memory only');
    expect(status.textContent).not.toMatch(/saved to this device/i);
  });

  it('describes an in-flight write as holding in memory, not saving to disk', () => {
    renderState({ saving: true, storage: volatileStorageStatus() });

    expect(screen.getByRole('status')).toHaveTextContent('Holding in memory…');
  });

  it('still shows a genuine write failure when one happens', () => {
    renderState({
      error: 'This device would not save local data.',
      storage: volatileStorageStatus(),
    });

    expect(screen.getByRole('status')).toHaveTextContent(/Not saved/i);
  });

  it('claims nothing at all before the browser has been inspected (server render)', () => {
    renderState({
      storage: { ...volatileStorageStatus(), determined: false, cause: 'server-render' },
    });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Checking storage…');
    expect(status.textContent).not.toMatch(/saved/i);
  });
});
