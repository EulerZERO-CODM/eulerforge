import type { Metadata } from 'next';

import { WorkspaceView } from '../../../components/workspace/workspace-view';

export const metadata: Metadata = {
  title: 'Workspace',
  description:
    'Configure a design document: canvas, units, guides, palette, export readiness and project file download.',
};

/**
 * Workspace route.
 *
 * The document id is read from the path and resolved against local storage inside the client
 * component, so a missing or deleted project produces a real "not found" state rather than a
 * server error.
 */
export default async function WorkspacePage({
  params,
}: {
  readonly params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  return <WorkspaceView documentId={documentId} />;
}
