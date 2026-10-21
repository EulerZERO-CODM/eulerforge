'use client';

import { studioRegistry } from '../../core/studios';
import { usePreferences } from '../../state/hooks';
import { SectionHeading } from '../ui/section';
import { StudioCard } from './studio-card';

/**
 * Studio listings, grouped by availability.
 *
 * A client component because one of the preferences is device-local: "hide studios that are not
 * available yet" is a choice stored in this browser, and a server-rendered page cannot read it. The
 * page itself stays a server component; only the listing is filtered here.
 */
export function StudioListings() {
  const { preferences } = usePreferences();
  const hideUpcoming = preferences.hideUpcomingStudios;

  const available = studioRegistry.listByAvailability('available');
  const groups = [
    {
      id: 'in-development',
      title: 'In development',
      studios: studioRegistry.listByAvailability('in-development'),
      description: 'Work has started; entry points are partial and labelled.',
    },
    {
      id: 'planned',
      title: 'Planned',
      studios: studioRegistry.listByAvailability('planned'),
      description:
        'Designed and scheduled. No editing surface exists yet — the pages explain what each will require.',
    },
    {
      id: 'exploratory',
      title: 'Exploratory',
      studios: studioRegistry.listByAvailability('exploratory'),
      description:
        'Recorded so the platform’s boundaries stay honest. No technology has been committed.',
    },
  ].filter((group) => group.studios.length > 0);

  return (
    <>
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

      {hideUpcoming ? (
        <p className="text-fg-subtle text-xs">
          Studios that cannot be opened today are hidden by your settings. Change that in Settings →
          Catalogue and discovery.
        </p>
      ) : (
        groups.map((group) => (
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
        ))
      )}
    </>
  );
}
