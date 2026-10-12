import { BookOpen, Clock } from 'lucide-react';
import Link from 'next/link';

import type { Lesson } from '../../core/learning/types';
import { DIFFICULTY_LABELS, LESSON_KIND_LABELS } from '../../core/learning/types';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';

const DIFFICULTY_TONES = {
  beginner: 'available',
  intermediate: 'progress',
  advanced: 'exploratory',
} as const;

export function LessonCard({
  lesson,
  completed = false,
  className,
}: {
  readonly lesson: Lesson;
  readonly completed?: boolean;
  readonly className?: string;
}) {
  return (
    <article
      className={cn(
        'group border-line bg-surface-raised/60 hover:border-line-strong relative flex flex-col gap-2.5 rounded-md border p-4 transition-colors',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{LESSON_KIND_LABELS[lesson.kind]}</Badge>
        <Badge tone={DIFFICULTY_TONES[lesson.difficulty]}>
          {DIFFICULTY_LABELS[lesson.difficulty]}
        </Badge>
        {completed ? <Badge tone="available">Completed</Badge> : null}
      </div>

      <h3 className="text-md text-fg font-semibold">
        <Link
          href={`/learn/${lesson.slug}`}
          className="rounded-xs after:absolute after:inset-0 after:content-['']"
        >
          {lesson.title}
        </Link>
      </h3>
      <p className="text-fg-muted text-sm">{lesson.summary}</p>

      <div className="text-2xs text-fg-subtle mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
        <span className="inline-flex items-center gap-1.5">
          <Clock aria-hidden className="size-3.5" />
          {lesson.estimatedMinutes} min
        </span>
        <span className="inline-flex items-center gap-1.5">
          <BookOpen aria-hidden className="size-3.5" />
          {lesson.sections.length} sections
        </span>
        {lesson.exercise ? <span>{lesson.exercise.steps.length}-step exercise</span> : null}
        <span className="ml-auto">{lesson.tags.slice(0, 2).join(' · ')}</span>
      </div>
    </article>
  );
}
