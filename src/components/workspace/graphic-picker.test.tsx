import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { GraphicPicker } from './graphic-picker';
import { SAMPLE_ASSETS } from '../../core/assets/data';
import { isPlaceable, type AssetRecord } from '../../core/assets/types';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';

/**
 * The graphic picker.
 *
 * Two rules it exists to enforce: only records with a real file can be placed, and a user never has to
 * drag anything to place one. The catalogue itself is the same adapter the library page uses, so the
 * editor cannot drift into showing different records.
 */
function Harness({ onPlace }: { readonly onPlace: (record: AssetRecord) => void }) {
  const [open, setOpen] = useState(true);
  const place = useCallback(
    (record: AssetRecord) => {
      onPlace(record);
      setOpen(false);
    },
    [onPlace],
  );
  return <GraphicPicker open={open} onOpenChange={setOpen} onPlace={place} />;
}

function renderPicker(): { readonly placed: AssetRecord[] } {
  const placed: AssetRecord[] = [];
  render(
    <ForgeProvider services={createTestServices()}>
      <Harness
        onPlace={(record) => {
          placed.push(record);
        }}
      />
    </ForgeProvider>,
  );
  return { placed };
}

const placeable = SAMPLE_ASSETS.filter(isPlaceable);
const referenceOnly = SAMPLE_ASSETS.filter((record) => !isPlaceable(record));

describe('GraphicPicker', () => {
  it('offers every graphic that really ships, and nothing that does not', async () => {
    renderPicker();

    const buttons = await screen.findAllByRole('button', { name: /place on canvas/i });
    expect(buttons).toHaveLength(placeable.length);
    expect(placeable.length).toBeGreaterThan(0);
  });

  it('states the licence, author and provenance of each record', async () => {
    renderPicker();

    const card = (await screen.findAllByRole('button', { name: /place on canvas/i }))[0];
    const container = card?.closest('li');
    expect(container).not.toBeNull();
    const record = placeable[0];
    if (!record) throw new Error('the catalogue must ship at least one placeable graphic');

    expect(container).toHaveTextContent(record.license.name);
    expect(container).toHaveTextContent(record.provenance.author);
    // An unverified record must warn before it is placed, not after.
    if (record.provenance.verified) {
      expect(container).not.toHaveTextContent(/check the licence/i);
    } else {
      expect(container).toHaveTextContent(/check the licence/i);
    }
  });

  it('places a record with a click, never a drag', async () => {
    const { placed } = renderPicker();

    const buttons = await screen.findAllByRole('button', { name: /place on canvas/i });
    await userEvent.click(buttons[0] as HTMLElement);

    expect(placed).toHaveLength(1);
    expect(placed[0]?.file).toBeDefined();
  });

  it('lists metadata-only records as references, with the reason they cannot be placed', async () => {
    renderPicker();

    await screen.findAllByRole('button', { name: /place on canvas/i });
    expect(referenceOnly.length).toBeGreaterThan(0);

    // The picker only searches graphics and textures, so the reference records it can show are the
    // reference-only records of those kinds — 'Geometric marks' among them.
    const expected = referenceOnly.filter(
      (record) => record.kind === 'graphic' || record.kind === 'texture',
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(screen.getByText(/reference records in this result/i)).toBeInTheDocument();

    const first = expected[0];
    if (!first) throw new Error('the catalogue must document a reference-only graphic');
    const item = screen.getByText(first.name).closest('li');
    expect(item).not.toBeNull();
    expect(item?.textContent).toContain(first.usageNote);
    // A record with no file must not offer to place itself.
    expect(item?.querySelector('button')).toBeNull();
  });

  it('searches the catalogue through the same query the library uses', async () => {
    renderPicker();

    await screen.findAllByRole('button', { name: /place on canvas/i });
    await userEvent.type(screen.getByLabelText(/search graphics/i), 'waveform');

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /place on canvas/i }).length).toBeLessThan(
        placeable.length,
      );
    });
    expect(screen.getByText(/waveform/i)).toBeInTheDocument();
  });

  it('reports a catalogue failure instead of an empty result', async () => {
    const services = createTestServices();
    const query = vi.spyOn(services.catalog, 'query').mockResolvedValue({
      ok: false,
      error: { code: 'unknown', message: 'The catalogue adapter failed.' },
    } as unknown as Awaited<ReturnType<typeof services.catalog.query>>);

    render(
      <ForgeProvider services={services}>
        <Harness onPlace={() => undefined} />
      </ForgeProvider>,
    );

    expect(await screen.findByText(/catalogue adapter failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    query.mockRestore();
  });
});
