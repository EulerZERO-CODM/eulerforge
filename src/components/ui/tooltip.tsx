'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

/**
 * Tooltip.
 *
 * Used only for supplementary hints (keyboard shortcuts, icon labels) — never for information that
 * exists nowhere else, since tooltips are not reachable by touch or keyboard-only users. Radix
 * handles the `aria-describedby` wiring and dismiss behaviour.
 */
export function TooltipProvider({ children }: { readonly children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
}: {
  readonly content: ReactNode;
  readonly children: ReactNode;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="animate-fade-in border-line bg-surface-overlay text-fg-muted shadow-overlay z-50 max-w-64 rounded-sm border px-2 py-1 text-xs"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { Kbd, ShortcutHint } from './kbd';
