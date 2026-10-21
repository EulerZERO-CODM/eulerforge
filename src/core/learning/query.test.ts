import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONCEPTS, LESSONS, TOOL_EXPLANATIONS } from './content';
import {
  conceptLessonsFor,
  getConcept,
  getConcepts,
  getLesson,
  getToolExplanation,
  lessonTags,
  lessonsForStudio,
  listConcepts,
  listLessons,
  listToolExplanations,
  relatedLessons,
  requireLesson,
  requireToolExplanation,
  validateLearningContent,
} from './query';
import { collectAppRoutes, isRoutable } from '../../testing/routes';

const appDir = resolve(process.cwd(), 'src/app');
const routes = collectAppRoutes(appDir);

describe('learning content integrity', () => {
  it('passes every structural check', () => {
    // Covers duplicate slugs, dangling prerequisites/related lessons, unknown concepts, unknown
    // embedded tool explanations and non-internal exercise links.
    expect(validateLearningContent()).toEqual([]);
  });

  it('ships concepts, tool explanations and published lessons', () => {
    expect(CONCEPTS.length).toBeGreaterThan(0);
    expect(TOOL_EXPLANATIONS.length).toBeGreaterThan(0);
    expect(LESSONS.filter((lesson) => lesson.status === 'published').length).toBeGreaterThanOrEqual(
      10,
    );
  });

  it('gives every lesson a slug that can be used as a URL segment', () => {
    for (const lesson of LESSONS) {
      expect(lesson.slug, lesson.title).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('points every exercise link at a route the App Router serves', () => {
    for (const lesson of LESSONS) {
      if (lesson.exercise?.workspaceHref) {
        expect(isRoutable(appDir, lesson.exercise.workspaceHref, routes), lesson.slug).toBe(true);
      }
      for (const section of lesson.sections) {
        if (section.type !== 'checklist') continue;
        for (const item of section.items) {
          if (!item.actionHref) continue;
          expect(
            isRoutable(appDir, item.actionHref, routes),
            `${lesson.slug} → ${item.actionHref}`,
          ).toBe(true);
        }
      }
    }
  });

  it('does not claim studio-specific lessons for studios that do not exist', () => {
    const knownStudios = new Set(['design', 'photo', 'video', 'motion', 'illustration', 'three-d']);
    for (const lesson of LESSONS) {
      for (const studioId of lesson.studioIds) {
        expect(knownStudios.has(studioId), `${lesson.slug} → ${studioId}`).toBe(true);
      }
    }
  });
});

describe('listLessons', () => {
  it('sorts beginners first, then by estimated time', () => {
    const lessons = listLessons();
    const order = { beginner: 0, intermediate: 1, advanced: 2 } as const;
    for (let index = 1; index < lessons.length; index += 1) {
      const previous = lessons[index - 1]!;
      const current = lessons[index]!;
      const byDifficulty = order[previous.difficulty] - order[current.difficulty];
      expect(
        byDifficulty < 0 ||
          (byDifficulty === 0 && previous.estimatedMinutes <= current.estimatedMinutes),
      ).toBe(true);
    }
  });

  it('filters by kind and difficulty', () => {
    const tutorials = listLessons({ kinds: ['tutorial'] });
    expect(tutorials.length).toBeGreaterThan(0);
    expect(tutorials.every((lesson) => lesson.kind === 'tutorial')).toBe(true);

    const beginner = listLessons({ difficulties: ['beginner'] });
    expect(beginner.length).toBeGreaterThan(0);
    expect(beginner.every((lesson) => lesson.difficulty === 'beginner')).toBe(true);
  });

  it('matches free text across titles, summaries, tags and objectives', () => {
    const target = LESSONS[0]!;
    expect(listLessons({ text: target.title }).map((lesson) => lesson.slug)).toContain(target.slug);
    expect(listLessons({ text: 'zzz-nothing' })).toEqual([]);
  });

  it('finds a lesson by the name of a concept it teaches', () => {
    // The glossary is shown beside the search box, so a term the reader can see has to be
    // findable: without this, searching a visible term returns nothing.
    const concept = CONCEPTS[0]!;
    const lessons = listLessons({ text: concept.term });
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.some((lesson) => lesson.conceptIds.includes(concept.id))).toBe(true);
  });

  it('keeps platform-wide lessons when filtering by studio', () => {
    const design = listLessons({ studioId: 'design' });
    expect(design.length).toBeGreaterThan(0);
    expect(
      design.every(
        (lesson) => lesson.studioIds.length === 0 || lesson.studioIds.includes('design'),
      ),
    ).toBe(true);
  });

  it('filters by tag and exposes the tag index', () => {
    const tag = lessonTags()[0]?.tag;
    expect(tag).toBeDefined();
    if (!tag) return;
    const filtered = listLessons({ tag });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((lesson) => lesson.tags.includes(tag))).toBe(true);
  });
});

describe('lesson lookup', () => {
  it('finds a lesson by slug and throws for unknown slugs through requireLesson', () => {
    const first = LESSONS[0]!;
    expect(getLesson(first.slug)?.title).toBe(first.title);
    expect(getLesson('not-a-lesson')).toBeUndefined();
    expect(() => requireLesson('not-a-lesson')).toThrow(/Unknown lesson/);
  });

  it('lists lessons that onboard into a studio', () => {
    const design = lessonsForStudio('design');
    expect(design.map((lesson) => lesson.slug)).toContain('canvas-and-units');
  });

  it('lists lessons that teach a concept', () => {
    const concept = CONCEPTS[0]!;
    const lessons = conceptLessonsFor(concept.id);
    expect(lessons.length).toBeGreaterThan(0);
    for (const lesson of lessons) {
      expect(lesson.conceptIds).toContain(concept.id);
    }
  });

  it('suggests related lessons without repeating the current one', () => {
    const lesson = requireLesson('canvas-and-units');
    const related = relatedLessons(lesson, 3);
    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(3);
    expect(related.map((candidate) => candidate.slug)).not.toContain(lesson.slug);
    expect(new Set(related.map((candidate) => candidate.slug)).size).toBe(related.length);
  });
});

describe('concepts and tool explanations', () => {
  it('sorts concepts alphabetically and resolves them by id', () => {
    const terms = listConcepts().map((concept) => concept.term);
    expect([...terms].sort((a, b) => a.localeCompare(b))).toEqual(terms);
  });

  it('returns only the concepts that exist, in the requested order', () => {
    const [first, second] = CONCEPTS;
    if (!first || !second) throw new Error('expected at least two concepts');
    expect(getConcept(first.id)?.term).toBe(first.term);
    expect(
      getConcepts([second.id, 'missing-concept', first.id]).map((concept) => concept.id),
    ).toEqual([second.id, first.id]);
  });

  it('resolves tool explanations by id and by studio', () => {
    const tool = TOOL_EXPLANATIONS[0]!;
    expect(getToolExplanation(tool.id)?.toolLabel).toBe(tool.toolLabel);
    expect(getToolExplanation('tool.nope')).toBeUndefined();
    expect(() => requireToolExplanation('tool.nope')).toThrow(/Unknown tool explanation/);

    const scoped = listToolExplanations('design');
    expect(scoped.length).toBeGreaterThan(0);
    expect(listToolExplanations('three-d')).toEqual([]);
  });
});
