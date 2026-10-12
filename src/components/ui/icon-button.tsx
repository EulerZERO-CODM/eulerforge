'use client';

import { Slot } from '@radix-ui/react-slot';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Required: icon-only controls must still have an accessible name. */
  readonly label: string;
  readonly size?: 'sm' | 'md';
  readonly variant?: 'quiet' | 'outline' | 'solid';
  readonly asChild?: boolean;
  readonly children: ReactNode;
};

/**
 * Icon-only button. `label` is mandatory so an icon-only control can never ship without an
 * accessible name — the tooltip and `aria-label` are both derived from it.
 */
export function IconButton({
  label,
  size = 'md',
  variant = 'quiet',
  asChild = false,
  className,
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      {...(asChild ? {} : { type })}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-sm transition-colors [&>svg]:size-4',
        size === 'sm' ? 'size-7' : 'size-9',
        variant === 'quiet' && 'text-fg-muted hover:bg-ink-850 hover:text-fg',
        variant === 'outline' &&
          'border-line-strong text-fg-muted hover:bg-ink-850 hover:text-fg border',
        variant === 'solid' && 'bg-ink-800 text-fg hover:bg-ink-700',
        'disabled:text-fg-subtle disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
