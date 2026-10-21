import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AssetCatalogue } from './asset-catalogue';
import { AssetStatusBadge } from './asset-status-badge';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';

function renderCatalogue(catalogSource: 'sample' | 'empty' = 'sample') {
  return render(
    <ForgeProvider services={createTestServices({ catalogSource })}>
      <AssetCatalogue />
    </ForgeProvider>,
  );
}

/**
 * The kind chip for a catalogue kind, once the catalogue has answered.
 *
 * The chip's accessible name is the label followed by its count. It has to be matched exactly: an
 * asset card also carries the kind's label, so a loose match finds several buttons.
 */
const audioChip = /^Audio\s*\d+$/;

async function kindChip(name: RegExp): Promise<HTMLElement> {
  return screen.findByRole('button', { name });
}

describe('AssetCatalogue filters', () => {
  it('keeps the selected kind listed when nothing matches it any more', async () => {
    renderCatalogue();
    const chip = await kindChip(audioChip);

    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');

    // The only audio record does not match this term, so the kind stops matching anything.
    await userEvent.type(screen.getByLabelText('Search assets'), 'poster');

    // The filter is still applied, so the chip that applies it has to stay on screen: a filter the
    // reader cannot see is a filter they cannot undo.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: audioChip })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  it('keeps the selected licence listed when nothing matches it any more', async () => {
    renderCatalogue();
    const licence = await screen.findByLabelText('Licence');

    await userEvent.selectOptions(licence, 'cc0-1.0');
    expect(licence).toHaveValue('cc0-1.0');

    // The only CC0 record does not match this term.
    await userEvent.type(screen.getByLabelText('Search assets'), 'grid');

    // The control must keep naming the licence that is filtering the list, instead of falling back
    // to "Any licence" while the results are still filtered by it.
    await waitFor(() => {
      expect(screen.getByLabelText('Licence')).toHaveValue('cc0-1.0');
    });
    expect(screen.getByRole('option', { name: /Creative Commons Zero 1\.0/ })).toBeInTheDocument();
  });
});

describe('AssetCatalogue empty states', () => {
  it('offers a Clear filters action when a filter is applied', async () => {
    renderCatalogue();
    const chip = await kindChip(audioChip);

    await userEvent.click(chip);
    await userEvent.type(screen.getByLabelText('Search assets'), 'zzz-nothing');

    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('offers no Clear filters action when nothing is filtered', async () => {
    renderCatalogue('empty');

    expect(await screen.findByText('This catalogue is empty')).toBeInTheDocument();
    // A button that resets filters that are already empty does nothing, and a dead control is
    // worse than no control.
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });
});

describe('AssetStatusBadge', () => {
  it('shows a sample record and a planned record differently', () => {
    render(
      <>
        <AssetStatusBadge status="sample" />
        <AssetStatusBadge status="planned" />
      </>,
    );

    const sample = screen.getByText('sample');
    const planned = screen.getByText('planned');
    expect(sample.className).not.toBe(planned.className);
  });
});
