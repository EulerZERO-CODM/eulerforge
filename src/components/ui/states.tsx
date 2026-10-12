import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Empty, unavailable and error states.
 *
 * Every list, panel and catalogue surface in the app uses one of these instead of rendering
 * nothing, so a blank area is always explained and always offers a next step.
 */

export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
  size = 'md',
}: {
  readonly icon?: ReactNode | undefined;
  readonly title: string;
  readonly description: string;
  readonly actions?: ReactNode | undefined;
  readonly className?: string | undefined;
  readonly size?: 'sm' | 'md';
}) {
  return (
    <div
      className={cn(
        'border-line bg-surface/40 flex flex-col items-center justify-center rounded-md border border-dashed text-center',
        size === 'sm' ? 'gap-2 px-5 py-7' : 'gap-3 px-6 py-12',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className="border-line bg-ink-900 text-fg-subtle flex size-9 items-center justify-center rounded-md border [&>svg]:size-4"
        >
          {icon}
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="text-md text-fg font-medium">{title}</p>
        <p className="text-fg-muted mx-auto max-w-md text-sm">{description}</p>
      </div>
      {actions ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export type NoteTone = 'info' | 'tip' | 'warning' | 'danger' | 'neutral';

const NOTE_TONES: Record<NoteTone, string> = {
  info: 'border-arc-600/40 bg-arc-600/8 text-fg-muted',
  tip: 'border-mint-600/40 bg-mint-600/8 text-fg-muted',
  warning: 'border-amber-600/40 bg-amber-600/8 text-fg-muted',
  danger: 'border-rose-600/40 bg-rose-600/8 text-fg-muted',
  neutral: 'border-line bg-surface/60 text-fg-muted',
};

/**
 * Inline note. Used wherever the product has to be explicit about what is *not* implemented yet —
 * honesty statements live in the interface, not only in the docs.
 */
export function InlineNote({
  tone = 'neutral',
  title,
  children,
  icon,
  className,
  actions,
}: {
  readonly tone?: NoteTone;
  readonly title?: string | undefined;
  readonly children: ReactNode;
  readonly icon?: ReactNode | undefined;
  readonly className?: string | undefined;
  readonly actions?: ReactNode | undefined;
}) {
  return (
    // `role="note"` gives callouts, tips and roadmap notes a semantic identity that assistive
    // technology (and tests) can address without relying on a decorative class name.
    <div
      role="note"
      className={cn('rounded-md border px-3.5 py-3 text-sm', NOTE_TONES[tone], className)}
    >
      <div className="flex gap-3">
        {icon ? (
          <span aria-hidden className="text-fg-subtle mt-0.5 shrink-0 [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 space-y-1">
          {title ? <p className="text-fg font-medium">{title}</p> : null}
          <div className="space-y-1">{children}</div>
        </div>
      </div>
      {actions ? <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  detail,
  action,
  className,
}: {
  readonly title?: string | undefined;
  readonly description: string;
  readonly detail?: string | undefined;
  readonly action?: ReactNode | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div className={cn('rounded-md border border-rose-600/40 bg-rose-600/6 px-4 py-4', className)}>
      <p className="text-md text-fg font-medium">{title}</p>
      <p className="text-fg-muted mt-1 text-sm">{description}</p>
      {detail ? (
        <p className="forge-scroll border-line bg-ink-1000/60 text-fg-subtle mt-2 max-h-32 overflow-auto rounded-sm border px-2.5 py-2 text-xs">
          {detail}
        </p>
      ) : null}
      {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { readonly className?: string }) {
  return <div aria-hidden className={cn('bg-ink-850 animate-pulse rounded-sm', className)} />;
}

export function SkeletonCard({ lines = 3 }: { readonly lines?: number }) {
  return (
    <div className="border-line bg-surface-raised/40 space-y-3 rounded-md border p-4">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={index === lines - 1 ? 'h-3 w-1/2' : 'h-3 w-full'} />
      ))}
    </div>
  );
}

/** Screen-reader-only loading announcement for async regions. */
export function LoadingAnnouncement({ label }: { readonly label: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {label}
    </p>
  );
}
