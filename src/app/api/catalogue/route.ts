/**
 * GET /api/catalogue — the paginated asset catalogue.
 *
 * This is the same repository-authored sample catalogue the app ships with, served over HTTP with
 * the same query semantics as `AssetCatalog`. It is **not** a hosted library of third-party assets,
 * and the response says so in `notice`: every record names its licence and its provenance before a
 * client can use it, and the pagination is real (page, page size, totals, next/previous).
 *
 * No account is required: browsing a catalogue is not a private operation, and requiring a session
 * would make the catalogue's own empty state unreachable for a signed-out visitor.
 */

import { SAMPLE_ASSETS } from '../../../core/assets/data';
import { LICENSES } from '../../../core/assets/licenses';
import { computeFacets, runAssetQuery } from '../../../core/assets/query';
import { SAMPLE_CATALOG_DESCRIPTOR } from '../../../core/assets/catalog';
import type { AssetKind, AssetLicenseId, AssetQuery } from '../../../core/assets/types';
import { jsonResponse } from '../../../server/http';

export const runtime = 'nodejs';

const KINDS: readonly AssetKind[] = [
  'template',
  'graphic',
  'font',
  'palette',
  'component',
  'preset',
  'texture',
  'sound',
];
const LICENCE_IDS = Object.keys(LICENSES) as AssetLicenseId[];

function readList(search: URLSearchParams, key: string): string[] {
  return search
    .getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function boundedInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const search = url.searchParams;

  const kinds = readList(search, 'kind').filter((value): value is AssetKind =>
    (KINDS as readonly string[]).includes(value),
  );
  const licenses = readList(search, 'licence').filter((value): value is AssetLicenseId =>
    LICENCE_IDS.includes(value as AssetLicenseId),
  );

  const text = search.get('text')?.trim() ?? '';
  const studio = search.get('studio')?.trim() ?? '';
  const query: AssetQuery = {
    ...(text.length > 0 ? { text } : {}),
    ...(kinds.length > 0 ? { kinds } : {}),
    ...(licenses.length > 0 ? { licenseIds: licenses } : {}),
    ...(studio.length > 0 ? { studioIds: [studio] } : {}),
    page: boundedInt(search.get('page'), 1, 1, 10_000),
    pageSize: boundedInt(search.get('pageSize'), 12, 1, 48),
    sort: search.get('sort') === 'name' ? 'name-asc' : 'relevance',
  };

  const page = runAssetQuery(SAMPLE_ASSETS, query);
  const facets = computeFacets(SAMPLE_ASSETS, { ...query, page: 1 });

  return jsonResponse({
    descriptor: SAMPLE_CATALOG_DESCRIPTOR,
    query,
    page,
    facets,
    // The rule the client must be able to state without re-deriving it: a record without a file can
    // be previewed but never placed, and the licence travels with the record.
    rules: {
      placementRequiresFile: true,
      licenceRequired: true,
      previewsAreNotArtwork: true,
    },
  });
}
