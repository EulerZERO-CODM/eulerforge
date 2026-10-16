'use client';

import { ImagePlus, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { AssetRecord, Page } from '../../core/assets/types';
import { isPlaceable } from '../../core/assets/types';
import { DEFAULT_ASSET_PAGE_SIZE } from '../../core/assets/types';
import { useForgeServices } from '../../state/forge-provider';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { Input } from '../ui/field';
import { InlineNote, SkeletonCard } from '../ui/states';
import { cn } from '../../lib/cn';

export type GraphicPickerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPlace: (record: AssetRecord) => void;
};

/**
 * Graphic picker.
 *
 * Search, pagination and filtering run through the same `AssetCatalog` the library page uses, so the
 * editor cannot drift into showing a different catalogue. Only records with a real file are offered —
 * a metadata-only record is listed with the reason it cannot be placed instead of a dead button.
 *
 * Placing is a click, never a drag: dropping a graphic onto the artboard is not required to use it.
 */
export function GraphicPicker({ open, onOpenChange, onPlace }: GraphicPickerProps) {
  const { catalog } = useForgeServices();
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{
    /** Which query the payload belongs to, so a stale page is never shown as the current one. */
    readonly key: string;
    readonly result: Page<AssetRecord> | null;
    readonly error: string | null;
  } | null>(null);

  const key = [String(page), text, String(attempt)].join('|');

  // The effect only starts the request and subscribes to its outcome: every state write happens in a
  // promise callback, so searching cannot trigger a render cascade of its own.
  useEffect(() => {
    if (!open) return;
    let active = true;
    void catalog
      .query({
        kinds: ['graphic', 'texture'],
        page,
        pageSize: DEFAULT_ASSET_PAGE_SIZE,
        // `exactOptionalPropertyTypes`: the search term is omitted rather than passed as undefined.
        ...(text.length > 0 ? { text } : {}),
      })
      .then((result) => {
        if (!active) return;
        setResponse(
          result.ok
            ? { key, result: result.value, error: null }
            : { key, result: null, error: result.error.message },
        );
      });
    return () => {
      active = false;
    };
  }, [open, catalog, page, text, key]);

  const result = response?.result ?? null;
  const error = response?.key === key ? response.error : null;
  const loading = open && response?.key !== key;
  const placeable = useMemo(
    () => (result?.items ?? []).filter((record) => isPlaceable(record)),
    [result],
  );
  const referenceOnly = useMemo(
    () => (result?.items ?? []).filter((record) => !isPlaceable(record)),
    [result],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Place a graphic"
        description="Ten vector graphics are authored for this repository and ship with the build. Nothing is downloaded."
        size="lg"
      >
        <div className="space-y-4">
          <Input
            aria-label="Search graphics"
            placeholder="Search by name, tag or description"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setPage(1);
            }}
          />

          {error ? (
            <InlineNote tone="danger" title="The catalogue could not be read">
              <p>{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAttempt((value) => value + 1);
                }}
              >
                Try again
              </Button>
            </InlineNote>
          ) : null}

          {loading && result === null ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <SkeletonCard lines={3} />
              <SkeletonCard lines={3} />
            </div>
          ) : null}

          {placeable.length === 0 && !loading ? (
            <p className="text-fg-muted text-sm">
              No graphics match that search. Clear the search to see all ten.
            </p>
          ) : null}

          <ul className="grid gap-3 sm:grid-cols-2">
            {placeable.map((record) => (
              <li
                key={record.id}
                className="border-line bg-surface-raised/40 flex gap-3 rounded-sm border p-3"
              >
                <span
                  aria-hidden
                  className="border-line-subtle bg-ink-950 flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-sm border"
                >
                  {record.file ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local SVG thumbnail, not an optimised upload
                    <img
                      src={record.file.href}
                      alt=""
                      width={64}
                      height={64}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <ImagePlus aria-hidden className="text-fg-subtle" />
                  )}
                </span>

                <div className="min-w-0 space-y-1">
                  <p className="text-fg truncate text-sm font-medium">{record.name}</p>
                  <p className="text-fg-muted line-clamp-2 text-xs">{record.description}</p>
                  <p className="text-fg-subtle text-2xs">
                    {record.license.name}
                    {record.license.commercialUse ? '' : ' · non-commercial'}
                    {record.provenance.verified ? '' : ' · provenance unverified'}
                  </p>
                  {record.file ? (
                    <p className="forge-numeric text-fg-subtle text-2xs">
                      {record.file.width} × {record.file.height} ·{' '}
                      {(record.file.bytes / 1024).toFixed(1)} KB
                    </p>
                  ) : null}
                  {record.provenance.verified ? null : (
                    <p className="text-2xs flex items-center gap-1 text-amber-300">
                      <ShieldAlert aria-hidden className="size-3" /> Check the licence before
                      publishing.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onPlace(record);
                    }}
                  >
                    Place on canvas
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {referenceOnly.length > 0 ? (
            <InlineNote tone="info" title="Reference records in this result">
              <ul className="space-y-1">
                {referenceOnly.map((record) => (
                  <li key={record.id} className="text-2xs">
                    <span className="text-fg-muted font-medium">{record.name}</span> —{' '}
                    {record.usageNote}
                  </li>
                ))}
              </ul>
            </InlineNote>
          ) : null}

          {result && result.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={!result.hasPreviousPage}
                onClick={() => {
                  setPage((value) => Math.max(1, value - 1));
                }}
              >
                Previous
              </Button>
              <p className={cn('forge-numeric text-2xs text-fg-subtle')}>
                Page {result.page} of {result.totalPages} · {result.totalItems} records
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={!result.hasNextPage}
                onClick={() => {
                  setPage((value) => value + 1);
                }}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
