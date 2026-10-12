import type { Metadata } from 'next';
import Link from 'next/link';

import { LearningHub } from '../../components/learning/learning-hub';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/section';
import { listLessons } from '../../core/learning/query';

export const metadata: Metadata = {
  title: 'Learn',
  description:
    'Concepts, tutorials, tool explanations and guided exercises for design, photo, video, motion and illustration — integrated into the tools against the roadmap.',
};

export default function LearnPage() {
  const lessons = listLessons();
  const minutes = lessons.reduce((total, lesson) => total + lesson.estimatedMinutes, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Learn everything"
        lead={`${lessons.length} lessons, ${minutes} minutes of reading, plus contextual tool explanations that open inside the workspace. The second half of the product promise, built as typed content rather than a marketing page.`}
        actions={
          <>
            <Button asChild variant="primary">
              <Link href="/learn/your-first-project">Start with your first project</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/roadmap">What is coming next</Link>
            </Button>
          </>
        }
      />
      <LearningHub />
    </div>
  );
}
