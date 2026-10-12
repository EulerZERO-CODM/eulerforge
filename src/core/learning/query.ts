/**
 * Learning content access layer.
 *
 * Keeps lookups, filtering and search in one place so the learning hub, the studio pages and the
 * in-workspace help panel all read the same content the same way.
 */

import { CONCEPTS, LESSONS, TOOL_EXPLANATIONS } from './content';
import type { Difficulty, LearningConcept, Lesson, LessonKind, ToolExplanation } from './types';

export type LessonFilter = {
  readonly kinds?: readonly LessonKind[];
  readonly difficulties?: readonly Difficulty[];
  readonly studioId?: string;
  readonly text?: string;
  readonly tag?: string;
};

export function listLessons(filter: LessonFilter = {}): readonly Lesson[] {
  const text = filter.text?.trim().toLowerCase() ?? '';
  return LESSONS.filter((lesson) => {
    if (filter.kinds && filter.kinds.length > 0 && !filter.kinds.includes(lesson.kind))
      return false;
    if (
      filter.difficulties &&
      filter.difficulties.length > 0 &&
      !filter.difficulties.includes(lesson.difficulty)
    ) {
      return false;
    }
    if (
      filter.studioId &&
      lesson.studioIds.length > 0 &&
      !lesson.studioIds.includes(filter.studioId)
    ) {
      return false;
    }
    if (filter.tag && !lesson.tags.includes(filter.tag)) return false;
    if (text) {
      const haystack = [
        lesson.title,
        lesson.summary,
        lesson.tags.join(' '),
        lesson.objectives.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (a.difficulty !== b.difficulty) {
      const order: Record<Difficulty, number> = { beginner: 0, intermediate: 1, advanced: 2 };
      return order[a.difficulty] - order[b.difficulty];
    }
    return a.estimatedMinutes - b.estimatedMinutes;
  });
}

export function getLesson(slug: string): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.slug === slug);
}

export function requireLesson(slug: string): Lesson {
  const lesson = getLesson(slug);
  if (!lesson) throw new Error(`Unknown lesson: ${slug}`);
  return lesson;
}

export function lessonsForStudio(studioId: string): readonly Lesson[] {
  return listLessons({ studioId });
}

export function conceptLessonsFor(conceptId: string): readonly Lesson[] {
  return LESSONS.filter((lesson) => lesson.conceptIds.some((id) => (id as string) === conceptId));
}

/** Lessons a reader should look at next: explicit related slugs first, then same-tag matches. */
export function relatedLessons(lesson: Lesson, limit = 3): readonly Lesson[] {
  const explicit = lesson.relatedLessonSlugs
    .map((slug) => getLesson(slug))
    .filter(
      (candidate): candidate is Lesson => candidate !== undefined && candidate.slug !== lesson.slug,
    );

  const supplementary = LESSONS.filter(
    (candidate) =>
      candidate.slug !== lesson.slug &&
      !explicit.some((found) => found.slug === candidate.slug) &&
      candidate.tags.some((tag) => lesson.tags.includes(tag)),
  );

  return [...explicit, ...supplementary].slice(0, limit);
}

export function listConcepts(): readonly LearningConcept[] {
  return [...CONCEPTS].sort((a, b) => a.term.localeCompare(b.term));
}

export function getConcept(id: string): LearningConcept | undefined {
  return CONCEPTS.find((concept) => (concept.id as string) === id);
}

export function getConcepts(ids: readonly string[]): readonly LearningConcept[] {
  return ids
    .map((id) => getConcept(id))
    .filter((concept): concept is LearningConcept => concept !== undefined);
}

export function getToolExplanation(id: string): ToolExplanation | undefined {
  return TOOL_EXPLANATIONS.find((tool) => (tool.id as string) === id);
}

export function requireToolExplanation(id: string): ToolExplanation {
  const tool = getToolExplanation(id);
  if (!tool) throw new Error(`Unknown tool explanation: ${id}`);
  return tool;
}

export function listToolExplanations(studioId?: string): readonly ToolExplanation[] {
  if (!studioId) return TOOL_EXPLANATIONS;
  return TOOL_EXPLANATIONS.filter(
    (tool) => tool.studioIds.length === 0 || tool.studioIds.includes(studioId),
  );
}

