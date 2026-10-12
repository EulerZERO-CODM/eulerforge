import { describe, expect, it } from 'vitest';

import { SAMPLE_ASSETS } from './data';
import {
  computeFacets,
  computeTags,
  matchesFilter,
  normalisePage,
  normalisePageSize,
  paginate,
  relevanceScore,
  runAssetQuery,
  sortRecords,
} from './query';
import { DEFAULT_ASSET_PAGE_SIZE, type AssetQuery } from './types';

const first = SAMPLE_ASSETS[0];
if (!first) throw new Error('the sample catalogue must not be empty');

describe('normalisePage / normalisePageSize', () => {
  it('falls back to page 1 for missing or nonsensical page numbers', () => {
    expect(normalisePage(undefined)).toBe(1);
    expect(normalisePage(0)).toBe(1);
    expect(normalisePage(-3)).toBe(1);
    expect(normalisePage(Number.NaN)).toBe(1);
  });

  it('floors fractional page numbers', () => {
    expect(normalisePage(2.7)).toBe(2);
  });

  it('uses the documented default page size and caps it at 100', () => {
    expect(normalisePageSize(undefined)).toBe(DEFAULT_ASSET_PAGE_SIZE);
    expect(normalisePageSize(0)).toBe(DEFAULT_ASSET_PAGE_SIZE);
    expect(normalisePageSize(500)).toBe(100);
    expect(normalisePageSize(12.9)).toBe(12);
  });
});

describe('matchesFilter', () => {
  it('matches free text against names, tags, descriptions and licences', () => {
    const byName = SAMPLE_ASSETS.filter((record) => matchesFilter(record, { text: first.name }));
    expect(byName.map((record) => record.id)).toContain(first.id);
  });

  it('filters by kind, licence and status', () => {
    const templates = SAMPLE_ASSETS.filter((record) =>
      matchesFilter(record, { kinds: ['template'] }),
    );
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((record) => record.kind === 'template')).toBe(true);

    const planned = SAMPLE_ASSETS.filter((record) => matchesFilter(record, { status: 'planned' }));
    expect(planned.every((record) => record.status === 'planned')).toBe(true);
    expect(planned.length).toBeGreaterThan(0);
  });

  it('treats discipline-agnostic records as relevant to every studio', () => {
    const agnostic = SAMPLE_ASSETS.filter((record) => record.studioIds.length === 0);
    expect(agnostic.length).toBeGreaterThan(0);
    expect(matchesFilter(agnostic[0]!, { studioIds: ['photo'] })).toBe(true);
  });

  it('requires every requested tag to be present', () => {
    const tagged = SAMPLE_ASSETS.find((record) => record.tags.length >= 2);
    if (!tagged) throw new Error('expected at least one multi-tag record');
    const [tagA, tagB] = tagged.tags;
    expect(matchesFilter(tagged, { tags: [tagA!] })).toBe(true);
    expect(matchesFilter(tagged, { tags: [tagA!, tagB!] })).toBe(true);
    expect(matchesFilter(tagged, { tags: [tagA!, 'not-a-real-tag'] })).toBe(false);
  });

  it('does not apply a filter that was not requested', () => {
    for (const record of SAMPLE_ASSETS) {
      expect(matchesFilter(record, {})).toBe(true);
      expect(matchesFilter(record, { kinds: [] })).toBe(true);
    }
  });
});

describe('relevanceScore', () => {
  it('scores an exact name match above a description-only match', () => {
    const record = SAMPLE_ASSETS[0]!;
    expect(relevanceScore(record, record.name)).toBeGreaterThan(
      relevanceScore(record, record.description.slice(0, 12)),
    );
  });

  it('scores an empty query as zero', () => {
    expect(relevanceScore(SAMPLE_ASSETS[0]!, '   ')).toBe(0);
  });
});

