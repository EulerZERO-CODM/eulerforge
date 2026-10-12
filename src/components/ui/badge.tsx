import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export type BadgeTone =
  | 'neutral'
  | 'available'
  | 'progress'
  | 'planned'
  | 'exploratory'
  | 'warning'
  | 'danger'
  | 'accent';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-line-strong bg-ink-850 text-fg-muted',
  available: 'border-mint-600/50 bg-mint-600/12 text-mint-400',
  progress: 'border-amber-600/50 bg-amber-600/12 text-amber-400',
  planned: 'border-line-strong bg-ink-900 text-fg-subtle',
  exploratory: 'border-violet-600/50 bg-violet-600/12 text-violet-400',
  warning: 'border-amber-600/50 bg-amber-600/12 text-amber-400',
  danger: 'border-rose-600/50 bg-rose-600/12 text-rose-400',
  accent: 'border-ember-600/50 bg-ember-600/12 text-ember-400',
};

export type BadgeProps = {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
  /** Optional props accept an explicit `undefined` so callers can forward optionals directly. */
  readonly className?: string | undefined;
  /** Renders as an outlined pill with a leading dot; use for statuses that matter. */
  readonly withDot?: boolean;
  readonly title?: string | undefined;
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  withDot = false,
  title,
}: BadgeProps) {
  return (
    <span
      {...(title === undefined ? {} : { title })}
      className={cn(
        'text-2xs inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium tracking-wide uppercase',
        TONES[tone],
        className,
      )}
    >
      {withDot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
