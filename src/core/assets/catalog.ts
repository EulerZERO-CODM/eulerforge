/**
 * Asset catalogue boundary.
 *
 * `AssetCatalog` is the interface studios consume. Phase 1 implements it with a bundled sample
 * source and an intentionally empty source; a remote, paginated, searchable adapter is the planned
 * next implementation (docs/ROADMAP.md) and must not require component changes.
 */

import { err, forgeError, ok, type Result } from '../result';
import { SAMPLE_ASSETS } from './data';
import { computeFacets, computeTags, runAssetQuery } from './query';
import type { AssetFacets, AssetId, AssetQuery, AssetRecord, Page } from './types';

export type CatalogSourceId = 'sample' | 'empty';

export type CatalogDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly source: 'bundled-sample' | 'empty' | 'remote';
  /** Shown in the UI next to catalogue results so a user is never misled about coverage. */
  readonly notice: string;
};

export interface AssetCatalog {
  readonly descriptor: CatalogDescriptor;
  query(query?: AssetQuery): Promise<Result<Page<AssetRecord>>>;
  get(id: AssetId): Promise<Result<AssetRecord | null>>;
  facets(query?: AssetQuery): Promise<Result<AssetFacets>>;
  tags(): Promise<Result<readonly { tag: string; count: number }[]>>;
  /** Records for a studio, used by studio landing pages. */
  forStudio(studioId: string, limit?: number): Promise<Result<readonly AssetRecord[]>>;
}

export class InMemoryAssetCatalog implements AssetCatalog {
  public readonly descriptor: CatalogDescriptor;

  public constructor(
    private readonly records: readonly AssetRecord[],
    descriptor: CatalogDescriptor,
  ) {
    this.descriptor = descriptor;
  }

  public async query(query: AssetQuery = {}): Promise<Result<Page<AssetRecord>>> {
    return ok(runAssetQuery(this.records, query));
  }

  public async get(id: AssetId): Promise<Result<AssetRecord | null>> {
    return ok(this.records.find((record) => record.id === id) ?? null);
  }

  public async facets(query: AssetQuery = {}): Promise<Result<AssetFacets>> {
    return ok(computeFacets(this.records, query));
  }

  public async tags(): Promise<Result<readonly { tag: string; count: number }[]>> {
    return ok(computeTags(this.records));
  }

  public async forStudio(studioId: string, limit = 6): Promise<Result<readonly AssetRecord[]>> {
    const result = runAssetQuery(this.records, { studioIds: [studioId], pageSize: limit });
    return ok(result.items);
  }
}

export const SAMPLE_CATALOG_DESCRIPTOR: CatalogDescriptor = {
  id: 'catalog.sample',
  label: 'Sample catalogue',
  source: 'bundled-sample',
  notice:
    'Sample content only. These records demonstrate catalogue structure, licensing and provenance — they are not a production asset library, and no third-party files are bundled.',
};

export const EMPTY_CATALOG_DESCRIPTOR: CatalogDescriptor = {
  id: 'catalog.empty',
  label: 'Empty catalogue',
  source: 'empty',
  notice:
    'This build is configured with an empty catalogue (NEXT_PUBLIC_FORGE_CATALOG_SOURCE=empty) so the empty state can be reviewed.',
};

/** Factory used by the application. Unknown sources fall back to the sample catalogue. */
export function createAssetCatalog(source: CatalogSourceId): AssetCatalog {
  if (source === 'empty') {
    return new InMemoryAssetCatalog([], EMPTY_CATALOG_DESCRIPTOR);
  }
  return new InMemoryAssetCatalog(SAMPLE_ASSETS, SAMPLE_CATALOG_DESCRIPTOR);
}

/** Adapter that fails loudly; used to assert the boundary is respected in tests. */
export class UnavailableAssetCatalog implements AssetCatalog {
  public readonly descriptor: CatalogDescriptor = {
    id: 'catalog.unavailable',
    label: 'Catalogue unavailable',
    source: 'remote',
    notice: 'A remote catalogue adapter is planned but not implemented.',
  };

  public async query(): Promise<Result<Page<AssetRecord>>> {
    return err(forgeError('unsupported', 'A remote asset catalogue is not implemented yet.'));
  }

  public async get(): Promise<Result<AssetRecord | null>> {
    return err(forgeError('unsupported', 'A remote asset catalogue is not implemented yet.'));
  }

  public async facets(): Promise<Result<AssetFacets>> {
    return err(forgeError('unsupported', 'A remote asset catalogue is not implemented yet.'));
  }

  public async tags(): Promise<Result<readonly { tag: string; count: number }[]>> {
    return err(forgeError('unsupported', 'A remote asset catalogue is not implemented yet.'));
  }

  public async forStudio(): Promise<Result<readonly AssetRecord[]>> {
    return err(forgeError('unsupported', 'A remote asset catalogue is not implemented yet.'));
  }
}
