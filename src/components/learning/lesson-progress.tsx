'use client';

import { Check, Circle, CircleCheckBig } from 'lucide-react';
import Link from 'next/link';

import type { GuidedExercise } from '../../core/learning/types';
import { cn } from '../../lib/cn';
import { useForgeServices } from '../../state/forge-provider';
import { useLessonProgress } from '../../state/hooks';
import { Button } from '../ui/button';
import { Progress } from '../ui/controls';

/**
 * Lesson progress and guided exercises.
 *
 * Progress is recorded locally for this device — the panel states that rather than implying an
 * account. Exercise steps are real checkboxes the learner ticks; nothing is auto-detected, because
 * claiming to "see" what a user did in the workspace would be a lie in this build.
 */
export function LessonCompletionToggle({ slug }: { readonly slug: string }) {
  const { learning, toasts } = useForgeServices();
  const progress = useLessonProgress(slug);
  const complete = progress.completedAt !== null;

  return (
    <Button
      variant={complete ? 'outline' : 'primary'}
      iconLeft={complete ? <CircleCheckBig aria-hidden /> : <Circle aria-hidden />}
      onClick={() => {
        const next = learning.toggleLesson(slug);
        if (next)
          toasts.success('Lesson marked complete', 'Progress is stored in this browser only.');
        else toasts.info('Completion cleared', 'You can mark it complete again at any time.');
      }}
    >
      {complete ? 'Completed — mark as in progress' : 'Mark lesson complete'}
    </Button>
  );
}

export function ExerciseChecklist({
  lessonSlug,
  exercise,
}: {
  readonly lessonSlug: string;
  readonly exercise: GuidedExercise;
}) {
  const { learning } = useForgeServices();
  const progress = useLessonProgress(lessonSlug);
  const done = exercise.steps.filter((step) => progress.steps.includes(step.id)).length;

  return (
    <section
      aria-labelledby="exercise-heading"
      className="border-line bg-surface-raised/60 space-y-3 rounded-md border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="exercise-heading" className="text-fg text-base font-semibold">
            Guided exercise: {exercise.title}
          </h2>
          <p className="text-fg-muted mt-0.5 text-sm">{exercise.goal}</p>
        </div>
        <span className="text-2xs text-fg-subtle">
          {exercise.estimatedMinutes === undefined ? null : `~${exercise.estimatedMinutes} min`}
        </span>
      </div>

      <Progress value={done} max={exercise.steps.length} label="Exercise steps completed" />

      <ul className="space-y-2">
        {exercise.steps.map((step) => {
          const complete = progress.steps.includes(step.id);
          return (
            <li key={step.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-2.5 transition-colors',
                  complete
                    ? 'border-mint-600/40 bg-mint-600/8'
                    : 'border-line bg-ink-950/40 hover:border-line-strong',
                )}
              >
                <input
                  type="checkbox"
                  checked={complete}
                  onChange={() => {
                    learning.toggleStep(lessonSlug, step.id);
                  }}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-xs border',
                    // The real input is visually hidden, so the visible box has to carry the focus
                    // ring itself: a keyboard reader would otherwise tab through the steps with no
                    // indication of where they are.
                    'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--color-focus)]',
                    complete ? 'border-mint-400 bg-mint-600 text-ink-1000' : 'border-line-strong',
                  )}
                >
                  {complete ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm', complete ? 'text-fg-muted' : 'text-fg')}>
                    {step.label}
                  </span>
                  <span className="text-fg-subtle mt-0.5 block text-xs">{step.detail}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {exercise.workspaceHref ? (
        <Button asChild variant="outline" size="sm">
          <Link href={exercise.workspaceHref}>
            {exercise.workspaceLinkLabel ?? 'Go to the workspace'}
          </Link>
        </Button>
      ) : null}

      <p className="text-2xs text-fg-subtle">
        Steps are yours to tick — Euler&rsquo;s Forge does not watch what you do in the workspace,
        and progress is not synced anywhere.
      </p>
    </section>
  );
}
