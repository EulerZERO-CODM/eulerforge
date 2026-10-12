import { Check, Clock, FlaskConical } from 'lucide-react';

import type { StudioCapability } from '../../core/studios/types';

const ICONS = {
  available: Check,
  planned: Clock,
  exploratory: FlaskConical,
} as const;

const COLORS = {
  available: 'text-mint-400',
  planned: 'text-fg-subtle',
  exploratory: 'text-violet-400',
} as const;

const GROUP_LABELS = {
  available: 'Ready to use now',
  planned: 'Planned',
  exploratory: 'Exploratory',
} as const;

/**
 * Capability list for a studio.
 *
 * Grouping by status is the whole point: a reader can see at a glance which features exist today,
 * which are planned, and which are still research questions — without reading a roadmap document.
 */
export function CapabilityList({
  capabilities,
}: {
  readonly capabilities: readonly StudioCapability[];
}) {
  const groups = (['available', 'planned', 'exploratory'] as const)
    .map((status) => ({
      status,
      items: capabilities.filter((capability) => capability.status === status),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.status} className="space-y-2.5">
          <h3 className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
            {GROUP_LABELS[group.status]}
          </h3>
          <ul className="space-y-2.5">
            {group.items.map((capability) => {
              const Icon = ICONS[capability.status];
              return (
                <li key={capability.id} className="flex gap-3">
                  <Icon
                    aria-hidden
                    className={`mt-0.5 size-4 shrink-0 ${COLORS[capability.status]}`}
                  />
                  <div className="min-w-0">
                    <p className="text-fg text-base font-medium">{capability.label}</p>
                    <p className="text-fg-muted text-sm">{capability.detail}</p>
                    <p className="sr-only">Status: {GROUP_LABELS[capability.status]}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
