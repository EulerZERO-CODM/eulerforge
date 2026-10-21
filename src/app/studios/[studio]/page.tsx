import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, BookOpen, Cpu, PenLine, TriangleAlert } from 'lucide-react';

import { AssetStatusBadge } from '../../../components/assets/asset-status-badge';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { DataList, Panel, SectionHeading } from '../../../components/ui/section';
import { InlineNote } from '../../../components/ui/states';
import { AvailabilityBadge } from '../../../components/studios/availability';
import { CapabilityList } from '../../../components/studios/capability-list';
import { StudioGlyph } from '../../../components/studios/studio-icon';
import { StudioProjects } from '../../../components/studios/studio-projects';
import { SAMPLE_ASSETS } from '../../../core/assets/data';
import { getDocumentType } from '../../../core/documents/document-types';
import { outputFormatsFor } from '../../../core/export/formats';
import { lessonsForStudio } from '../../../core/learning/query';
import { ROADMAP } from '../../../core/platform/roadmap';
import { studioRegistry } from '../../../core/studios';

/**
 * Studio detail page.
 *
 * The same template serves an available studio and one that is entirely planned. For the latter, the
 * page is a truthful specification: what it will do, which engine it will use, which lessons teach
 * the concepts, and which roadmap phase it depends on — with no working editor implied.
 */
export function generateStaticParams() {
  return studioRegistry.list().map((studio) => ({ studio: studio.slug }));
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ studio: string }>;
}): Promise<Metadata> {
  const { studio: slug } = await params;
  const studio = studioRegistry.bySlug(slug);
  if (!studio) return { title: 'Studio not found' };
  return {
    title: studio.name,
    description: `${studio.tagline} ${studio.maturityNote}`,
  };
}