/** Every tag used across lessons, with counts, for the learning hub filter bar. */
export function lessonTags(): readonly { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const lesson of LESSONS) {
    for (const tag of lesson.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export type LearningIntegrityIssue = {
  readonly severity: 'error' | 'warning';
  readonly subject: string;
  readonly message: string;
};

/**
 * Structural checks over the content set. Asserted empty by the test suite so that content drift
 * (a lesson linking to a lesson that no longer exists, a studio referencing a missing lesson)
 * fails CI instead of shipping a dead link.
 */
export function validateLearningContent(): readonly LearningIntegrityIssue[] {
  const issues: LearningIntegrityIssue[] = [];
  const slugs = new Set(LESSONS.map((lesson) => lesson.slug));
  const conceptIds = new Set(CONCEPTS.map((concept) => concept.id as string));
  const toolIds = new Set(TOOL_EXPLANATIONS.map((tool) => tool.id as string));

  const seenSlugs = new Set<string>();
  for (const lesson of LESSONS) {
    if (seenSlugs.has(lesson.slug)) {
      issues.push({ severity: 'error', subject: lesson.slug, message: 'duplicate lesson slug' });
    }
    seenSlugs.add(lesson.slug);

    if (lesson.sections.length === 0) {
      issues.push({ severity: 'error', subject: lesson.slug, message: 'has no sections' });
    }
    if (lesson.objectives.length === 0) {
      issues.push({ severity: 'warning', subject: lesson.slug, message: 'declares no objectives' });
    }

    for (const related of lesson.relatedLessonSlugs) {
      if (!slugs.has(related)) {
        issues.push({
          severity: 'error',
          subject: lesson.slug,
          message: `links to unknown lesson "${related}"`,
        });
      }
    }
    for (const conceptId of lesson.conceptIds) {
      if (!conceptIds.has(conceptId)) {
        issues.push({
          severity: 'error',
          subject: lesson.slug,
          message: `references unknown concept "${String(conceptId)}"`,
        });
      }
    }
    for (const prerequisite of lesson.prerequisites) {
      if (!slugs.has(prerequisite)) {
        issues.push({
          severity: 'error',
          subject: lesson.slug,
          message: `lists unknown prerequisite "${prerequisite}"`,
        });
      }
    }

    const checklists = lesson.sections.filter((section) => section.type === 'checklist');
    const itemIds = new Set<string>();
    for (const section of checklists) {
      for (const item of section.items) {
        if (itemIds.has(item.id)) {
          issues.push({
            severity: 'error',
            subject: lesson.slug,
            message: `repeats exercise step id "${item.id}"`,
          });
        }
        itemIds.add(item.id);
        if (item.actionHref && !item.actionHref.startsWith('/')) {
          issues.push({
            severity: 'error',
            subject: lesson.slug,
            message: `exercise step "${item.id}" has a non-internal action href`,
          });
        }
      }
    }

    for (const section of lesson.sections) {
      if (section.type === 'toolSettings' && !toolIds.has(section.toolId)) {
        issues.push({
          severity: 'error',
          subject: lesson.slug,
          message: `embeds unknown tool explanation "${String(section.toolId)}"`,
        });
      }
    }
  }

  for (const tool of TOOL_EXPLANATIONS) {
    for (const slug of tool.relatedLessonSlugs) {
      if (!slugs.has(slug)) {
        issues.push({
          severity: 'error',
          subject: String(tool.id),
          message: `links to unknown lesson "${slug}"`,
        });
      }
    }
    for (const conceptId of tool.relatedConceptIds) {
      if (!conceptIds.has(conceptId)) {
        issues.push({
          severity: 'error',
          subject: String(tool.id),
          message: `references unknown concept "${String(conceptId)}"`,
        });
      }
    }
  }

  for (const concept of CONCEPTS) {
    for (const slug of concept.relatedLessonSlugs) {
      if (!slugs.has(slug)) {
        issues.push({
          severity: 'warning',
          subject: String(concept.id),
          message: `links to unknown lesson "${slug}"`,
        });
      }
    }
  }

  return issues;
}
