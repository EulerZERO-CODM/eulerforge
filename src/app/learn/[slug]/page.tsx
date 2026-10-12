import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock, Layers } from 'lucide-react';

import { LessonView, PrerequisiteList } from '../../../components/learning/lesson-view';
import { LessonCard } from '../../../components/learning/lesson-card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { LESSONS } from '../../../core/learning/content';
import { getConcept, getLesson, relatedLessons } from '../../../core/learning/query';
import { DIFFICULTY_LABELS, LESSON_KIND_LABELS } from '../../../core/learning/types';
import { getStudio } from '../../../core/studios';
import { formatDate } from '../../../lib/format';

export function generateStaticParams() {
  return LESSONS.map((lesson) => ({ slug: lesson.slug }));
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lesson = getLesson(slug);
  if (!lesson) return { title: 'Lesson not found' };
  return { title: lesson.title, description: lesson.summary };
}

export default async function LessonPage({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lesson = getLesson(slug);
  if (!lesson) notFound();

  const related = relatedLessons(lesson);
  const concepts = lesson.conceptIds
    .map((id) => getConcept(id as string))
    .filter((concept): concept is NonNullable<typeof concept> => concept !== undefined);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="quiet" size="sm" iconLeft={<ArrowLeft aria-hidden />}>
          <Link href="/learn">Learning hub</Link>
        </Button>
      </div>

      <header className="border-line space-y-4 border-b pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{LESSON_KIND_LABELS[lesson.kind]}</Badge>
          <Badge tone="progress">{DIFFICULTY_LABELS[lesson.difficulty]}</Badge>
          <span className="text-fg-subtle inline-flex items-center gap-1.5 text-xs">
            <Clock aria-hidden className="size-3.5" />
            {lesson.estimatedMinutes} min
          </span>
          <span className="text-fg-subtle inline-flex items-center gap-1.5 text-xs">
            <Layers aria-hidden className="size-3.5" />
            {lesson.studioIds.length > 0
              ? lesson.studioIds.map((id) => getStudio(id)?.name ?? id).join(', ')
              : 'Platform-wide'}
          </span>
        </div>

        <h1 className="text-fg forge-text-balance text-3xl font-semibold">{lesson.title}</h1>
        <p className="text-md text-fg-muted max-w-3xl">{lesson.summary}</p>
        <PrerequisiteList slugs={lesson.prerequisites} />
        <p className="text-2xs text-fg-subtle">
          Curated content · last reviewed {formatDate(lesson.updatedAt)}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <article className="min-w-0">
          <LessonView
            slug={lesson.slug}
            sections={lesson.sections}
            objectives={lesson.objectives}
          />
        </article>

        <aside className="space-y-4">
          {concepts.length > 0 ? (
            <section
              className="border-line bg-surface-raised/60 rounded-md border p-4"
              aria-labelledby="concepts"
            >
              <h2
                id="concepts"
                className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
              >
                Concepts in this lesson
              </h2>
              <dl className="mt-3 space-y-3">
                {concepts.map((concept) => (
                  <div key={concept.id}>
                    <dt className="text-fg text-sm font-medium">{concept.term}</dt>
                    <dd className="text-fg-muted mt-0.5 text-xs">{concept.longDefinition}</dd>
                    <dd className="text-fg-subtle mt-1 text-xs">
                      <span className="text-fg-subtle">Why it matters: </span>
                      {concept.whyItMatters}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {related.length > 0 ? (
            <section aria-labelledby="related">
              <h2
                id="related"
                className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
              >
                Read next
              </h2>
              <ul className="mt-3 space-y-2">
                {related.map((item) => (
                  <li key={item.slug}>
                    <LessonCard lesson={item} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** Content is static, so an unknown slug is a 404 rather than an on-demand render. */
export const dynamicParams = false;
