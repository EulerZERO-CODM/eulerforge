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
        'group border-line bg-surface-raised/60 flex min-w-0 flex-col gap-3.5 rounded-md border p-4 transition-colors',
        'hover:border-line-strong focus-within:border-line-strong',
        className,
      )}
    >
      {/* Badge on the card's top-right corner, name on its own full-width line. Sharing a line
          with the badge put every name into a column barely wider than "Illustration Studio" and
          wrapped it, which broke the shared rhythm of the row. */}
      <div className="flex items-start justify-between gap-3">
        <StudioGlyph name={studio.icon} accent={studio.accent} size="lg" />
        <AvailabilityBadge availability={studio.availability} className="shrink-0" />
      </div>

      <div className="min-w-0">
        <h3 className="text-md text-fg font-semibold">
          <Link
            href={target}
            className="rounded-xs after:absolute after:inset-0 after:content-['']"
          >
            {studio.name}
          </Link>
        </h3>
        {/* Two lines are reserved: a one-line tagline on one card would otherwise pull its
            capability list up and re-introduce the ragged edge this layout is fixing. Long
            taglines are never clipped — they just take the extra line. */}
        <p className="text-fg-muted mt-1 min-h-10 text-sm">{studio.tagline}</p>
      </div>

      {/* What the studio produces, one item per line. These are full phrases, not labels: as
          chips they wrapped to two or three rows depending on the wording, which shifted the
          footer rule of neighbouring cards out of line. Three single-line rows hold the same
          height on every card, and the full text stays in the document for assistive tech. */}
      <ul className="flex flex-col gap-1">
        {studio.produces.slice(0, 3).map((item) => (
          <li key={item} className="text-2xs text-fg-subtle flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="bg-line-strong size-1 shrink-0 rounded-full" />
            <span className="truncate" title={item}>
              {item}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-line-subtle mt-auto space-y-1.5 border-t pt-3">
        <p className="text-2xs text-fg-subtle truncate">
          {documentTypes[0]?.label ?? 'Document type pending'}
          {availableCount > 0
            ? ` · ${String(availableCount)} usable feature${availableCount === 1 ? '' : 's'}`
            : ''}
        </p>
        <span className="text-fg-muted group-hover:text-fg flex items-center gap-1.5 text-sm font-medium">
          {studio.entry.route ? studio.entry.label : 'See what is planned'}
          <ArrowRight
            aria-hidden
            className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </div>
    </article>
  );
}
