import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { StudioDefinition } from '../../core/studios/types';
import { getDocumentType } from '../../core/documents/document-types';
import { cn } from '../../lib/cn';
import { AvailabilityBadge } from './availability';
import { StudioGlyph } from './studio-icon';

/**
 * Studio discovery card.
 *
 * Every card links somewhere real: a studio with a working entry point links straight to it, and a
 * studio that is still planned links to its status page. The card never implies that unbuilt work
 * is available — the availability badge and actions say exactly what exists.
 */
export function StudioCard({
  studio,
  className,
}: {
  readonly studio: StudioDefinition;
  readonly className?: string;
}) {
  const target = studio.entry.route ?? `/studios/${studio.slug}`;
  const documentTypes = studio.documentTypes
    .map((id) => getDocumentType(id))
    .filter((type): type is NonNullable<typeof type> => type !== undefined);

  const availableCount = studio.capabilities.filter(
    (capability) => capability.status === 'available',
  ).length;

  return (
    <article
      className={cn(
        'group border-line bg-surface-raised/60 flex flex-col gap-3.5 rounded-md border p-4 transition-colors',
        'hover:border-line-strong focus-within:border-line-strong',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <StudioGlyph name={studio.icon} accent={studio.accent} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-md text-fg font-semibold">
              <Link
                href={target}
                className="rounded-xs after:absolute after:inset-0 after:content-['']"
              >
                {studio.name}
              </Link>
            </h3>
            <AvailabilityBadge availability={studio.availability} />
          </div>
          <p className="text-fg-muted mt-1 text-sm">{studio.tagline}</p>
        </div>
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {studio.produces.slice(0, 3).map((item) => (
          <li
            key={item}
            className="border-line bg-ink-950 text-2xs text-fg-subtle rounded-xs border px-1.5 py-0.5"
          >
            {item}
          </li>
        ))}
      </ul>

      <div className="border-line-subtle mt-auto flex items-center justify-between gap-3 border-t pt-3">
        <p className="text-2xs text-fg-subtle">
          {documentTypes[0]?.label ?? 'Document type pending'}
          {availableCount > 0
            ? ` · ${String(availableCount)} usable feature${availableCount === 1 ? '' : 's'}`
            : ''}
        </p>
        <span className="text-fg-muted group-hover:text-fg inline-flex items-center gap-1.5 text-sm font-medium">
          {studio.entry.route ? studio.entry.label : 'See what is planned'}
          <ArrowRight
            aria-hidden
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </div>
    </article>
  );
}
