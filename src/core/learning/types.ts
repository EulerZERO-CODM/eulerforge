/**
 * Learning layer domain model.
 *
 * Learning content is typed data, not prose in JSX: lessons, glossary concepts, tool explanations
 * and guided exercises are all validated records so they can be rendered in the learning hub, in a
 * contextual help panel inside a studio, and (later) inside tooltips and onboarding.
 *
 * There is no AI tutor and no adaptive engine in this phase. Content is curated and static, and the
 * UI says so.
 */

import type { Branded } from '../types/brand';

export type LessonId = Branded<string, 'LessonId'>;
export type ConceptId = Branded<string, 'ConceptId'>;
export type ToolExplanationId = Branded<string, 'ToolExplanationId'>;

export type LessonKind = 'concept' | 'tutorial' | 'tool' | 'guide';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export const LESSON_KIND_LABELS: Readonly<Record<LessonKind, string>> = {
  concept: 'Concept',
  tutorial: 'Tutorial',
  tool: 'Tool guide',
  guide: 'Guide',
};

export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/* -------------------------------------------------------------------------- */
/* Glossary concepts                                                          */
/* -------------------------------------------------------------------------- */

export type LearningConcept = {
  readonly id: ConceptId;
  readonly term: string;
  /** One sentence; used in tooltips and inline definitions. */
  readonly shortDefinition: string;
  /** Two to four sentences; used on the concept page and in the help panel. */
  readonly longDefinition: string;
  readonly whyItMatters: string;
  /** Alternative names a learner may meet elsewhere. */
  readonly alsoKnownAs: readonly string[];
  readonly relatedLessonSlugs: readonly string[];
};

/* -------------------------------------------------------------------------- */
/* Contextual tool explanations                                               */
/* -------------------------------------------------------------------------- */

export type ToolSettingExplanation = {
  readonly name: string;
  readonly whatItDoes: string;
  readonly whyItMatters: string;
  /** Concrete sensible values, so a beginner is not asked to guess. */
  readonly typicalValues: string;
  /** What professionals reach for instead once they outgrow the default. */
  readonly advancedAlternative?: string;
};

export type ToolExplanation = {
  readonly id: ToolExplanationId;
  /** Label as it appears in the interface, so lookups can be derived from UI labels. */
  readonly toolLabel: string;
  readonly summary: string;
  readonly whatItDoes: string;
  readonly whyUseIt: string;
  readonly settings: readonly ToolSettingExplanation[];
  readonly whenAdvancedIsAppropriate: readonly string[];
  readonly relatedConceptIds: readonly ConceptId[];
  readonly relatedLessonSlugs: readonly string[];
  readonly studioIds: readonly string[];
};

/* -------------------------------------------------------------------------- */
/* Lessons                                                                    */
/* -------------------------------------------------------------------------- */

export type LessonCalloutTone = 'tip' | 'note' | 'warning';

export type LessonSection =
  | { readonly type: 'prose'; readonly heading?: string; readonly body: readonly string[] }
  | {
      readonly type: 'steps';
      readonly heading: string;
      readonly steps: readonly { readonly title: string; readonly detail: string }[];
    }
  | {
      readonly type: 'terms';
      readonly heading: string;
      readonly terms: readonly { readonly term: string; readonly definition: string }[];
    }
  | {
      readonly type: 'compare';
      readonly heading: string;
      readonly columns: readonly [string, string];
      readonly rows: readonly {
        readonly label: string;
        readonly left: string;
        readonly right: string;
      }[];
    }
  | {
      readonly type: 'callout';
      readonly tone: LessonCalloutTone;
      readonly title: string;
      readonly body: string;
    }
  | {
      readonly type: 'checklist';
      readonly heading: string;
      readonly items: readonly {
        readonly id: string;
        readonly label: string;
        readonly why: string;
        /** Optional in-app destination; must be a real route or the entry is omitted. */
        readonly actionHref?: string;
        readonly actionLabel?: string;
      }[];
    }
  | { readonly type: 'toolSettings'; readonly heading: string; readonly toolId: ToolExplanationId }
  | { readonly type: 'roadmapNote'; readonly title: string; readonly body: string };

export type GuidedExercise = {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly estimatedMinutes: number;
  readonly steps: readonly {
    readonly id: string;
    readonly label: string;
    readonly detail: string;
  }[];
  /** Where the learner performs the exercise; `null` when it is done on paper/elsewhere. */
  readonly workspaceHref: string | null;
};

export type Lesson = {
  readonly id: LessonId;
  readonly slug: string;
  readonly kind: LessonKind;
  readonly title: string;
  readonly summary: string;
  readonly difficulty: Difficulty;
  readonly estimatedMinutes: number;
  /** Studio ids this lesson supports; empty means platform-wide. */
  readonly studioIds: readonly string[];
  readonly conceptIds: readonly ConceptId[];
  readonly tags: readonly string[];
  /** What you will be able to do afterwards. */
  readonly objectives: readonly string[];
  readonly prerequisites: readonly string[];
  readonly sections: readonly LessonSection[];
  readonly exercise?: GuidedExercise;
  readonly relatedLessonSlugs: readonly string[];
  readonly relatedAssetIds: readonly string[];
  readonly updatedAt: string;
  /** Honest status: `planned` lessons are listed as outlines, never as finished reading. */
  readonly status: 'published' | 'planned';
};
