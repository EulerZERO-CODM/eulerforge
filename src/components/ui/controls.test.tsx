import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { SegmentedControl } from './controls';

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
] as const;

function Harness() {
  const [value, setValue] = useState<(typeof OPTIONS)[number]['value']>('all');
  return (
    <SegmentedControl
      label="Filter by status"
      value={value}
      onChange={setValue}
      options={OPTIONS}
    />
  );
}

describe('SegmentedControl', () => {
  it('selects an option when it is clicked', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
    expect(screen.getByRole('button', { name: 'Draft' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves between the options with the arrow keys, and selects the one it lands on', async () => {
    render(<Harness />);
    screen.getByRole('button', { name: 'All' }).focus();

    await userEvent.keyboard('{ArrowRight}');

    expect(screen.getByRole('button', { name: 'Draft' })).toHaveAttribute('aria-pressed', 'true');
    // The focus follows the selection: a control that moves the value but leaves the focus behind
    // is worse than one that does neither.
    expect(screen.getByRole('button', { name: 'Draft' })).toHaveFocus();
  });

  it('moves the other way, and wraps around at the ends', async () => {
    render(<Harness />);
    screen.getByRole('button', { name: 'All' }).focus();

    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Ready' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });
});
