import type { Metadata } from 'next';
import Link from 'next/link';

import { StudioListings } from '../../components/studios/studio-listings';
import { Button } from '../../components/ui/button';
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
          <strong className="text-fg">Design Studio</strong>, which edits real artwork — text,
          shapes and placed graphics — and it says so on its own page.
        </p>
      </InlineNote>

      <StudioListings />
    </div>
  );
}
