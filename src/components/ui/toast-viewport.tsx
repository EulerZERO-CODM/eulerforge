'use client';

import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';

import type { Toast, ToastTone } from '../../state/toast-store';
import { useForgeServices } from '../../state/forge-provider';
import { useToasts } from '../../state/hooks';
import { cn } from '../../lib/cn';
import { IconButton } from './icon-button';

const TONE_ICONS: Record<ToastTone, ReactNode> = {
  info: <Info aria-hidden />,
  success: <Check aria-hidden />,
  warning: <AlertTriangle aria-hidden />,
  error: <XCircle aria-hidden />,
};

const TONE_STYLES: Record<ToastTone, string> = {
  info: 'border-arc-600/50',
  success: 'border-mint-600/50',
  warning: 'border-amber-600/50',
  error: 'border-rose-600/50',
};

/**
 * Notification region.
 *
 * Rendered once by the shell. The container is an ARIA live region so assistive technology
 * announces new messages; auto-dismiss timers are cleared on unmount, and toasts that carry a
 * failure never auto-dismiss.
 */
export function ToastViewport() {
  const { toasts } = useForgeServices();
  const state = useToasts();

  useAutoDismiss(state.toasts);

  // The region is always mounted: a live region created at the same moment as its content is not
  // reliably announced, and an empty region costs nothing.
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-3 sm:right-3 sm:bottom-3 sm:left-auto sm:items-end sm:p-0"
    >
      {state.toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'animate-toast-in bg-surface-overlay shadow-overlay pointer-events-auto flex w-full max-w-sm gap-3 rounded-md border px-3.5 py-3',
            TONE_STYLES[toast.tone],
          )}
        >
          <span aria-hidden className="text-fg-muted mt-0.5 shrink-0 [&>svg]:size-4">
            {TONE_ICONS[toast.tone]}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-fg text-base font-medium">{toast.title}</p>
            {toast.description ? (
              <p className="text-fg-muted text-sm">{toast.description}</p>
            ) : null}
            {toast.action ? (
              toast.action.href ? (
                <Link
                  href={toast.action.href}
                  className="text-arc-300 hover:text-arc-400 inline-block text-sm underline decoration-1 underline-offset-4"
                >
                  {toast.action.label}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onSelect?.();
                    toasts.dismiss(toast.id);
                  }}
                  className="text-arc-300 hover:text-arc-400 text-sm underline decoration-1 underline-offset-4"
                >
                  {toast.action.label}
                </button>
              )
            ) : null}
          </div>
          <IconButton
            label="Dismiss notification"
            size="sm"
            onClick={() => {
              toasts.dismiss(toast.id);
            }}
          >
            <X aria-hidden />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

function useAutoDismiss(toasts: readonly Toast[]) {
  const { toasts: store } = useForgeServices();
  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.durationMs !== null)
      .map((toast) =>
        window.setTimeout(() => {
          store.dismiss(toast.id);
        }, toast.durationMs ?? 0),
      );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [toasts, store]);
}
