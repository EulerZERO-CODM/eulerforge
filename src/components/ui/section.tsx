import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

/** Page-level header: title, lead paragraph and actions. Used by every top-level screen. */
export function PageHeader({
  title,
  lead,
  actions,
  meta,
  className,
}: {
  readonly title: string;
  readonly lead?: string | undefined;
  readonly actions?: ReactNode | undefined;
  readonly meta?: ReactNode | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <header
      className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}
    >
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-fg forge-text-balance text-2xl font-semibold">{title}</h1>
        {lead ? <p className="text-md text-fg-muted max-w-3xl">{lead}</p> : null}
        {meta ? (
          <div className="text-fg-subtle flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({
  title,
  description,
  actions,
  id,
  className,
  level = 2,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly actions?: ReactNode | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly level?: 2 | 3;
}) {
  const Heading = `h${level}` as const;
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading
          id={id}
          className={
            level === 2 ? 'text-fg text-lg font-semibold' : 'text-fg text-base font-semibold'
          }
        >
          {title}
        </Heading>
        {description ? (
          <p className="text-fg-muted mt-0.5 max-w-3xl text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Bordered content panel used across the shell, studio pages and inspector. */
export function Panel({
  children,
  className,
  as: Component = 'div',
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: 'div' | 'section' | 'aside';
}) {
  return (
    <Component className={cn('border-line bg-surface-raised/60 rounded-md border', className)}>
      {children}
    </Component>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'border-line-subtle flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-fg text-base font-semibold">{title}</h2>
        {description ? <p className="text-fg-muted mt-0.5 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Definition list for key/value metadata (canvas specs, licence details, diagnostics). */
export function DataList({
  items,
  className,
  columns = 1,
}: {
  readonly items: readonly {
    readonly label: string;
    readonly value: ReactNode;
    readonly mono?: boolean;
  }[];
  readonly className?: string;
  readonly columns?: 1 | 2;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-2.5',
        columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1',
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="border-line-subtle/60 flex items-baseline justify-between gap-4 border-b pb-2"
        >
          <dt className="text-fg-subtle text-xs">{item.label}</dt>
          <dd className={cn('text-fg text-right text-base', item.mono && 'forge-numeric')}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
