import type { AssetStatus } from '../../core/assets/types';
import { Badge } from '../ui/badge';

/**
 * Status badge for a catalogue record.
 *
 * One component, so every surface that shows a record's status shows it the same way: a sample is
 * available now, a planned record is not, and the two must not look alike. Two surfaces used to
 * disagree about the tone of the same record, which made a planned record look more available than
 * a sample one.
 */
export function AssetStatusBadge({ status }: { readonly status: AssetStatus }) {
  return <Badge tone={status === 'sample' ? 'neutral' : 'planned'}>{status}</Badge>;
}
