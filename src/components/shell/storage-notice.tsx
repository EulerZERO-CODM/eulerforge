'use client';

import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';

import { useStorageStatus } from '../../state/hooks';
import { isVolatile } from '../../state/storage-status';
import { cn } from '../../lib/cn';
import { InlineNote } from '../ui/states';

/**
 * Global storage warning.
 *
 * Rendered by the shell on every screen whenever storage is *determined* to be volatile — that is,
 * when the browser refused local storage and the session-only fallback is in use. Without this, a
 * user could create projects, watch them appear in the library, and lose them on reload with no
 * warning at any point (ADR-0006).
 *
 * It deliberately renders nothing during server rendering: nothing is wrong there, the browser has
 * simply not been asked yet, and a warning would be contradicted on hydration.
 */
export function StorageNotice({ className }: { readonly className?: string | undefined }) {
  const storageStatus = useStorageStatus();

  if (!isVolatile(storageStatus)) return null;

  return (
    <InlineNote
      tone="danger"
      icon={<ShieldAlert aria-hidden />}
      title="Projects are not being saved to this device"
      className={cn('rounded-none border-x-0 border-t-0', className)}
    >
      <p>{storageStatus.notice}</p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href="/learn/how-your-projects-are-stored"
          className="text-fg underline decoration-1 underline-offset-2"
        >
          Why this happens
        </Link>
        <Link href="/settings" className="text-fg underline decoration-1 underline-offset-2">
          Check storage in settings
        </Link>
      </p>
    </InlineNote>
  );
}
