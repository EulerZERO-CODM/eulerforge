import type { Metadata } from 'next';

import { ProjectLibrary } from '../../components/projects/project-library';
import { PageHeader } from '../../components/ui/section';

export const metadata: Metadata = {
  title: 'Projects',
  description: 'Every project stored in this browser, with search, filters and status.',
};

export default function ProjectsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      {/* No creation action in the header: the top bar already carries one on every page, and an
          empty library offers a contextual "Create a project" of its own. Three identical buttons
          competed for the same click. */}
      <PageHeader
        title="Projects"
        lead="Projects live in this browser on this device. There is no account and no cloud copy — export a project file for anything you would be upset to lose."
      />
      <ProjectLibrary />
    </div>
  );
}
