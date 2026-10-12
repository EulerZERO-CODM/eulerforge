'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { IconButton } from './icon-button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogContentProps = {
  readonly children: ReactNode;
  readonly className?: string;
  readonly size?: 'sm' | 'md' | 'lg';
  /** Accessible name. Required — a dialog without a name is unusable with a screen reader. */
  readonly title: string;
  readonly description?: string;
  readonly footer?: ReactNode;
  readonly showCloseButton?: boolean;
};

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

/**
 * Modal dialog built on Radix: focus trapping, scroll locking, escape handling and
 * `aria-modal` wiring come from the primitive; the styling comes from the design tokens.
 */
export function DialogContent({
  children,
  className,
  size = 'md',
  title,
  description,
  footer,
  showCloseButton = true,
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="animate-fade-in bg-ink-1000/70 fixed inset-0 z-50 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          'animate-scale-in fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2',
          'forge-scroll border-line bg-surface-overlay shadow-overlay max-h-[min(85vh,44rem)] overflow-y-auto rounded-lg border',
          SIZES[size],
          className,
        )}
      >
        <div className="border-line-subtle flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-md text-fg font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-fg-muted mt-0.5 text-sm">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {showCloseButton ? (
            <DialogPrimitive.Close asChild>
              <IconButton label="Close dialog" size="sm">
                <X aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          ) : null}
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="border-line-subtle flex items-center justify-end gap-2 border-t px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Confirmation dialog for destructive or irreversible actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  tone = 'danger',
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly tone?: 'danger' | 'primary';
  readonly children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="text-fg-muted hover:bg-ink-800 hover:text-fg inline-flex h-9 items-center rounded-sm px-3.5 text-base font-medium transition-colors"
              >
                Cancel
              </button>
            </DialogPrimitive.Close>
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              className={cn(
                'inline-flex h-9 items-center rounded-sm px-3.5 text-base font-medium transition-colors',
                tone === 'danger'
                  ? 'text-ink-50 hover:text-ink-1000 bg-rose-600 hover:bg-rose-400'
                  : 'bg-accent text-fg-inverse hover:bg-accent-hover',
              )}
            >
              {confirmLabel}
            </button>
          </>
        }
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