describe('sortRecords', () => {
  it('sorts by name in both directions', () => {
    const ascending = sortRecords(SAMPLE_ASSETS, 'name-asc');
    const descending = sortRecords(SAMPLE_ASSETS, 'name-desc');
    expect(ascending[0]!.name.localeCompare(ascending[1]!.name)).toBeLessThanOrEqual(0);
    expect(descending[0]!.name.localeCompare(descending[1]!.name)).toBeGreaterThanOrEqual(0);
  });

  it('sorts by most recently added first', () => {
    const newest = sortRecords(SAMPLE_ASSETS, 'newest');
    const dates = newest.map((record) => record.provenance.addedAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it('does not mutate the input array', () => {
    const original = [...SAMPLE_ASSETS];
    sortRecords(SAMPLE_ASSETS, 'name-asc');
    expect(SAMPLE_ASSETS).toEqual(original);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, index) => `item-${index}`);

  it('reports totals, page sizes and neighbour flags', () => {
    const page = paginate(items, 1, 10);
    expect(page.items).toHaveLength(10);
    expect(page.totalItems).toBe(25);
    expect(page.totalPages).toBe(3);
    expect(page.hasNextPage).toBe(true);
    expect(page.hasPreviousPage).toBe(false);

    const last = paginate(items, 3, 10);
    expect(last.items).toHaveLength(5);
    expect(last.hasNextPage).toBe(false);
    expect(last.hasPreviousPage).toBe(true);
  });

  it('clamps a page number beyond the end instead of returning nothing', () => {
    const page = paginate(items, 99, 10);
    expect(page.page).toBe(3);
    expect(page.items).toHaveLength(5);
  });

  it('reports a single (empty) page for an empty result set', () => {
    const page = paginate([], 1, 10);
    expect(page.items).toEqual([]);
    expect(page.totalPages).toBe(1);
    expect(page.hasNextPage).toBe(false);
  });
});

describe('runAssetQuery', () => {
  it('filters, sorts and paginates in one pass', () => {
    const page = runAssetQuery(SAMPLE_ASSETS, { kinds: ['template'], pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.items.every((record) => record.kind === 'template')).toBe(true);
    expect(page.totalItems).toBeGreaterThan(2);
  });

  it('defaults to relevance when a search term is present and alphabetical otherwise', () => {
    const search = runAssetQuery(SAMPLE_ASSETS, { text: first.name, pageSize: 1 });
    expect(search.items[0]?.id).toBe(first.id);

    const browse = runAssetQuery(SAMPLE_ASSETS, { pageSize: SAMPLE_ASSETS.length });
    const names = browse.items.map((record) => record.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('returns an empty page when nothing matches', () => {
    const page = runAssetQuery(SAMPLE_ASSETS, { text: 'zzz-nothing-matches-this' });
    expect(page.items).toEqual([]);
    expect(page.totalItems).toBe(0);
  });
});

describe('computeFacets', () => {
  it('counts the facets of the current result set', () => {
    const query: AssetQuery = { studioIds: ['design'] };
    const facets = computeFacets(SAMPLE_ASSETS, query);
    expect(facets.total).toBe(runAssetQuery(SAMPLE_ASSETS, query).totalItems);
    expect(facets.studios.some((facet) => facet.value === 'design')).toBe(true);
  });

  it('ignores a facet dimension while counting that same dimension', () => {
    const allKinds = computeFacets(SAMPLE_ASSETS, {});
    const filteredKinds = computeFacets(SAMPLE_ASSETS, { kinds: ['template'] });

    // Selecting "templates" must not hide how many graphics a click would reveal.
    expect(filteredKinds.kinds.map((facet) => facet.value).sort()).toEqual(
      allKinds.kinds.map((facet) => facet.value).sort(),
    );
  });

  it('drops facets with no matching records', () => {
    const facets = computeFacets(SAMPLE_ASSETS, { status: 'planned' });
    expect(facets.kinds.every((facet) => facet.count > 0)).toBe(true);
  });

  it('returns zeroed facets for an empty catalogue', () => {
    expect(computeFacets([])).toEqual({ kinds: [], licenses: [], studios: [], total: 0 });
  });
});

describe('computeTags', () => {
  it('lists every tag with counts, most frequent first', () => {
    const tags = computeTags(SAMPLE_ASSETS);
    expect(tags.length).toBeGreaterThan(0);
    const counts = tags.map((entry) => entry.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(tags.every((entry) => entry.tag.length > 0)).toBe(true);
  });
});
