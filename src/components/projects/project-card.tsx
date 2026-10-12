'use client';

import { MoreHorizontal, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { ForgeDocument } from '../../core/documents/types';
import { DOCUMENT_STATUS_LABELS } from '../../core/documents/types';
import { aspectRatioLabel, megapixelLabel } from '../../core/documents/geometry';
import { formatRelative } from '../../lib/format';
import { getStudio } from '../../core/studios';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { ConfirmDialog } from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { IconButton } from '../ui/icon-button';
import { DocumentPreview } from '../documents/document-preview';

/**
 * Project card.
 *
 * Shows the document's real specification (canvas, ratio, resolution, guides) rather than a fake
 * artwork thumbnail, because no artwork exists yet. The delete action is a real, confirmed
 * destructive operation against local storage.
 */
export function ProjectCard({
  document,
  onDelete,
  className,
}: {
  readonly document: ForgeDocument;
  readonly onDelete: (document: ForgeDocument) => void;
  readonly className?: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const studio = getStudio(document.studioId);

  return (
    <article
      className={cn(
        'group border-line bg-surface-raised/60 hover:border-line-strong relative flex flex-col overflow-hidden rounded-md border transition-colors',
        className,
      )}
    >
      <div className="border-line-subtle flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-fg truncate text-base font-medium">
            <Link
              href={`/workspace/${document.id}`}
              className="rounded-xs after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-none"
            >
              {document.title}
            </Link>
          </h3>
          <p className="forge-numeric text-2xs text-fg-subtle">
            {document.canvas.width} × {document.canvas.height} · {aspectRatioLabel(document.canvas)}{' '}
            · {megapixelLabel(document.canvas)}
          </p>
        </div>
        <div className="relative z-10 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Actions for ${document.title}`} size="sm">
                <MoreHorizontal aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/workspace/${document.id}`}>Open workspace</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-rose-400 data-[highlighted]:text-rose-400"
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmOpen(true);
                }}
              >
                <Trash2 aria-hidden className="size-4" />
                Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="p-3">
        <DocumentPreview canvas={document.canvas} guides={document.guides} />
      </div>

      <div className="border-line-subtle mt-auto flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Badge tone={document.status === 'archived' ? 'planned' : 'neutral'}>
            {DOCUMENT_STATUS_LABELS[document.status]}
          </Badge>
          <span className="text-2xs text-fg-subtle">{studio?.name ?? document.studioId}</span>
        </div>
        <p className="text-2xs text-fg-subtle">Edited {formatRelative(document.updatedAt)}</p>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete “${document.title}”?`}
        description="This removes the project from this browser immediately. It cannot be undone, and there is no cloud copy to restore."
        confirmLabel="Delete project"
        onConfirm={() => {
          onDelete(document);
        }}
      >
        <p className="text-fg-muted text-sm">
          If you want to keep the document definition, open the workspace and export the project
          file first.
        </p>
      </ConfirmDialog>
    </article>
  );
}
