import { resolve } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LessonView } from './lesson-view';
import { LESSONS } from '../../core/learning/content';
import { requireLesson } from '../../core/learning/query';
import { ForgeProvider } from '../../state/forge-provider';
import { createTestServices } from '../../testing/forge-services';
import { collectAppRoutes, isRoutable } from '../../testing/routes';

const appDir = resolve(process.cwd(), 'src/app');
const routes = collectAppRoutes(appDir);

function renderLesson(slug: string) {
  const lesson = requireLesson(slug);
  // Progress tracking is part of the lesson view, so it runs against the real stores.
  return render(
    <ForgeProvider services={createTestServices()}>
      <LessonView slug={lesson.slug} sections={lesson.sections} objectives={lesson.objectives} />
    </ForgeProvider>,
  );
}

describe('LessonView', () => {
  it('renders the objectives the reader will achieve', () => {
    const lesson = requireLesson('canvas-and-units');
    renderLesson(lesson.slug);

    const objectives = screen.getByRole('heading', { name: /what you will be able to do/i });
    expect(objectives).toBeInTheDocument();
    for (const objective of lesson.objectives) {
      expect(screen.getByText(objective)).toBeInTheDocument();
    }
  });

  it('renders prose, terms and callouts from the lesson sections', () => {
    const lesson = requireLesson('canvas-and-units');
    const { container } = renderLesson(lesson.slug);

    for (const section of lesson.sections) {
      if (section.type === 'prose' && section.heading) {
        expect(screen.getByRole('heading', { name: section.heading })).toBeInTheDocument();
      }
      if (section.type === 'terms') {
        expect(screen.getByText(section.terms[0]!.term)).toBeInTheDocument();
      }
      if (section.type === 'callout' && section.title) {
        expect(screen.getByText(section.title)).toBeInTheDocument();
      }
    }
    expect(screen.getAllByRole('note').length).toBeGreaterThan(0);
    expect(container.textContent ?? '').not.toContain('undefined');
  });

  it('renders numbered steps in order', () => {
    const lesson = LESSONS.find((candidate) =>
      candidate.sections.some((section) => section.type === 'steps'),
    );
    if (!lesson) throw new Error('expected at least one lesson with steps');
    const { container } = renderLesson(lesson.slug);

    const stepSection = lesson.sections.find((section) => section.type === 'steps');
    if (!stepSection || stepSection.type !== 'steps') throw new Error('missing steps');
    expect(container.querySelectorAll('ol li').length).toBeGreaterThanOrEqual(
      stepSection.steps.length,
    );
  });

  it('links guided-exercise steps to routes the App Router serves', () => {
    const lesson = LESSONS.find((candidate) =>
      candidate.sections.some(
        (section) => section.type === 'checklist' && section.items.some((item) => item.actionHref),
      ),
    );
    if (!lesson) throw new Error('expected a lesson with linked exercise steps');
    renderLesson(lesson.slug);

    const links = screen.getAllByRole('link');
    const checklist = lesson.sections.find((section) => section.type === 'checklist');
    if (!checklist || checklist.type !== 'checklist') throw new Error('missing checklist');

    let checked = 0;
    for (const item of checklist.items) {
      if (!item.actionHref) continue;
      checked += 1;
      const link = links.find((candidate) => candidate.getAttribute('href') === item.actionHref);
      expect(link, `${item.id} → ${item.actionHref}`).toBeDefined();
      expect(isRoutable(appDir, item.actionHref, routes)).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('states plainly when a studio is not built yet instead of pretending', () => {
    const lesson = LESSONS.find((candidate) =>
      candidate.sections.some((section) => section.type === 'roadmapNote'),
    );
    expect(lesson).toBeDefined();
    if (!lesson) return;
    renderLesson(lesson.slug);

    const note = lesson.sections.find((section) => section.type === 'roadmapNote');
    if (!note || note.type !== 'roadmapNote') throw new Error('missing roadmap note');
    const card = screen.getByText(note.title).closest('[role="note"]');
    expect(card).not.toBeNull();
    if (card) expect(within(card as HTMLElement).getByText(note.body)).toBeInTheDocument();
  });
});
