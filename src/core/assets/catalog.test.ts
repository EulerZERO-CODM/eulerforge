import { describe, expect, it } from 'vitest';

import { UnavailableAssetCatalog, createAssetCatalog } from './catalog';
import { SAMPLE_ASSETS } from './data';
import { LICENSES } from './licenses';
import { getStudio } from '../studios';

const sample = createAssetCatalog('sample');
const empty = createAssetCatalog('empty');

describe('createAssetCatalog', () => {
  it('builds a labelled sample catalogue', async () => {
    const page = await sample.query({ pageSize: 100 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;

    expect(page.value.totalItems).toBe(SAMPLE_ASSETS.length);
    expect(sample.descriptor.source).toBe('bundled-sample');
    expect(sample.descriptor.notice).toMatch(/sample/i);
    expect(sample.descriptor.notice).toMatch(/not a production asset library/i);
  });

  it('builds an intentionally empty catalogue for the empty-state build', async () => {
    const page = await empty.query();

    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toEqual([]);
    expect(page.value.totalItems).toBe(0);
    expect(empty.descriptor.source).toBe('empty');
    expect(empty.descriptor.notice).toMatch(/NEXT_PUBLIC_FORGE_CATALOG_SOURCE=empty/);
  });

  it('finds a record by id and reports unknown ids as null', async () => {
    const first = SAMPLE_ASSETS[0];
    if (!first) throw new Error('sample catalogue is empty');

    const found = await sample.get(first.id);
    expect(found.ok && found.value?.name).toBe(first.name);

    const missing = await sample.get('asset.does-not-exist' as typeof first.id);
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.value).toBeNull();
  });

  it('serves studio-scoped records and respects the limit', async () => {
    const result = await sample.forStudio('design', 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBeLessThanOrEqual(3);
    for (const record of result.value) {
      expect(record.studioIds.length === 0 || record.studioIds.includes('design')).toBe(true);
    }
  });

  it('returns facets and tags through the same boundary', async () => {
    const facets = await sample.facets({ kinds: ['template'] });
    expect(facets.ok).toBe(true);
    if (facets.ok) expect(facets.value.total).toBeGreaterThan(0);

    const tags = await sample.tags();
    expect(tags.ok).toBe(true);
    if (tags.ok) expect(tags.value.length).toBeGreaterThan(0);
  });
});

describe('sample catalogue honesty', () => {
  it('labels every record with provenance, a licence and a usage note', () => {
    for (const record of SAMPLE_ASSETS) {
      expect(record.provenance.source, record.name).not.toBe('');
      expect(record.provenance.addedAt, record.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.provenance.notes, record.name).not.toBe('');
      expect(record.license.summary, record.name).not.toBe('');
      expect(record.usageNote, record.name).not.toBe('');
      expect(record.description, record.name).not.toBe('');
    }
  });

  it('never claims a bundled third-party file', () => {
    for (const record of SAMPLE_ASSETS) {
      if (record.license.id === 'forge-sample') continue;
      // Anything under a third-party licence must still be a planned record, not a shipped file.
      expect(record.status, `${record.name} ships under ${record.license.id}`).toBe('planned');
    }
  });

  it('marks planned records as not bundled', () => {
    const planned = SAMPLE_ASSETS.filter((record) => record.status === 'planned');
    expect(planned.length).toBeGreaterThan(0);
    for (const record of planned) {
      expect(record.provenance.source, record.name).toBe('catalogue');
      expect(record.provenance.notes, record.name).toMatch(/not bundled|unverified provenance/i);
    }
  });

  it('keeps at least one unverified record so the provenance warning has a real example', () => {
    const unverified = SAMPLE_ASSETS.filter((record) => !record.provenance.verified);
    expect(unverified.length).toBeGreaterThan(0);
    for (const record of unverified) expect(record.usageNote).toMatch(/unverified/i);
  });

  it('states the restriction of the sample licence in plain language', () => {
    const sampleLicense = LICENSES['forge-sample'];
    expect(sampleLicense.commercialUse).toBe(false);
    expect(sampleLicense.summary).toMatch(/do not ship it in commercial work/i);
  });

  it('covers every licence the catalogue references', () => {
    for (const record of SAMPLE_ASSETS) {
      expect(Object.keys(LICENSES)).toContain(record.license.id);
    }
  });

  it('only references studios that exist in the registry', () => {
    for (const record of SAMPLE_ASSETS) {
      for (const studioId of record.studioIds) {
        // The other direction matters too: the studio page lists catalogue records for its id.
        expect(getStudio(studioId), `${record.name} → ${studioId}`).toBeDefined();
      }
    }
  });
});

describe('UnavailableAssetCatalog', () => {
  it('fails loudly instead of pretending a remote catalogue exists', async () => {
    const catalog = new UnavailableAssetCatalog();
    const result = await catalog.query();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported');
    expect(catalog.descriptor.notice).toMatch(/planned but not implemented/i);
  });
});
