'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuSeparator = ({ className }: { readonly className?: string }) => (
  <DropdownMenuPrimitive.Separator className={cn('bg-line-subtle my-1 h-px', className)} />
);

export function DropdownMenuContent({
  children,
  align = 'end',
  sideOffset = 6,
  className,
}: {
  readonly children: ReactNode;
  readonly align?: 'start' | 'center' | 'end';
  readonly sideOffset?: number;
  readonly className?: string;
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'animate-scale-in border-line bg-surface-overlay shadow-overlay z-50 min-w-56 rounded-md border p-1',
          className,
        )}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuLabel({ children }: { readonly children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Label className="text-2xs text-fg-subtle px-2 py-1.5 font-medium tracking-wide uppercase">
      {children}
    </DropdownMenuPrimitive.Label>
  );
}

const ITEM_BASE =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-base text-fg-muted outline-none select-none ' +
  'data-[highlighted]:bg-ink-800 data-[highlighted]:text-fg data-[disabled]:cursor-not-allowed data-[disabled]:text-fg-subtle';

export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
  className,
  asChild = false,
}: {
  readonly children: ReactNode;
  readonly onSelect?: (event: Event) => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly asChild?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Item
      {...(onSelect ? { onSelect } : {})}
      {...(disabled === undefined ? {} : { disabled })}
      asChild={asChild}
      className={cn(ITEM_BASE, className)}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
}: {
  readonly children: ReactNode;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(ITEM_BASE, 'pr-2 pl-7')}
    >
      <DropdownMenuPrimitive.ItemIndicator className="absolute left-2 flex items-center">
        <Check aria-hidden className="text-accent size-3.5" />
      </DropdownMenuPrimitive.ItemIndicator>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: string;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem value={value} className={cn(ITEM_BASE, 'pr-2 pl-7')}>
      <DropdownMenuPrimitive.ItemIndicator className="absolute left-2 flex items-center">
        <Check aria-hidden className="text-accent size-3.5" />
      </DropdownMenuPrimitive.ItemIndicator>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
