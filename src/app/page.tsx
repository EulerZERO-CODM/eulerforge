import { ArrowRight, CircleDot, Compass, Layers, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { KeyValuePill } from '../components/ui/controls';
import { SectionHeading } from '../components/ui/section';
import { InlineNote } from '../components/ui/states';
import { RecentProjects } from '../components/dashboard/recent-projects';
import { StarterActions } from '../components/dashboard/starter-actions';
import { StudioCard } from '../components/studios/studio-card';
import { listLessons } from '../core/learning/query';
import { capabilityCounts } from '../core/platform/status';
import { studioRegistry } from '../core/studios';

/**
 * Home dashboard.
 *
 * Answers the three questions a first-time visitor has, in order:
 *   1. What can I create here?            → the studio strip
 *   2. How do I start if I have never edited anything? → starter actions + tutorial
 *   3. Where do I go for more control?    → recent projects, studios, roadmap links
 *
 * The capability summary reports real counts from the platform ledger — there is no decorative
 * statistics block, and no number here is invented.
 */
export default function HomePage() {
  const studios = studioRegistry.list();
  const available = studioRegistry.listByAvailability('available');
  const upcoming = studios.filter((studio) => studio.availability !== 'available');
  const counts = capabilityCounts();
  const lessons = listLessons().slice(0, 3);

  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-8 sm:px-6 sm:py-10">
      <section className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent" withDot>
            Phase 2 · Design Studio editing
          </Badge>
          <span className="text-fg-subtle text-xs">
            Design Studio edits and exports real artwork · five studios designed and honest about
            their status
          </span>
        </div>

        <div className="max-w-3xl space-y-4">
          <h1 className="text-fg forge-text-balance text-4xl font-semibold">
            Create anything. Learn everything.
          </h1>
          <p className="text-md text-fg-muted">
            Euler&rsquo;s Forge is one creative platform that will grow across design, photo, video,
            motion and illustration — each discipline in its own specialist studio, all sharing one
            document model, one asset system and one learning layer. This build gives you the
            foundation and a real design workspace, and it is explicit about everything that is
            still to come.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="primary" size="lg" iconRight={<ArrowRight aria-hidden />}>
            <Link href="/create">Create a new project</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/learn/your-first-project">Start with the beginner tutorial</Link>
          </Button>
          <Button asChild variant="quiet" size="lg">
            <Link href="/platform-status">See what works today</Link>
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <KeyValuePill icon={<Layers aria-hidden />}>
            {available.length} studio available, {upcoming.length} designed
          </KeyValuePill>
          <KeyValuePill icon={<CircleDot aria-hidden />}>
            {counts.implemented} implemented capabilities, {counts.planned + counts.exploratory}{' '}
            planned or exploratory
          </KeyValuePill>
          <KeyValuePill icon={<ShieldCheck aria-hidden />}>
            Stored in this browser only — no account, no cloud
          </KeyValuePill>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="start-here">
        <SectionHeading
          id="start-here"
          title="Three ways to start"
          description="Pick whichever matches how much time you have and what you already know."
        />
        <StarterActions />
      </section>

      <section className="space-y-4" aria-labelledby="recent-projects">
        <SectionHeading
          id="recent-projects"
          title="Your projects"
          description="Everything here lives in this browser on this device. Export a project file to keep a copy somewhere else."
          actions={
            <Button asChild variant="outline" size="sm" iconRight={<ArrowRight aria-hidden />}>
              <Link href="/projects">All projects</Link>
            </Button>
          }
        />
        <RecentProjects />
      </section>

      <section className="space-y-4" aria-labelledby="studios">
        <SectionHeading
          id="studios"
          title="Studios"
          description="A studio is a specialist editing environment. Availability here is literal: only what can be opened is marked available."
          actions={
            <Button asChild variant="outline" size="sm" iconRight={<ArrowRight aria-hidden />}>
              <Link href="/studios">Compare studios</Link>
            </Button>
          }
        />
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...available, ...upcoming].slice(0, 3).map((studio) => (
            <li key={studio.id} className="relative">
              <StudioCard studio={studio} className="h-full" />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4" aria-labelledby="learn">
        <SectionHeading
          id="learn"
          title="Learn inside the work"
          description="Concepts, tool explanations and guided exercises are written content, not generated advice."
          actions={
            <Button asChild variant="outline" size="sm" iconRight={<ArrowRight aria-hidden />}>
              <Link href="/learn">Open the learning hub</Link>
            </Button>
          }
        />
        <ul className="grid gap-3 md:grid-cols-3">
          {lessons.map((lesson) => (
            <li key={lesson.slug}>
              <Link
                href={`/learn/${lesson.slug}`}
                className="border-line bg-surface-raised/60 hover:border-line-strong flex h-full flex-col rounded-md border p-4 transition-colors"
              >
                <span className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
                  {lesson.kind} · {lesson.estimatedMinutes} min
                </span>
                <span className="text-md text-fg mt-1.5 font-semibold">{lesson.title}</span>
                <span className="text-fg-muted mt-1 text-sm">{lesson.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <InlineNote
        tone="neutral"
        icon={<Compass aria-hidden />}
        title="Where this build is honest about itself"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/platform-status">Capability ledger</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/roadmap">Roadmap</Link>
            </Button>
          </>
        }
      >
        <p>
          Photo, Video, Motion, Illustration and 3D have entry points, capability lists and engine
          plans — and no working editors. Raster export, accounts and cloud sync do not exist
          either. Each of those places says so in the interface, and the roadmap shows the
          dependency chain that has to land first.
        </p>
      </InlineNote>
    </div>
  );
}
