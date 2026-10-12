'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from '../ui/icon-button';
import { SidebarNav } from './sidebar-nav';

/**
 * Mobile navigation drawer.
 *
 * Reuses `SidebarNav` rather than duplicating the navigation model, so desktop and small screens
 * can never disagree about destinations or active state.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <IconButton label="Open navigation" variant="quiet" className="lg:hidden">
          <Menu aria-hidden />
        </IconButton>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in bg-ink-1000/70 fixed inset-0 z-50 lg:hidden" />
        <DialogPrimitive.Content className="animate-slide-in forge-scroll border-line bg-surface fixed inset-y-0 left-0 z-50 w-[17rem] overflow-y-auto border-r p-4 lg:hidden">
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Global navigation for Euler&rsquo;s Forge
          </DialogPrimitive.Description>
          <div className="mb-2 flex justify-end">
            <DialogPrimitive.Close asChild>
              <IconButton label="Close navigation" size="sm">
                <X aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <SidebarNav
            onNavigate={() => {
              setOpen(false);
            }}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
