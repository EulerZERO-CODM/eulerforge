'use client';

import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Segmented control.
 *
 * Behaves as a group of toggle buttons with `aria-pressed`, which is the correct semantic for
 * "filter this list" — a tablist would promise panel switching that does not happen here.
 * Arrow keys move between options.
 */
export type SegmentedControlOption<TValue extends string> = {
  readonly value: TValue;
  readonly label: string;
  readonly count?: number;
};

export function SegmentedControl<TValue extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  readonly options: readonly SegmentedControlOption<TValue>[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
  readonly label: string;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'border-line bg-ink-950 inline-flex flex-wrap items-center gap-1 rounded-md border p-1',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              selected
                ? 'bg-ink-800 text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
                : 'text-fg-muted hover:bg-ink-900 hover:text-fg',
            )}
          >
            {option.label}
            {option.count === undefined ? null : (
              <span className="forge-numeric text-2xs text-fg-subtle">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Progress bar with an accessible value label. */
export function Progress({
  value,
  max = 100,
  label,
  className,
  tone = 'accent',
}: {
  readonly value: number;
  readonly max?: number;
  readonly label: string;
  readonly className?: string;
  readonly tone?: 'accent' | 'mint';
}) {
  const percent = max <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="text-fg-subtle flex items-baseline justify-between text-xs">
        <span>{label}</span>
        <span className="forge-numeric">
          {value}/{max}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="bg-ink-800 h-1.5 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            tone === 'accent' ? 'bg-accent' : 'bg-mint-600',
          )}
          style={{ width: `${String(percent)}%` }}
        />
      </div>
    </div>
  );
}

/** Colour swatch row used by palettes, asset previews and the inspector. */
export function SwatchRow({
  colors,
  className,
  size = 'md',
  label,
}: {
  readonly colors: readonly string[];
  readonly className?: string | undefined;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly label?: string | undefined;
}) {
  return (
    <div
      className={cn('flex items-center gap-1', className)}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {colors.map((color) => (
        <span
          key={color}
          title={color}
          style={{ backgroundColor: color }}
          className={cn(
            'border-line-strong/60 rounded-xs border',
            size === 'sm' && 'size-3.5',
            size === 'md' && 'size-6',
            size === 'lg' && 'h-10 flex-1',
          )}
        />
      ))}
    </div>
  );
}

/** Status dot used in lists and diagnostics. */
export function StatusDot({
  tone,
  label,
}: {
  readonly tone: 'ok' | 'warn' | 'error' | 'idle';
  readonly label: string;
}) {
  const colors = {
    ok: 'bg-mint-400',
    warn: 'bg-amber-400',
    error: 'bg-rose-400',
    idle: 'bg-ink-600',
  } as const;
  return (
    <span className="text-fg-muted inline-flex items-center gap-1.5 text-xs">
      <span aria-hidden className={cn('size-1.5 rounded-full', colors[tone])} />
      {label}
    </span>
  );
}

export function KeyValuePill({
  children,
  icon,
}: {
  readonly children: ReactNode;
  readonly icon?: ReactNode;
}) {
  return (
    <span className="border-line bg-ink-950 text-fg-muted inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs">
      {icon ? (
        <span aria-hidden className="[&>svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
