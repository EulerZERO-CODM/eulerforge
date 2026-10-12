'use client';

import { BadgeCheck, ChevronLeft, ChevronRight, Info, ShieldAlert, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import type {
  AssetFacets,
  AssetKind,
  AssetLicenseId,
  AssetQuery,
  AssetRecord,
  Page,
} from '../../core/assets/types';
import { ASSET_KIND_LABELS, DEFAULT_ASSET_PAGE_SIZE } from '../../core/assets/types';
import { studioRegistry } from '../../core/studios';
import { cn } from '../../lib/cn';
import { formatCount, formatDate } from '../../lib/format';
import { useForgeServices } from '../../state/forge-provider';
import { usePreferences } from '../../state/hooks';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { SwatchRow } from '../ui/controls';
import { Dialog, DialogContent } from '../ui/dialog';
import { Field, Select } from '../ui/field';
import { Panel } from '../ui/section';
import { EmptyState, ErrorState, InlineNote, SkeletonCard } from '../ui/states';

/**
 * Asset catalogue browser.
 *
 * Talks to the `AssetCatalog` boundary only: filtering, sorting, pagination and facet counts all
 * come from the adapter, so a remote catalogue can replace the bundled sample source without this
 * component changing. The catalogue's own notice (including "these are samples") is always shown.
 */
export function AssetCatalogue() {
  const { catalog, bus } = useForgeServices();
  const { preferences } = usePreferences();

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [licenseId, setLicenseId] = useState<string>('all');
  const [studioId, setStudioId] = useState<string>('all');
  const [sort, setSort] = useState<'relevance' | 'name-asc' | 'newest'>('relevance');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; page: Page<AssetRecord>; facets: AssetFacets }
  >({ status: 'loading' });
  const [selected, setSelected] = useState<AssetRecord | null>(null);

  const pageSize = preferences.cataloguePageSize || DEFAULT_ASSET_PAGE_SIZE;

  useEffect(() => {
    let cancelled = false;
    const assetQuery: AssetQuery = {
      page,
      pageSize,
      sort,
      ...(query.trim() ? { text: query } : {}),
      ...(kind === 'all' ? {} : { kinds: [kind] }),
      ...(licenseId === 'all' ? {} : { licenseIds: [licenseId as AssetLicenseId] }),
      ...(studioId === 'all' ? {} : { studioIds: [studioId] }),
    };

    void Promise.all([catalog.query(assetQuery), catalog.facets(assetQuery)]).then(
      ([pageResult, facetResult]) => {
        if (cancelled) return;
        if (!pageResult.ok) {
          setState({ status: 'error', message: pageResult.error.message });
          return;
        }
        if (!facetResult.ok) {
          setState({ status: 'error', message: facetResult.error.message });
          return;
        }
        setState({ status: 'ready', page: pageResult.value, facets: facetResult.value });
        bus.emit('catalogue:queried', {
          source: catalog.descriptor.id,
          total: pageResult.value.totalItems,
          page: pageResult.value.page,
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [bus, catalog, kind, licenseId, page, pageSize, query, sort, studioId]);

  /**
   * Every filter handler also returns to page 1: otherwise narrowing a filter could leave the user on
   * a page that no longer exists. Doing it in the handler (rather than an effect) keeps the index
   * change in the same render as the filter change.
   */
  const updateFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <InlineNote tone="neutral" icon={<Info aria-hidden />} title={catalog.descriptor.label}>
        <p>{catalog.descriptor.notice}</p>
      </InlineNote>

      <Panel className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" className="lg:col-span-2">
            <div className="relative">
              <Search
                aria-hidden
                className="text-fg-subtle pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <input
                value={query}
                onChange={(event) => {
                  updateFilter(() => {
                    setQuery(event.target.value);
                  });
                }}
                placeholder="Search names, tags and formats"
                aria-label="Search assets"
                className="border-line-strong bg-ink-950 text-fg placeholder:text-fg-subtle focus:border-arc-500 h-9 w-full rounded-sm border pr-2.5 pl-8 text-base focus:outline-none"
              />
            </div>
          </Field>

          <Field label="Licence">
            <Select
              value={licenseId}
              onChange={(event) => {
                updateFilter(() => {
                  setLicenseId(event.target.value);
                });
              }}
              options={[
                { value: 'all', label: 'Any licence' },
                ...(state.status === 'ready'
                  ? state.facets.licenses.map((facet) => ({
                      value: facet.value,
                      label: `${facet.label} (${String(facet.count)})`,
                    }))
                  : []),
              ]}
            />
          </Field>

          <Field label="Studio">
            <Select
              value={studioId}
              onChange={(event) => {
                updateFilter(() => {
                  setStudioId(event.target.value);
                });
              }}
              options={[
                { value: 'all', label: 'Every studio' },
                ...studioRegistry.list().map((studio) => ({
                  value: studio.id,
                  label: studio.name,
                })),
              ]}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(['all', ...(Object.keys(ASSET_KIND_LABELS) as AssetKind[])] as const).map((value) => {
              const facet =
                state.status === 'ready'
                  ? state.facets.kinds.find((entry) => entry.value === value)
                  : undefined;
              const count =
                value === 'all'
                  ? state.status === 'ready'
                    ? state.facets.total
                    : 0
                  : (facet?.count ?? 0);
              if (value !== 'all' && count === 0) return null;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onClick={() => {
                    updateFilter(() => {
                      setKind(value);
                    });
                  }}
                  className={cn(
                    'text-2xs rounded-xs border px-2 py-1 transition-colors',
                    kind === value
                      ? 'border-accent bg-ink-900 text-fg'
                      : 'border-line bg-ink-950 text-fg-subtle hover:border-line-strong hover:text-fg-muted',
                  )}
                >
                  {value === 'all' ? 'All kinds' : ASSET_KIND_LABELS[value]}
                  <span className="forge-numeric ml-1 opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          <Field label="Sort">
            <Select
              value={sort}
              onChange={(event) => {
                updateFilter(() => {
                  setSort(event.target.value as typeof sort);
                });
              }}
              options={[
                { value: 'relevance', label: 'Most relevant' },
                { value: 'name-asc', label: 'Name' },
                { value: 'newest', label: 'Newest' },
              ]}
            />
          </Field>
        </div>
      </Panel>

      {state.status === 'loading' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <SkeletonCard key={index} lines={3} />
          ))}
        </div>
      ) : state.status === 'error' ? (
        <ErrorState title="The catalogue could not be queried" description={state.message} />
      ) : state.page.items.length === 0 ? (
        <EmptyState
          icon={<Search aria-hidden />}
          title="No assets match those filters"
          description="The bundled sample catalogue is deliberately small. Clear the filters to see every record it contains."
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setKind('all');
                setLicenseId('all');
                setStudioId('all');
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {state.page.items.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(asset);
                  }}
                  className="border-line bg-surface-raised/60 hover:border-line-strong flex h-full w-full flex-col gap-2.5 rounded-md border p-3.5 text-left transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-fg text-base font-medium">{asset.name}</span>
                    <Badge tone={asset.status === 'sample' ? 'planned' : 'neutral'}>
                      {asset.status === 'sample' ? 'sample' : 'planned'}
                    </Badge>
                  </div>

                  <AssetPreviewBlock asset={asset} />

                  <p className="text-fg-muted text-sm">{asset.description}</p>

                  <div className="text-2xs text-fg-subtle mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
                    <span>{ASSET_KIND_LABELS[asset.kind]}</span>
                    <span aria-hidden>·</span>
                    <span>{asset.license.name}</span>
                    {asset.license.attributionRequired ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1 text-amber-400">
                          <ShieldAlert aria-hidden className="size-3" />
                          credit required
                        </span>
                      </>
                    ) : null}
                    {asset.provenance.verified ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-mint-400 inline-flex items-center gap-1">
                          <BadgeCheck aria-hidden className="size-3" />
                          verified
                        </span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1 text-amber-400">
                          <ShieldAlert aria-hidden className="size-3" />
                          unverified
                        </span>
                      </>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <nav
            className="flex flex-wrap items-center justify-between gap-3"
            aria-label="Catalogue pagination"
          >
            <p className="text-fg-subtle text-xs">
              Showing {state.page.items.length} of {formatCount(state.page.totalItems)} records ·
              page {state.page.page} of {state.page.totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!state.page.hasPreviousPage}
                onClick={() => {
                  setPage((current) => Math.max(1, current - 1));
                }}
                iconLeft={<ChevronLeft aria-hidden />}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!state.page.hasNextPage}
                onClick={() => {
                  setPage((current) => current + 1);
                }}
                iconRight={<ChevronRight aria-hidden />}
              >
                Next
              </Button>
            </div>
          </nav>
        </>
      )}

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected ? (
          <DialogContent
            title={selected.name}
            description={selected.description}
            size="md"
            footer={
              <Button
                variant="secondary"
                onClick={() => {
                  setSelected(null);
                }}
              >
                Close
              </Button>
            }
          >
            <div className="space-y-4">
              <AssetPreviewBlock asset={selected} />

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Detail label="Kind" value={ASSET_KIND_LABELS[selected.kind]} />
                <Detail label="Status" value={selected.status} />
                <Detail label="Licence" value={selected.license.name} />
                <Detail
                  label="Attribution"
                  value={selected.license.attributionRequired ? 'required' : 'not required'}
                />
                <Detail
                  label="Commercial use"
                  value={selected.license.commercialUse ? 'permitted' : 'not permitted'}
                />
                <Detail label="Share-alike" value={selected.license.shareAlike ? 'yes' : 'no'} />
                <Detail label="Provenance" value={selected.provenance.source} />
                <Detail label="Added" value={formatDate(selected.provenance.addedAt)} />
                <Detail label="Author" value={selected.provenance.author} />
                <Detail label="Verified" value={selected.provenance.verified ? 'yes' : 'no'} />
              </dl>

              <InlineNote tone={selected.license.attributionRequired ? 'warning' : 'neutral'}>
                <p>{selected.license.summary}</p>
              </InlineNote>

              <p className="text-fg-subtle text-xs">{selected.provenance.notes}</p>
              <p className="text-fg-muted text-xs">
                <span className="text-fg-subtle">Where it can be used: </span>
                {selected.usageNote}
              </p>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function AssetPreviewBlock({ asset }: { readonly asset: AssetRecord }) {
  switch (asset.preview.kind) {
    case 'swatch':
      return (
        <SwatchRow
          colors={asset.preview.colors}
          size="lg"
          label={`${asset.name} palette`}
          className="h-10"
        />
      );
    case 'layout':
      return (
        <div className="border-line bg-ink-950 flex h-10 items-stretch gap-1 rounded-xs border p-1">
          {asset.preview.blocks.map((block, index) => (
            <span
              key={`${block}-${String(index)}`}
              title={block}
              className={cn(
                'bg-ink-800 flex-1 rounded-xs',
                index === 0 && 'bg-ink-700',
                index === 1 && 'bg-ink-850',
              )}
            />
          ))}
        </div>
      );
    case 'glyph':
      return (
        <div className="border-line bg-ink-950 text-fg-muted flex h-10 items-center justify-center rounded-xs border text-xl">
          {asset.preview.glyph}
        </div>
      );
    case 'symbol':
      return (
        <div className="border-line bg-ink-950 text-fg-muted flex h-10 items-center justify-center rounded-xs border text-xl">
          {asset.preview.symbol}
        </div>
      );
    default:
      return null;
  }
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="border-line-subtle flex items-baseline justify-between gap-3 border-b pb-1.5">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-fg text-right">{value}</dd>
    </div>
  );
}
