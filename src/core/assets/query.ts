/**
 * Catalogue query engine.
 *
 * Pure functions only: filtering, relevance scoring, sorting, pagination and facet counting. They
 * are shared by every catalogue adapter (the bundled sample adapter today, a remote adapter later),
 * which keeps "what counts as a match" identical wherever records come from.
 */

import { ASSET_KIND_LABELS, DEFAULT_ASSET_PAGE_SIZE } from './types';
import type {
  AssetFacets,
  AssetKind,
  AssetQuery,
  AssetRecord,
  AssetSortOrder,
  Page,
} from './types';

export function normalisePage(page: number | undefined): number {
  if (page === undefined || !Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

export function normalisePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined || !Number.isFinite(pageSize) || pageSize < 1) {
    return DEFAULT_ASSET_PAGE_SIZE;
  }
  return Math.min(Math.floor(pageSize), 100);
}

/** Haystack used for text search: name, tags, description, usage note and formats. */
function haystack(record: AssetRecord): string {
  return [
    record.name,
    record.description,
    record.usageNote,
    record.tags.join(' '),
    record.formats.join(' '),
    record.provenance.author,
    record.license.name,
  ]
    .join(' ')
    .toLowerCase();
}

/** Relevance score for a free-text query; 0 means "matched only through filters". */
export function relevanceScore(record: AssetRecord, text: string): number {
  const needle = text.trim().toLowerCase();
  if (!needle) return 0;
  let score = 0;
  if (record.name.toLowerCase().startsWith(needle)) score += 6;
  else if (record.name.toLowerCase().includes(needle)) score += 4;
  if (record.tags.some((tag) => tag.toLowerCase() === needle)) score += 3;
  if (record.description.toLowerCase().includes(needle)) score += 2;
  if (haystack(record).includes(needle)) score += 1;
  return score;
}

export function matchesFilter(record: AssetRecord, query: AssetQuery): boolean {
  const text = query.text?.trim().toLowerCase() ?? '';
  if (text && !haystack(record).includes(text)) return false;

  if (query.kinds && query.kinds.length > 0 && !query.kinds.includes(record.kind)) return false;

  if (query.studioIds && query.studioIds.length > 0) {
    // Discipline-agnostic assets (no studioIds) are always relevant.
    const appliestoStudio =
      record.studioIds.length === 0 || query.studioIds.some((id) => record.studioIds.includes(id));
    if (!appliestoStudio) return false;
  }

  if (
    query.licenseIds &&
    query.licenseIds.length > 0 &&
    !query.licenseIds.includes(record.license.id)
  ) {
    return false;
  }

  if (
    query.tags &&
    query.tags.length > 0 &&
    !query.tags.every((tag) => record.tags.includes(tag))
  ) {
    return false;
  }

  if (query.status && record.status !== query.status) return false;

  return true;
}

export function sortRecords(
  records: readonly AssetRecord[],
  sort: AssetSortOrder = 'relevance',
  text = '',
): readonly AssetRecord[] {
  const copy = [...records];
  switch (sort) {
    case 'name-asc':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return copy.sort((a, b) => b.name.localeCompare(a.name));
    case 'newest':
      return copy.sort((a, b) => b.provenance.addedAt.localeCompare(a.provenance.addedAt));
    case 'relevance':
    default:
      return copy.sort((a, b) => {
        const delta = relevanceScore(b, text) - relevanceScore(a, text);
        return delta !== 0 ? delta : a.name.localeCompare(b.name);
      });
  }
}

export function paginate<TItem>(
  items: readonly TItem[],
  page: number,
  pageSize: number,
): Page<TItem> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(normalisePage(page), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPreviousPage: safePage > 1,
  };
}

/** Runs a full catalogue query: filter → sort → paginate. */
export function runAssetQuery(
  records: readonly AssetRecord[],
  query: AssetQuery = {},
): Page<AssetRecord> {
  const text = query.text?.trim() ?? '';
  const filtered = records.filter((record) => matchesFilter(record, query));
  const sorted = sortRecords(filtered, query.sort ?? (text ? 'relevance' : 'name-asc'), text);
  return paginate(sorted, normalisePage(query.page), normalisePageSize(query.pageSize));
}

function countBy<TValue extends string>(
  records: readonly AssetRecord[],
  select: (record: AssetRecord) => readonly TValue[],
): Map<TValue, number> {
  const counts = new Map<TValue, number>();
  for (const record of records) {
    for (const value of select(record)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * Facet counts for the *current* result set.
 *
 * Each facet dimension ignores its own filter (standard multi-select behaviour): with "palettes"
 * selected you still see how many templates a "templates" click would add.
 */
export function computeFacets(
  records: readonly AssetRecord[],
  query: AssetQuery = {},
): AssetFacets {
  /** Same query without one dimension, so that dimension's own filter does not hide its counts. */
  const without = (key: 'kinds' | 'licenseIds' | 'studioIds'): AssetQuery => {
    const { [key]: _omitted, ...rest } = query;
    return rest;
  };

  const base = records.filter((record) => matchesFilter(record, query));

  const kindCounts = countBy(
    records.filter((record) => matchesFilter(record, without('kinds'))),
    (record) => [record.kind],
  );
  const licenseCounts = countBy(
    records.filter((record) => matchesFilter(record, without('licenseIds'))),
    (record) => [record.license.id],
  );
  const studioCounts = countBy(
    records.filter((record) => matchesFilter(record, without('studioIds'))),
    (record) => record.studioIds,
  );

  const kinds = (Object.keys(ASSET_KIND_LABELS) as AssetKind[])
    .map((value) => ({
      value,
      label: ASSET_KIND_LABELS[value],
      count: kindCounts.get(value) ?? 0,
    }))
    .filter((facet) => facet.count > 0);

  const licenses = [...licenseCounts.entries()]
    .map(([value, count]) => ({
      value,
      label: records.find((r) => r.license.id === value)?.license.name ?? value,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const studios = [...studioCounts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return { kinds, licenses, studios, total: base.length };
}

/** Every tag present in the catalogue, with counts, most frequent first. */
export function computeTags(
  records: readonly AssetRecord[],
): readonly { tag: string; count: number }[] {
  const counts = countBy(records, (record) => record.tags);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
