import { cn } from '../../lib/cn';

/**
 * Euler's Forge mark.
 *
 * A chamfered hexagonal plate with three stacked strata and a spark: the plate is the forge, the
 * strata are the specialist studios built on one core, the spark is the work produced. Drawn with
 * currentColor so it inherits the ink scale, with the spark in the accent token.
 */
export function ForgeMark({
  className,
  title,
}: {
  readonly className?: string;
  readonly title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('size-6 shrink-0', className)}
      fill="none"
    >
      <path
        d="M16 2.6 27.5 9.3v13.4L16 29.4 4.5 22.7V9.3L16 2.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        className="text-line-strong"
      />
      <path
        d="M10 12.2h9.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="text-fg-muted"
      />
      <path
        d="M10 16h12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="text-fg"
      />
      <path
        d="M10 19.8h9.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="text-fg-muted"
      />
      <path d="M22.6 12.9 25 15.3l-2.4 2.4-2.4-2.4 2.4-2.4Z" className="fill-accent" />
      <path d="M22.6 16.9 24.2 18.5l-1.6 1.6-1.6-1.6 1.6-1.6Z" className="fill-accent/60" />
    </svg>
  );
}

export function ForgeLogo({
  className,
  showWordmark = true,
  size = 'md',
}: {
  readonly className?: string;
  readonly showWordmark?: boolean;
  readonly size?: 'sm' | 'md';
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <ForgeMark className={size === 'sm' ? 'size-5' : 'size-6'} />
      {showWordmark ? (
        <span className="flex items-baseline gap-1.5 leading-none">
          <span
            className={cn(
              'text-fg font-semibold tracking-tight',
              size === 'sm' ? 'text-sm' : 'text-md',
            )}
          >
            Euler&rsquo;s Forge
          </span>
        </span>
      ) : null}
    </span>
  );
}
