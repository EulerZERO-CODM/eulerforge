import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleCheckBig, CircleDashed, FlaskConical, Wrench } from 'lucide-react';

import { Badge, type BadgeTone } from '../../components/ui/badge';
import { KeyValuePill } from '../../components/ui/controls';
import { PageHeader, Panel } from '../../components/ui/section';
import { InlineNote } from '../../components/ui/states';
import {
  PLATFORM_AREA_LABELS,
  PLATFORM_CAPABILITIES,
  PLATFORM_STATUS_LABELS,
  capabilityCounts,
  type PlatformArea,
  type PlatformStatus,
} from '../../core/platform/status';

export const metadata: Metadata = {
  title: 'What works today',
  description:
    'A truthful ledger of every capability the interface mentions: implemented, partial, planned or exploratory — with how each claim is verified.',
};

const STATUS_TONES: Record<PlatformStatus, BadgeTone> = {
  implemented: 'available',
  partial: 'progress',
  planned: 'planned',
  exploratory: 'exploratory',
};

const STATUS_ICONS: Record<PlatformStatus, typeof CircleCheckBig> = {
  implemented: CircleCheckBig,
  partial: Wrench,
  planned: CircleDashed,
  exploratory: FlaskConical,
};

const AREA_ORDER: readonly PlatformArea[] = [
  'core',
  'shell',
  'studios',
  'learning',
  'assets',
  'platform',
];

/**
 * Capability ledger.
 *
 * The single page that answers "is this real?" for anything the product claims. `implemented` entries
 * must name their verification evidence — a test file, a command, or an instruction a reviewer can
 * follow — and the test suite enforces that rule.
 */
export default function PlatformStatusPage() {
  const counts = capabilityCounts();

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="What works today"
        lead="Every capability the interface mentions, sorted by whether it is implemented, partial, planned or exploratory. Claims of implementation carry the evidence that verifies them."
        meta={
          <>
            <KeyValuePill>{counts.implemented} implemented</KeyValuePill>
            <KeyValuePill>{counts.partial} partial</KeyValuePill>
            <KeyValuePill>{counts.planned} planned</KeyValuePill>
            <KeyValuePill>{counts.exploratory} exploratory</KeyValuePill>
          </>
        }
      />

      <InlineNote tone="neutral">
        <p>
          If something in the interface is not on this page, treat that as a bug: the ledger is
          meant to be exhaustive, and the roadmap connects each entry to its phase.
        </p>
      </InlineNote>

      {AREA_ORDER.map((area) => {
        const capabilities = PLATFORM_CAPABILITIES.filter((capability) => capability.area === area);
        if (capabilities.length === 0) return null;
        return (
          <section key={area} className="space-y-3" aria-labelledby={`area-${area}`}>
            <h2 id={`area-${area}`} className="text-fg text-lg font-semibold">
              {PLATFORM_AREA_LABELS[area]}
            </h2>
            <ul className="space-y-2.5">
              {capabilities.map((capability) => {
                const Icon = STATUS_ICONS[capability.status];
                return (
                  <li key={capability.id}>
                    <Panel className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-fg inline-flex items-center gap-2 text-base font-medium">
                          <Icon aria-hidden className="text-fg-subtle size-4" />
                          {capability.label}
                        </h3>
                        <Badge tone={STATUS_TONES[capability.status]}>
                          {PLATFORM_STATUS_LABELS[capability.status]}
                        </Badge>
                      </div>
                      <p className="text-fg-muted mt-1.5 text-sm">{capability.description}</p>
                      {capability.gap ? (
                        <p className="mt-1.5 text-sm text-amber-400">
                          <span className="font-medium">Gap: </span>
                          {capability.gap}
                        </p>
                      ) : null}
                      {capability.verification.length > 0 ? (
                        <div className="border-line-subtle mt-2 border-t pt-2">
                          <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
                            Verified by
                          </p>
                          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                            {capability.verification.map((evidence) => (
                              <li key={evidence} className="forge-numeric text-2xs text-fg-muted">
                                {evidence}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </Panel>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <InlineNote
        tone="tip"
        title="How to check these claims yourself"
        actions={
          <Link
            href="/roadmap"
            className="text-arc-300 text-sm underline decoration-1 underline-offset-4"
          >
            Read the roadmap
          </Link>
        }
      >
        <p>
          Clone the repository, run <code className="forge-numeric">npm ci</code> then{' '}
          <code className="forge-numeric">npm run verify</code>. That runs formatting, linting,
          strict type checking, the test suite and a production build — the same sequence CI runs on
          every push.
        </p>
      </InlineNote>
    </div>
  );
}
