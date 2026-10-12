'use client';

import { AlertTriangle, Info, Lightbulb, Route } from 'lucide-react';
import Link from 'next/link';

import type { LessonSection } from '../../core/learning/types';
import { requireToolExplanation } from '../../core/learning/query';
import { cn } from '../../lib/cn';
import { InlineNote } from '../ui/states';
import { ExerciseChecklist, LessonCompletionToggle } from './lesson-progress';

/**
 * Lesson renderer.
 *
 * Renders typed lesson sections. `toolSettings` blocks embed the same tool-explanation records the
 * workspace help panel uses, so a lesson and the interface can never describe a control differently.
 */
export function LessonView({
  slug,
  sections,
  objectives,
}: {
  readonly slug: string;
  readonly sections: readonly LessonSection[];
  readonly objectives: readonly string[];
}) {
  const exercise = sections.find((section) => section.type === 'checklist');

  return (
    <div className="space-y-8">
      <section
        aria-labelledby="objectives"
        className="border-line bg-surface-raised/60 rounded-md border p-4"
      >
        <h2
          id="objectives"
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          What you will be able to do
        </h2>
        <ul className="mt-2.5 space-y-1.5">
          {objectives.map((objective) => (
            <li key={objective} className="text-fg-muted flex gap-2.5 text-sm">
              <span aria-hidden className="bg-accent mt-1.5 size-1.5 shrink-0 rounded-full" />
              {objective}
            </li>
          ))}
        </ul>
      </section>

      {sections.map((section, index) => (
        <SectionRenderer key={`${section.type}-${String(index)}`} section={section} />
      ))}

      {exercise ? (
        <ExerciseChecklist
          lessonSlug={slug}
          exercise={{
            id: `${slug}.exercise`,
            title: 'Practice',
            goal: `Work through ${String(exercise.items.length)} steps using only features that exist in this build.`,
            estimatedMinutes: 8,
            steps: exercise.items.map((item) => ({
              id: item.id,
              label: item.label,
              detail: item.why,
            })),
            workspaceHref: '/projects',
          }}
        />
      ) : null}

      <div className="border-line flex flex-wrap items-center gap-2 border-t pt-5">
        <LessonCompletionToggle slug={slug} />
        <Link
          href="/learn"
          className="text-fg-muted hover:text-fg text-sm underline decoration-1 underline-offset-4"
        >
          Back to the learning hub
        </Link>
      </div>
    </div>
  );
}

function SectionRenderer({ section }: { readonly section: LessonSection }) {
  switch (section.type) {
    case 'prose':
      return (
        <section className="space-y-2.5">
          {section.heading ? (
            <h2 className="text-fg text-lg font-semibold">{section.heading}</h2>
          ) : null}
          {section.body.map((paragraph) => (
            <p key={paragraph} className="text-md text-fg-muted leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      );

    case 'steps':
      return (
        <section className="space-y-3">
          <h2 className="text-fg text-lg font-semibold">{section.heading}</h2>
          <ol className="space-y-3">
            {section.steps.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="forge-numeric border-line text-2xs text-fg-subtle mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-fg text-base font-medium">{step.title}</p>
                  <p className="text-fg-muted text-sm">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      );

    case 'terms':
      return (
        <section className="space-y-3">
          <h2 className="text-fg text-lg font-semibold">{section.heading}</h2>
          <dl className="divide-line-subtle border-line divide-y overflow-hidden rounded-md border">
            {section.terms.map((term) => (
              <div
                key={term.term}
                className="grid gap-1 px-3.5 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4"
              >
                <dt className="text-fg text-base font-medium">{term.term}</dt>
                <dd className="text-fg-muted text-sm">{term.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      );

    case 'compare':
      return (
        <section className="space-y-3">
          <h2 className="text-fg text-lg font-semibold">{section.heading}</h2>
          <div className="border-line overflow-x-auto rounded-md border">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="bg-ink-900/60">
                  <th scope="col" className="text-fg-subtle px-3.5 py-2 text-left font-medium">
                    &nbsp;
                  </th>
                  <th scope="col" className="text-fg px-3.5 py-2 text-left font-medium">
                    {section.columns[0]}
                  </th>
                  <th scope="col" className="text-fg px-3.5 py-2 text-left font-medium">
                    {section.columns[1]}
                  </th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.label} className="border-line-subtle border-t">
                    <th scope="row" className="text-fg-subtle px-3.5 py-2 text-left font-normal">
                      {row.label}
                    </th>
                    <td className="text-fg-muted px-3.5 py-2">{row.left}</td>
                    <td className="text-fg-muted px-3.5 py-2">{row.right}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );

    case 'callout': {
      const icons = {
        tip: <Lightbulb aria-hidden />,
        note: <Info aria-hidden />,
        warning: <AlertTriangle aria-hidden />,
      } as const;
      return (
        <InlineNote
          tone={section.tone === 'warning' ? 'warning' : section.tone === 'tip' ? 'tip' : 'info'}
          icon={icons[section.tone]}
          title={section.title}
        >
          <p>{section.body}</p>
        </InlineNote>
      );
    }

    case 'checklist':
      return (
        <section className="space-y-3">
          <h2 className="text-fg text-lg font-semibold">{section.heading}</h2>
          <ul className="space-y-2">
            {section.items.map((item) => (
              <li
                key={item.id}
                className="border-line bg-surface-raised/50 rounded-sm border px-3.5 py-2.5"
              >
                <p className="text-fg text-sm">{item.label}</p>
                <p className="text-fg-subtle mt-0.5 text-xs">{item.why}</p>
                {item.actionHref ? (
                  <Link
                    href={item.actionHref}
                    className="text-arc-300 hover:text-arc-400 mt-1.5 inline-block text-xs underline decoration-1 underline-offset-4"
                  >
                    {item.actionLabel ?? 'Open'}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      );

    case 'toolSettings': {
      const tool = requireToolExplanation(section.toolId);
      return (
        <section className="space-y-3">
          <h2 className="text-fg text-lg font-semibold">{section.heading}</h2>
          <p className="text-fg-muted text-sm">{tool.summary}</p>
          <dl className="space-y-2.5">
            {tool.settings.map((setting) => (
              <div
                key={setting.name}
                className="border-line bg-surface-raised/50 rounded-md border p-3.5"
              >
                <dt className="text-fg text-base font-medium">{setting.name}</dt>
                <dd className="text-fg-muted mt-1 space-y-1 text-sm">
                  <p>{setting.whatItDoes}</p>
                  <p>
                    <span className="text-fg-subtle">Typical values: </span>
                    {setting.typicalValues}
                  </p>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      );
    }

    case 'roadmapNote':
      return (
        <InlineNote tone="neutral" icon={<Route aria-hidden />} title={section.title}>
          <p>{section.body}</p>
        </InlineNote>
      );

    default: {
      const exhaustive: never = section;
      void exhaustive;
      return null;
    }
  }
}

/** Renders a lesson's prerequisite slugs as a short list. */
export function PrerequisiteList({ slugs }: { readonly slugs: readonly string[] }) {
  if (slugs.length === 0) return null;
  return (
    <p className={cn('text-fg-subtle text-xs')}>
      Best read after:{' '}
      {slugs.map((slug, index) => (
        <span key={slug}>
          {index > 0 ? ', ' : ''}
          <Link
            href={`/learn/${slug}`}
            className="hover:text-fg-muted underline decoration-1 underline-offset-2"
          >
            {slug.replace(/-/g, ' ')}
          </Link>
        </span>
      ))}
    </p>
  );
}
