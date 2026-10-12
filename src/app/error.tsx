'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { Button } from '../components/ui/button';
import { PageHeader } from '../components/ui/section';
import { ErrorState } from '../components/ui/states';

/**
 * Route error boundary.
 *
 * Shows the digest for support and offers recovery actions. Deliberately does not claim that data was
 * preserved: local writes either succeeded or reported their own error through a toast.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    // The boundary is the last place an unhandled render error is visible; log it for diagnostics.
    console.error('[forge] unhandled route error:', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-12 sm:px-6">
      <PageHeader
        title="This screen failed to render"
        lead="The error was caught by the application boundary, so the rest of the shell still works."
      />
      <ErrorState
        title="Unexpected error"
        description={error.message || 'An unknown error occurred while rendering this route.'}
        {...(error.digest === undefined ? {} : { detail: `Digest: ${error.digest}` })}
        action={
          <>
            <Button variant="primary" onClick={reset}>
              Try again
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Back to home</Link>
            </Button>
            <Button asChild variant="quiet">
              <Link href="/platform-status">What works today</Link>
            </Button>
          </>
        }
      />
    </div>
  );
}
