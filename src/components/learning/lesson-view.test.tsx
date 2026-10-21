import { resolve } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      <LessonView
        slug={lesson.slug}
        sections={lesson.sections}
        objectives={lesson.objectives}
        {...(lesson.exercise ? { exercise: lesson.exercise } : {})}
      />
    </ForgeProvider>,
  );
}

/** The guided-exercise panel, found through the heading the panel labels itself with. */
function exercisePanel(): HTMLElement {
  const heading = document.getElementById('exercise-heading');
  const panel = heading?.closest('section');
  if (!panel) throw new Error('the lesson should render a guided exercise panel');
  return panel as HTMLElement;
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

describe('guided exercises', () => {
  it('renders the exercise a lesson declares, so the card and the page agree', () => {
    const lesson = requireLesson('your-first-project');
    if (!lesson.exercise) throw new Error('this lesson should declare an exercise');
    renderLesson(lesson.slug);

    // The lesson card advertises "N-step exercise"; the page has to offer that exercise.
    expect(
      screen.getByRole('heading', { name: `Guided exercise: ${lesson.exercise.title}` }),
    ).toBeInTheDocument();
    for (const step of lesson.exercise.steps) {
      expect(screen.getAllByText(step.label).length).toBeGreaterThan(0);
    }
  });

  it('lets the reader tick the steps of a declared exercise', async () => {
    const lesson = requireLesson('your-first-project');
    if (!lesson.exercise) throw new Error('this lesson should declare an exercise');
    renderLesson(lesson.slug);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(lesson.exercise.steps.length);

    const first = checkboxes[0];
    if (!first) throw new Error('the exercise should offer a first step');
    expect(first).not.toBeChecked();
    await userEvent.click(first);
    expect(first).toBeChecked();
  });

  it('does not state a second, different duration for the same exercise', () => {
    const lesson = requireLesson('canvas-and-units');
    renderLesson(lesson.slug);

    // The checklist heading states how long the exercise takes. A second number in the panel would
    // contradict it on the same screen.
    expect(
      screen.getByRole('heading', { name: /guided exercise \(\d+ minutes\)/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/~\d+ min/)).not.toBeInTheDocument();
  });

  it('opens the screen the exercise step points at, and names it accurately', () => {
    const lesson = requireLesson('canvas-and-units');
    renderLesson(lesson.slug);

    const checklist = lesson.sections.find((section) => section.type === 'checklist');
    if (!checklist || checklist.type !== 'checklist') throw new Error('missing checklist');
    const destination = checklist.items.find((item) => item.actionHref);
    if (!destination) throw new Error('the exercise should point at a screen');

    const panel = exercisePanel();
    const link = within(panel).getByRole('link', { name: destination.actionLabel ?? '' });
    expect(link).toHaveAttribute('href', destination.actionHref);
    // A button that says "Go to the workspace" and opens the project library misdirects the reader.
    expect(within(panel).queryByText('Go to the workspace')).not.toBeInTheDocument();
  });
});
