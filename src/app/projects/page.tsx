import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { ProjectLibrary } from '../../components/projects/project-library';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/section';

export const metadata: Metadata = {
  title: 'Projects',
  description: 'Every project stored in this browser, with search, filters and status.',
};

export default function ProjectsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Projects"
        lead="Projects live in this browser on this device. There is no account and no cloud copy — export a project file for anything you would be upset to lose."
        actions={
          <Button asChild variant="primary" iconLeft={<Plus aria-hidden />}>
            <Link href="/create">New project</Link>
          </Button>
        }
      />
      <ProjectLibrary />
    </div>
  );
}
