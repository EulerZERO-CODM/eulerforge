'use client';

import { useEffect } from 'react';

import { usePreferences } from '../../state/hooks';

/**
 * Applies the user's motion preference to the document element.
 *
 * `system` removes the attribute entirely so the CSS `prefers-reduced-motion` query governs, which
 * keeps the OS setting authoritative instead of duplicating it in app state.
 */
export function MotionPreferenceSync() {
  const { preferences } = usePreferences();

  useEffect(() => {
    const root = document.documentElement;
    if (preferences.motion === 'system') {
      root.removeAttribute('data-motion');
    } else {
      root.dataset.motion = preferences.motion;
    }
  }, [preferences.motion]);

  return null;
}
