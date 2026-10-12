import { Badge, type BadgeTone } from '../ui/badge';
import type { StudioAvailability } from '../../core/studios/types';
import { STUDIO_AVAILABILITY_LABELS } from '../../core/studios/types';

/**
 * Availability presentation.
 *
 * The wording is deliberately plain and always paired with the definition's `maturityNote`, so a
 * user never has to guess whether a studio can be used today.
 */
const TONES: Record<StudioAvailability, BadgeTone> = {
  available: 'available',
  'in-development': 'progress',
  planned: 'planned',
  exploratory: 'exploratory',
};

export function AvailabilityBadge({
  availability,
  className,
}: {
  readonly availability: StudioAvailability;
  readonly className?: string;
}) {
  return (
    <Badge tone={TONES[availability]} withDot {...(className === undefined ? {} : { className })}>
      {STUDIO_AVAILABILITY_LABELS[availability]}
    </Badge>
  );
}

export function availabilityTone(availability: StudioAvailability): BadgeTone {
  return TONES[availability];
}
