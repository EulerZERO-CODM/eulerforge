'use client';

import { useSyncExternalStore } from 'react';

import { Kbd } from '../ui/kbd';

/**
 * The platform's command key.
 *
 * The palette answers to both ⌘ and Ctrl, so a hint that only ever names ⌘ tells a Windows or
 * Linux reader about a key their keyboard does not have.
 *
 * The platform is only known in the browser, so the server render assumes the common case and the
 * client corrects it — the same approach the artboard takes for the device pixel ratio.
 */
function readAppleDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform;
  const agent = navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(agent);
}

/** The platform never changes while the page is open, so nothing has to subscribe. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

export function useIsAppleDevice(): boolean {
  return useSyncExternalStore(subscribeToNothing, readAppleDevice, () => false);
}

/** The key chip that opens the command palette, named for the platform the reader is on. */
export function CommandKeyHint() {
  const apple = useIsAppleDevice();
  return <Kbd>{apple ? '⌘K' : 'Ctrl K'}</Kbd>;
}
