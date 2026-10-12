import { Aperture, Boxes, Film, LayoutTemplate, PenTool, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import type { StudioAccent, StudioIconName } from '../../core/studios/types';
import { cn } from '../../lib/cn';

/**
 * Icon resolution for the studio registry.
 *
 * The registry stores an icon *name* (it is framework-free) and this module — the only place that
 * knows about icon components — resolves it. Elements are created at module scope rather than during
 * render, and `STUDIO_ICONS` is exported so a test can assert every registry icon name resolves.
 */
export const STUDIO_ICONS: Record<StudioIconName, ReactNode> = {
  layout: <LayoutTemplate />,
  aperture: <Aperture />,
  film: <Film />,
  keyframe: <Sparkles />,
  pen: <PenTool />,
  cube: <Boxes />,
};

export const STUDIO_ACCENT_CLASSES: Record<StudioAccent, string> = {
  cobalt: 'text-cobalt-400 border-cobalt-600/40 bg-cobalt-600/10',
  ember: 'text-ember-400 border-ember-600/40 bg-ember-600/10',
  plum: 'text-plum-400 border-plum-600/40 bg-plum-600/10',
  teal: 'text-teal-400 border-teal-600/40 bg-teal-600/10',
  violet: 'text-violet-400 border-violet-600/40 bg-violet-600/10',
  slate: 'text-fg-muted border-line-strong bg-ink-850',
};

export function StudioGlyph({
  name,
  accent,
  className,
  size = 'md',
}: {
  readonly name: StudioIconName;
  readonly accent: StudioAccent;
  readonly className?: string | undefined;
  readonly size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm border',
        size === 'sm' && 'size-7 [&>svg]:size-3.5',
        size === 'md' && 'size-9 [&>svg]:size-4',
        size === 'lg' && 'size-11 [&>svg]:size-5',
        STUDIO_ACCENT_CLASSES[accent],
        className,
      )}
    >
      {STUDIO_ICONS[name]}
    </span>
  );
}
