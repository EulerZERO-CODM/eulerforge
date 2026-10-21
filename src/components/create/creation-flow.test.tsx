import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CreationFlow } from './creation-flow';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderFlow() {
  return render(
    <ForgeProvider services={createTestServices()}>
      <CreationFlow />
    </ForgeProvider>,
  );
}

/** Walks the wizard to the step that holds the custom dimensions. */
function goToSizeStep(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('CreationFlow canvas units', () => {
  it('enters a size in the document’s unit and stores it as pixels', () => {
    renderFlow();
    goToSizeStep();

    const unit = screen.getByLabelText('Unit');
    fireEvent.change(unit, { target: { value: 'mm' } });

    const width = screen.getByLabelText('Width');
    fireEvent.change(width, { target: { value: '210' } });

    // The field shows what was typed, in the document's unit. The document itself stores whole
    // pixels, so the value comes back a fraction of a millimetre out.
    expect(Number((width as HTMLInputElement).value)).toBeCloseTo(210, 0);
  });

  it('keeps the physical size when the unit changes', () => {
    renderFlow();
    goToSizeStep();

    const unit = screen.getByLabelText('Unit');
    fireEvent.change(unit, { target: { value: 'mm' } });

    // 1080 px at 96 dpi is 11.25 inches, which is 285.8 mm — not 1080 mm.
    expect(screen.getByLabelText('Width')).toHaveValue(285.8);
    expect(screen.getByLabelText('Height')).toHaveValue(357.2);
  });
});