export default async function StudioPage({
  params,
}: {
  readonly params: Promise<{ studio: string }>;
}) {
  const { studio: slug } = await params;
  const studio = studioRegistry.bySlug(slug);
  if (!studio) notFound();

  const documentTypes = studio.documentTypes
    .map((id) => getDocumentType(id))
    .filter((type): type is NonNullable<typeof type> => type !== undefined);
  const lessons = lessonsForStudio(studio.id);
  const assets = SAMPLE_ASSETS.filter((asset) =>
    asset.studioIds.includes(studio.id as string),
  ).slice(0, 4);
  const roadmapItems = ROADMAP.flatMap((phase) =>
    phase.items
      .filter((item) => item.capabilityIds.some((id) => id.includes(studio.id)))
      .map((item) => ({ phase, item })),
  ).slice(0, 4);

  const isAvailable = studio.availability === 'available';

  return (
    <div className="mx-auto max-w-6xl space-y-9 px-4 py-8 sm:px-6">
      <header className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <StudioGlyph name={studio.icon} accent={studio.accent} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-fg text-2xl font-semibold">{studio.name}</h1>
              <AvailabilityBadge availability={studio.availability} />
            </div>
            <p className="text-md text-fg-muted mt-1">{studio.tagline}</p>
          </div>
        </div>

        <p className="text-md text-fg-muted max-w-3xl">{studio.purpose}</p>

        <InlineNote
          tone={isAvailable ? 'tip' : 'neutral'}
          icon={isAvailable ? <PenLine aria-hidden /> : <TriangleAlert aria-hidden />}
        >
          <p className="text-fg">{studio.maturityNote}</p>
        </InlineNote>

        <div className="flex flex-wrap gap-2">
          {isAvailable && studio.entry.route ? (
            <Button asChild variant="primary" iconRight={<ArrowRight aria-hidden />}>
              <Link href={`/create?studio=${studio.id as string}`}>Create a project</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href="/roadmap">See the roadmap for this studio</Link>
            </Button>
          )}
          {lessons[0] ? (
            <Button asChild variant="outline" iconLeft={<BookOpen aria-hidden />}>
              <Link href={`/learn/${lessons[0].slug}`}>Learn the concepts first</Link>
            </Button>
          ) : null}
          <Button asChild variant="quiet">
            <Link href="/studios">All studios</Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-8">
          <section className="space-y-4" aria-labelledby="capabilities">
            <SectionHeading
              id="capabilities"
              title="Capabilities"
              description="Grouped by real status. Nothing in the “ready to use” group is aspirational."
            />
            <CapabilityList capabilities={studio.capabilities} />
          </section>

          <section className="space-y-4" aria-labelledby="produces">
            <SectionHeading
              id="produces"
              title="What it is for"
              description="The kind of work this studio exists to produce."
            />
            <ul className="grid gap-2 sm:grid-cols-2">
              {studio.produces.map((item) => (
                <li
                  key={item}
                  className="border-line bg-surface-raised/50 text-fg-muted rounded-sm border px-3 py-2 text-sm"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {isAvailable ? (
            <section className="space-y-4" aria-labelledby="studio-projects">
              <SectionHeading
                id="studio-projects"
                title="Your projects in this studio"
                description="Documents you have created here, stored in this browser."
              />
              <StudioProjects studioId={studio.id} />
            </section>
          ) : null}

          {assets.length > 0 ? (
            <section className="space-y-4" aria-labelledby="studio-assets">
              <SectionHeading
                id="studio-assets"
                title="Sample catalogue entries for this studio"
                description="Placeholder records that document intended asset shapes — not usable files."
              />
              <ul className="grid gap-2 sm:grid-cols-2">
                {assets.map((asset) => (
                  <li
                    key={asset.id}
                    className="border-line bg-surface-raised/50 rounded-sm border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-fg text-base font-medium">{asset.name}</p>
                      <AssetStatusBadge status={asset.status} />
                    </div>
                    <p className="text-fg-muted mt-1 text-sm">{asset.description}</p>
                    <p className="text-2xs text-fg-subtle mt-1.5">Licence: {asset.license.name}</p>
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" size="sm">
                <Link href="/assets">Open the asset catalogue</Link>
              </Button>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <Panel className="p-4">
            <h2 className="text-2xs text-fg-subtle inline-flex items-center gap-2 font-semibold tracking-wider uppercase">
              <Cpu aria-hidden className="size-3.5" />
              Integration boundary
            </h2>
            <DataList
              className="mt-3"
              items={[
                { label: 'Renderer', value: studio.engine.renderer },
                { label: 'Pipeline', value: studio.engine.pipeline },
                { label: 'Code location', value: studio.engine.integrationPoint, mono: true },
              ]}
            />
            <p className="text-fg-subtle mt-3 text-xs">{studio.engine.rationale}</p>
          </Panel>

          <Panel className="p-4">
            <h2 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
              Document types and output
            </h2>
            <ul className="mt-3 space-y-3">
              {documentTypes.map((type) => (
                <li key={type.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="text-fg text-base font-medium">{type.label}</p>
                    <Badge tone={type.availability === 'available' ? 'available' : 'planned'}>
                      {type.availability === 'available' ? 'implemented' : 'planned'}
                    </Badge>
                  </div>
                  <p className="text-fg-muted text-xs">{type.description}</p>
                  <p className="text-2xs text-fg-subtle">Renderer: {type.renderer}</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {outputFormatsFor(type.id).map((format) => (
                      <li
                        key={format.id}
                        className={
                          format.status === 'available'
                            ? 'border-mint-600/40 bg-mint-600/10 text-2xs text-mint-400 rounded-xs border px-1.5 py-0.5'
                            : 'border-line bg-ink-950 text-2xs text-fg-subtle rounded-xs border px-1.5 py-0.5'
                        }
                      >
                        {format.label}
                        {format.status === 'planned' ? ' (planned)' : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Panel>

          {lessons.length > 0 ? (
            <Panel className="p-4">
              <h2 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
                Learning for this studio
              </h2>
              <ul className="mt-3 space-y-2">
                {lessons.map((lesson) => (
                  <li key={lesson.slug}>
                    <Link
                      href={`/learn/${lesson.slug}`}
                      className="border-line hover:border-line-strong block rounded-sm border px-2.5 py-2 transition-colors"
                    >
                      <span className="text-fg block text-sm">{lesson.title}</span>
                      <span className="text-2xs text-fg-subtle mt-0.5 block">
                        {lesson.difficulty} · {lesson.estimatedMinutes} min
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {roadmapItems.length > 0 ? (
            <Panel className="p-4">
              <h2 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
                On the roadmap
              </h2>
              <ul className="mt-3 space-y-2.5">
                {roadmapItems.map(({ phase, item }) => (
                  <li key={item.id}>
                    <p className="text-fg text-sm">{item.title}</p>
                    <p className="text-2xs text-fg-subtle">
                      {phase.name} · {item.status}
                    </p>
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href="/roadmap">Full roadmap</Link>
              </Button>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
