'use client';

import { BookOpen, GraduationCap, Search, Target } from 'lucide-react';
import { useState } from 'react';

import { listConcepts, listLessons, lessonTags } from '../../core/learning/query';
import {
  DIFFICULTY_LABELS,
  LESSON_KIND_LABELS,
  type Difficulty,
  type LessonKind,
} from '../../core/learning/types';
import { studioRegistry } from '../../core/studios';
import { SegmentedControl, Progress } from '../ui/controls';
import { Field, Select } from '../ui/field';
import { Panel, SectionHeading } from '../ui/section';
import { EmptyState, InlineNote } from '../ui/states';
import { LessonCard } from './lesson-card';
import { useForgeServices } from '../../state/forge-provider';
import { useLearningProgress } from '../../state/hooks';

/**
 * Learning hub.
 *
 * Filters over the typed content set, a progress summary that reflects only locally recorded
 * completions, and an alphabetical glossary built from the concept records the lessons reference.
 */
export function LearningHub() {
  const { learning } = useForgeServices();
  useLearningProgress();

  const [kind, setKind] = useState<LessonKind | 'all'>('all');
  const [difficulty, setDifficulty] = useState<Difficulty | 'all'>('all');
  const [studio, setStudio] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);

  const lessons = listLessons({
    ...(kind === 'all' ? {} : { kinds: [kind] }),
    ...(difficulty === 'all' ? {} : { difficulties: [difficulty] }),
    ...(studio === 'all' ? {} : { studioId: studio }),
    ...(tag ? { tag } : {}),
    ...(query.trim() ? { text: query } : {}),
  });

  const allLessons = listLessons();
  const tags = lessonTags();
  const concepts = listConcepts();
  const completed = learning.completedLessonCount();
  const steps = learning.completedStepCount();

  return (
    <div className="space-y-8">
      <Panel className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" className="lg:col-span-2">
            <div className="relative">
              <Search
                aria-hidden
                className="text-fg-subtle pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Search lessons, concepts and objectives"
                aria-label="Search learning content"
                className="border-line-strong bg-ink-950 text-fg placeholder:text-fg-subtle focus:border-arc-500 h-9 w-full rounded-sm border pr-2.5 pl-8 text-base focus:outline-none"
              />
            </div>
          </Field>

          <Field label="Studio">
            <Select
              value={studio}
              onChange={(event) => {
                setStudio(event.target.value);
              }}
              options={[
                { value: 'all', label: 'Every studio' },
                ...studioRegistry.list().map((studioDefinition) => ({
                  value: studioDefinition.id,
                  label: studioDefinition.name,
                })),
              ]}
            />
          </Field>

          <Field label="Difficulty">
            <Select
              value={difficulty}
              onChange={(event) => {
                setDifficulty(event.target.value as Difficulty | 'all');
              }}
              options={[
                { value: 'all', label: 'Any level' },
                ...(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((value) => ({
                  value,
                  label: DIFFICULTY_LABELS[value],
                })),
              ]}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Lesson type"
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'All types', count: allLessons.length },
              ...(Object.keys(LESSON_KIND_LABELS) as LessonKind[]).map((value) => ({
                value,
                label: LESSON_KIND_LABELS[value],
                count: allLessons.filter((lesson) => lesson.kind === value).length,
              })),
            ]}
          />
          {tag ? (
            <button
              type="button"
              onClick={() => {
                setTag(null);
              }}
              className="border-line bg-ink-950 text-2xs text-fg-muted hover:border-line-strong inline-flex items-center gap-1.5 rounded-xs border px-2 py-1"
            >
              tag: {tag} ✕
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {tags.map((entry) => (
            <button
              key={entry.tag}
              type="button"
              aria-pressed={tag === entry.tag}
              onClick={() => {
                setTag(tag === entry.tag ? null : entry.tag);
              }}
              className={
                tag === entry.tag
                  ? 'border-accent bg-ink-900 text-2xs text-fg rounded-xs border px-2 py-0.5'
                  : 'border-line bg-ink-950 text-2xs text-fg-subtle hover:border-line-strong hover:text-fg-muted rounded-xs border px-2 py-0.5'
              }
            >
              {entry.tag}
              <span className="forge-numeric ml-1 opacity-70">{entry.count}</span>
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          <SectionHeading
            title={`${lessons.length} lesson${lessons.length === 1 ? '' : 's'}`}
            description="Every lesson here describes either features that exist in this build or concepts behind planned ones — and states which."
          />

          {lessons.length === 0 ? (
            <EmptyState
              icon={<BookOpen aria-hidden />}
              title="No lessons match those filters"
              description="Try clearing the search or choosing a different studio."
              actions={
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setKind('all');
                    setDifficulty('all');
                    setStudio('all');
                    setTag(null);
                  }}
                  className="bg-ink-800 text-fg hover:bg-ink-700 inline-flex h-9 items-center rounded-sm px-3.5 text-base font-medium"
                >
                  Clear filters
                </button>
              }
              size="sm"
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {lessons.map((lesson) => (
                <li key={lesson.slug}>
                  <LessonCard
                    lesson={lesson}
                    completed={learning.isComplete(lesson.slug)}
                    className="h-full"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="space-y-4">
          <Panel className="space-y-3 p-4">
            <h2 className="text-2xs text-fg-subtle inline-flex items-center gap-2 font-semibold tracking-wider uppercase">
              <Target aria-hidden className="size-3.5" />
              Your progress
            </h2>
            <Progress value={completed} max={allLessons.length} label="Lessons completed" />
            <p className="text-fg-subtle text-xs">
              {steps} exercise step{steps === 1 ? '' : 's'} ticked. Progress is stored in this
              browser only — there is no account to sync it to yet.
            </p>
          </Panel>

          <Panel className="space-y-3 p-4">
            <h2 className="text-2xs text-fg-subtle inline-flex items-center gap-2 font-semibold tracking-wider uppercase">
              <GraduationCap aria-hidden className="size-3.5" />
              Glossary
            </h2>
            <dl className="space-y-2.5">
              {concepts.map((concept) => (
                <div key={concept.id}>
                  <dt className="text-fg text-sm font-medium">{concept.term}</dt>
                  <dd className="text-fg-muted text-xs">{concept.shortDefinition}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <InlineNote tone="neutral">
            <p>
              Content is curated and static. There is no AI tutor, no adaptive difficulty and no
              claim that these are interactive lessons — exercises are checklists you tick yourself.
            </p>
          </InlineNote>
        </aside>
      </div>
    </div>
  );
}
