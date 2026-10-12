import type { Metadata } from 'next';
import Link from 'next/link';

import { StudioCard } from '../../components/studios/studio-card';
import { Button } from '../../components/ui/button';
import { SectionHeading } from '../../components/ui/section';
import { InlineNote } from '../../components/ui/states';
import { DOCUMENT_TYPES } from '../../core/documents/document-types';
import { studioRegistry } from '../../core/studios';

export const metadata: Metadata = {
  title: 'Studios',
  description:
    'Every discipline Euler’s Forge is building, with literal availability status and the engine boundary each one will use.',
};

/**
 * Studio discovery.
 *
 * Reads the studio registry directly: the page has no hard-coded studio list, so a new definition
 * appears here without touching this file.
 */
export default function StudiosPage() {
  const available = studioRegistry.listByAvailability('available');
  const inDevelopment = studioRegistry.listByAvailability('in-development');
  const planned = studioRegistry.listByAvailability('planned');
  const exploratory = studioRegistry.listByAvailability('exploratory');

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <h1 className="text-fg text-2xl font-semibold">Studios</h1>
        <p className="text-md text-fg-muted max-w-3xl">
          Each discipline gets its own specialist studio rather than being crammed into one editor.
          They share the document model, history, asset system and learning layer — and differ where
          the work genuinely differs: raster needs a GPU compositor, video needs a timeline and
          media pipeline, illustration needs a geometry kernel.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="primary">
            <Link href="/create">Create a project</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/roadmap">See when each studio lands</Link>
          </Button>
        </div>
      </header>

      <InlineNote tone="neutral">
        <p>
          {studioRegistry.list().length} studios are defined as data with {DOCUMENT_TYPES.length}{' '}
          document types. Exactly {available.length} can be opened today:{' '}
          <strong className="text-fg">Design Studio</strong>, which handles document setup rather
          than drawing — and it says so on its own page.
        </p>
      </InlineNote>

      <section className="space-y-4" aria-labelledby="available-studios">
        <SectionHeading
          id="available-studios"
          title="Available now"
          description="Studios with a working entry point in this build."
        />
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {available.map((studio) => (
            <li key={studio.id} className="relative">
              <StudioCard studio={studio} className="h-full" />
            </li>
          ))}
        </ul>
      </section>

      {[
        {
          id: 'in-development',
          title: 'In development',
          studios: inDevelopment,
          description: 'Work has started; entry points are partial and labelled.',
        },
        {
          id: 'planned',
          title: 'Planned',
          studios: planned,
          description:
            'Designed and scheduled. No editing surface exists yet — the pages explain what each will require.',
        },
        {
          id: 'exploratory',
          title: 'Exploratory',
          studios: exploratory,
          description:
            'Recorded so the platform’s boundaries stay honest. No technology has been committed.',
        },
      ]
        .filter((group) => group.studios.length > 0)
        .map((group) => (
          <section key={group.id} className="space-y-4" aria-labelledby={`studios-${group.id}`}>
            <SectionHeading
              id={`studios-${group.id}`}
              title={group.title}
              description={group.description}
            />
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {group.studios.map((studio) => (
                <li key={studio.id} className="relative">
                  <StudioCard studio={studio} className="h-full" />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
