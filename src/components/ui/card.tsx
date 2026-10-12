import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export function Card({
  children,
  className,
  as: Component = 'div',
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Component
      className={cn(
        'border-line bg-surface-raised/70 rounded-md border backdrop-blur-[1px]',
        'transition-colors',
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  headingLevel = 3,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
  readonly className?: string | undefined;
  readonly headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        'border-line-subtle flex items-start justify-between gap-4 border-b px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="text-fg text-base font-semibold">{title}</Heading>
        {description ? <p className="text-fg-muted mt-0.5 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={cn('px-4 py-3.5', className)}>{children}</div>;
}

export function CardFooter({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'border-line-subtle flex items-center justify-between gap-3 border-t px-4 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}
