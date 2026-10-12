import Link from 'next/link';

import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/states';

/** Global 404. Offered destinations are the three that always exist. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <EmptyState
        title="That page does not exist"
        description="The link may be outdated, or the studio or lesson may not have shipped yet. Nothing here is a dead end — pick a destination below."
        actions={
          <>
            <Button asChild variant="primary">
              <Link href="/">Back to home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/studios">Browse studios</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/learn">Learning hub</Link>
            </Button>
          </>
        }
      />
    </div>
  );
}
