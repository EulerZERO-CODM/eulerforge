'use client';

import { Slot, Slottable } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'quiet' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-fg-inverse hover:bg-accent-hover active:bg-accent disabled:bg-ink-700 disabled:text-fg-subtle',
  secondary:
    'bg-ink-800 text-fg hover:bg-ink-700 active:bg-ink-800 disabled:bg-ink-850 disabled:text-fg-subtle',
  outline:
    'border border-line-strong bg-transparent text-fg hover:border-ink-600 hover:bg-ink-900 active:bg-ink-850 disabled:text-fg-subtle',
  quiet: 'bg-transparent text-fg-muted hover:bg-ink-850 hover:text-fg active:bg-ink-800',
  danger: 'bg-rose-600 text-ink-50 hover:bg-rose-400 hover:text-ink-1000 active:bg-rose-600',
  link: 'bg-transparent px-0 text-fg underline decoration-line-strong decoration-1 underline-offset-4 hover:decoration-accent',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3.5 text-base',
  lg: 'h-11 gap-2 px-5 text-md',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Renders the child element (for example a link) with button styling and semantics. */
  readonly asChild?: boolean;
  readonly loading?: boolean;
  /** Text announced while `loading`; falls back to the button content. */
  readonly loadingLabel?: string;
  readonly iconLeft?: ReactNode;
  readonly iconRight?: ReactNode;
  readonly fullWidth?: boolean;
};

/**
 * The single button primitive. All interactive affordances in the app build on it — including the
 * `asChild` form used to style links — so focus, disabled and loading behaviour stay consistent.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  asChild = false,
  loading = false,
  loadingLabel,
  iconLeft,
  iconRight,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || loading;
  const classes = cn(
    'relative inline-flex items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors',
    'disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
    variant === 'link' && 'h-auto',
    className,
  );

  const leading = loading ? (
    <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
  ) : (
    iconLeft && <span className="shrink-0 [&>svg]:size-4">{iconLeft}</span>
  );
  const trailing = iconRight && !loading && (
    <span className="shrink-0 [&>svg]:size-4">{iconRight}</span>
  );

  // `asChild` renders the caller's element (usually a link) with button styling. Icons are placed
  // around it with Radix's `Slottable`, which is the only way to pass more than one child through a
  // slot — a plain slot rejects anything but a single element child.
  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {leading}
        <Slottable>{children}</Slottable>
        {trailing}
      </Slot>
    );
  }

  return (
    <button
      type={type}
      disabled={isDisabled}
      {...(isDisabled ? { 'aria-disabled': true } : {})}
      {...(loading ? { 'aria-busy': true } : {})}
      className={classes}
      {...props}
    >
      {leading}
      {children}
      {trailing}
      {loading && loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
    </button>
  );
}
