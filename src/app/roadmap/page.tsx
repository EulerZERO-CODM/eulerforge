import type { Metadata } from 'next';

import { Badge, type BadgeTone } from '../../components/ui/badge';
import { KeyValuePill } from '../../components/ui/controls';
import { PageHeader, Panel, SectionHeading } from '../../components/ui/section';
import { InlineNote } from '../../components/ui/states';
import {
  ROADMAP,
  ROADMAP_STATUS_LABELS,
  roadmapCounts,
  type RoadmapItemStatus,
} from '../../core/platform/roadmap';
import { getCapability } from '../../core/platform/lookup';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Roadmap',
  description:
    'Phased plan with dependencies and measurable completion criteria, marking what is done, what is next and what is still exploratory.',
};

const STATUS_TONES: Record<RoadmapItemStatus, BadgeTone> = {
  done: 'available',
  partial: 'progress',
  'in-progress': 'progress',
  planned: 'planned',
  exploratory: 'exploratory',
};

const PHASE_TONES = {
  complete: 'available',
  'in-progress': 'progress',
  planned: 'planned',
  exploratory: 'exploratory',
} as const;

export default function RoadmapPage() {
  const counts = roadmapCounts();

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="Roadmap"
        lead="Phase 1 is complete and shipped in this repository. Everything after it is ordered by dependency, and each item states how we will know it is finished — not just what it is."
        meta={
          <>
            <KeyValuePill>{counts.done} done</KeyValuePill>
            <KeyValuePill>{counts['in-progress']} in progress</KeyValuePill>
            <KeyValuePill>{counts.planned} planned</KeyValuePill>
            <KeyValuePill>{counts.exploratory} exploratory</KeyValuePill>
          </>
        }
      />

      <InlineNote tone="neutral">
        <p>
          This page and <code className="forge-numeric">docs/ROADMAP.md</code> describe the same
          plan. The exploratory phase is deliberately separate: nothing in it is committed, and it
          must not shape the architecture of the committed phases.
        </p>
      </InlineNote>

      <ol className="space-y-5">
        {ROADMAP.map((phase) => (
          <li key={phase.id}>
            <Panel className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-fg text-lg font-semibold">{phase.name}</h2>
                  <p className="text-fg-muted mt-1 max-w-3xl text-sm">{phase.summary}</p>
                </div>
                <Badge tone={PHASE_TONES[phase.status]} withDot>
                  {phase.status.replace('-', ' ')}
                </Badge>
              </div>

              <ul className="mt-4 space-y-3">
                {phase.items.map((item) => (
                  <li key={item.id} className="border-line bg-ink-950/40 rounded-sm border p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-fg text-base font-medium">{item.title}</h3>
                      <Badge tone={STATUS_TONES[item.status]}>
                        {ROADMAP_STATUS_LABELS[item.status]}
                      </Badge>
                    </div>
                    <p className="text-fg-muted mt-1 text-sm">{item.description}</p>

                    {item.gap ? (
                      <p className="text-fg-subtle mt-1.5 text-xs">
                        <span className="font-medium">Still missing: </span>
                        {item.gap}
                      </p>
                    ) : null}

                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
                          Finished when
                        </p>
                        <ul className="mt-1 space-y-1">
                          {item.completionCriteria.map((criterion) => (
                            <li key={criterion} className="text-fg-muted flex gap-2 text-xs">
                              <span aria-hidden className="text-fg-subtle">
                                ✓
                              </span>
                              {criterion}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {item.dependsOn.length > 0 || item.capabilityIds.length > 0 ? (
                        <div className="space-y-1.5">
                          {item.dependsOn.length > 0 ? (
                            <p className="text-fg-subtle text-xs">
                              <span className="text-fg-subtle">Depends on: </span>
                              {item.dependsOn.join(', ')}
                            </p>
                          ) : (
                            <p className="text-fg-subtle text-xs">
                              No dependencies — can start immediately.
                            </p>
                          )}
                          {item.capabilityIds.length > 0 ? (
                            <p className="text-fg-subtle text-xs">
                              <span className="text-fg-subtle">Capabilities: </span>
                              {item.capabilityIds
                                .map((id) => getCapability(id)?.label ?? id)
                                .join(', ')}
                            </p>
                          ) : null}
                          {item.evidence && item.evidence.length > 0 ? (
                            <div className="text-fg-subtle text-xs">
                              <span className="font-medium">Evidence</span>
                              <ul className="mt-0.5 space-y-0.5">
                                {item.evidence.map((entry) => (
                                  <li key={entry} className="forge-numeric break-all">
                                    {entry}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="border-line-subtle mt-4 border-t pt-3">
                <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
                  Phase exit criteria
                </p>
                <ul className="mt-1.5 space-y-1">
                  {phase.exitCriteria.map((criterion) => (
                    <li key={criterion} className="text-fg-muted flex gap-2 text-sm">
                      <span aria-hidden className="text-accent">
                        →
                      </span>
                      {criterion}
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          </li>
        ))}
      </ol>

      <SectionHeading
        title="Where the detail lives"
        description="Repository documents hold the long-form reasoning; the interface holds the status."
      />
      <ul className="grid gap-2 sm:grid-cols-2">
        {[
          {
            href: '/platform-status',
            label: 'Capability ledger',
            detail: 'Every claim, with its verification',
          },
          {
            href: '/studios',
            label: 'Studios',
            detail: 'Per-discipline status and engine boundaries',
          },
          {
            href: '/learn',
            label: 'Learning hub',
            detail: 'Concepts for studios that are still planned',
          },
        ].map((entry) => (
          <li key={entry.href}>
            <Link
              href={entry.href}
              className="border-line bg-surface-raised/50 hover:border-line-strong block rounded-md border px-3.5 py-3 transition-colors"
            >
              <span className="text-fg block text-base font-medium">{entry.label}</span>
              <span className="text-fg-subtle mt-0.5 block text-xs">{entry.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
