import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettingsView } from './settings-view';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';

function renderSettings() {
  return render(
    <ForgeProvider services={createTestServices()}>
      <SettingsView />
    </ForgeProvider>,
  );
}

describe('SettingsView guide defaults', () => {
  it('clamps a safe margin the preferences schema would reject', () => {
    renderSettings();
    const margin = screen.getByLabelText('Default safe margin');

    // The repository refuses to store a value outside the schema and throws when it is asked to,
    // so an unclamped field would raise inside the change handler and silently keep a value that
    // was never saved.
    fireEvent.change(margin, { target: { value: '150' } });
    expect(margin).toHaveValue(100);
  });

  it('clamps a bleed and a grid spacing the schema would reject', () => {
    renderSettings();

    const bleed = screen.getByLabelText('Default bleed');
    fireEvent.change(bleed, { target: { value: '80' } });
    expect(bleed).toHaveValue(50);

    const grid = screen.getByLabelText('Default grid spacing');
    fireEvent.change(grid, { target: { value: '0' } });
    expect(grid).toHaveValue(1);
  });

  it('states the schema version the app actually writes', () => {
    renderSettings();
    // The diagnostics used to say "v1" while documents were written at v2.
    expect(screen.getByText('Schema version')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
  });
});
