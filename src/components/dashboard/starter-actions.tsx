import { BookOpen, LayoutTemplate, PenLine, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { getCanvasPreset } from '../../core/documents/presets';
import { aspectRatioLabel } from '../../core/documents/geometry';
import { cn } from '../../lib/cn';

type StarterAction = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly detail: string;
  readonly href: string;
  readonly cta: string;
  readonly icon: ReactNode;
};

/**
 * Three concrete ways to begin.
 *
 * Each action leads to a screen that exists and does something: the creation flow with a preset
 * preselected, a tutorial that matches the current build, and the studio overview. No action here is
 * decorative, and none of them promise editing tools that have not shipped.
 */
export function StarterActions() {
  const square = getCanvasPreset('social.square');
  const thumbnail = getCanvasPreset('video.thumbnail');

  const actions: readonly StarterAction[] = [
    {
      id: 'blank',
      title: 'Start a blank document',
      description:
        'Choose a size, set your guides, and name the project. This is the fastest route into a real file.',
      detail: square
        ? `Pick from 13 presets — for example ${square.label} (${String(square.size.width)} × ${String(square.size.height)}, ${aspectRatioLabel(square.size)}) — or type exact millimetre sizes.`
        : 'Pick from 13 presets or type exact sizes.',
      href: '/create',
      cta: 'Open the creation flow',
      icon: <PenLine aria-hidden className="size-4" />,
    },
    {
      id: 'template',
      title: 'Begin from a starter layout',
      description:
        'Start from a documented layout shape instead of an empty page, with guides already set.',
      detail: thumbnail
        ? `${thumbnail.label}: subject area, title block and badge, at ${aspectRatioLabel(thumbnail.size)}.`
        : 'Starter layouts for social, video and print.',
      href: '/create?preset=video.thumbnail&starter=layout',
      cta: 'Use a starter layout',
      icon: <LayoutTemplate aria-hidden className="size-4" />,
    },
    {
      id: 'tutorial',
      title: 'Follow a beginner tutorial',
      description:
        'A 12-minute walkthrough that uses only features in this build, ending with an exported project file.',
      detail:
        'Covers canvas choice, units, guides, palette and the difference between local storage and a backup.',
      href: '/learn/your-first-project',
      cta: 'Start the tutorial',
      icon: <BookOpen aria-hidden className="size-4" />,
    },
  ];

  return (
    <ul className="grid gap-3 md:grid-cols-3">
      {actions.map((action) => (
        <li key={action.id}>
          <Link
            href={action.href}
            className={cn(
              'group border-line bg-surface-raised/60 flex h-full flex-col gap-3 rounded-md border p-4',
              'hover:border-line-strong focus-visible:border-line-strong transition-colors',
            )}
          >
            <span className="border-line bg-ink-900 text-accent inline-flex size-8 items-center justify-center rounded-sm border">
              {action.icon}
            </span>
            <span className="space-y-1">
              <span className="text-md text-fg block font-semibold">{action.title}</span>
              <span className="text-fg-muted block text-sm">{action.description}</span>
            </span>
            <span className="text-fg-subtle mt-auto block text-xs">{action.detail}</span>
            <span className="text-fg-muted group-hover:text-fg inline-flex items-center gap-1.5 text-sm font-medium">
              {action.cta}
              <Sparkles aria-hidden className="text-accent size-3.5" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
