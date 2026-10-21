import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StudioListings } from './studio-listings';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';

function renderListings(hideUpcoming: boolean) {
  const services = createTestServices();
  services.preferences.update({ hideUpcomingStudios: hideUpcoming });
  return render(
    <ForgeProvider services={services}>
      <StudioListings />
    </ForgeProvider>,
  );
}

describe('StudioListings', () => {
  it('lists every studio, grouped by what can be opened today', () => {
    renderListings(false);
    expect(screen.getByRole('heading', { name: 'Available now' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planned' })).toBeInTheDocument();
  });

  it('hides the studios that cannot be opened when the reader asked for that', () => {
    renderListings(true);
    expect(screen.getByRole('heading', { name: 'Available now' })).toBeInTheDocument();
    // The preference used to be written and never read, so it did nothing at all.
    expect(screen.queryByRole('heading', { name: 'Planned' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'In development' })).not.toBeInTheDocument();
    expect(screen.getByText(/Studios that cannot be opened today are hidden/)).toBeInTheDocument();
  });
});
