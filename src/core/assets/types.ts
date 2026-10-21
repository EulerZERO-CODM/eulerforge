/**
 * Asset ecosystem domain model.
 *
 * The catalogue is designed for *large, paginated, remote* collections: the domain only ever deals
 * with `AssetQuery` + `Page<AssetRecord>` so a future CDN-backed adapter does not leak into
 * components. Phase 1 ships a bundled sample adapter whose records are explicitly labelled.
 */

import type { Branded } from '../types/brand';

export type AssetId = Branded<string, 'AssetId'>;

export type AssetKind =
  'template' | 'graphic' | 'font' | 'palette' | 'component' | 'preset' | 'texture' | 'sound';

/**
 * Whether a catalogue record exists or is only planned.
 *
 * `sample` — bundled sample content, available now.
 * `planned` — a record describing content the catalogue will carry; it is not downloadable.
 */
export type AssetStatus = 'sample' | 'planned';

export const ASSET_KIND_LABELS: Readonly<Record<AssetKind, string>> = {
  template: 'Templates',
  graphic: 'Graphics',
  font: 'Fonts',
  palette: 'Palettes',
  component: 'Components',
  preset: 'Presets',
  texture: 'Textures',
  sound: 'Audio',
};

/**
 * Licence identifiers. `forge-sample` covers content authored for this repository; the others are
 * real, well-known licences used by planned catalogue integrations.
 */
export type AssetLicenseId =
  'forge-sample' | 'cc0-1.0' | 'cc-by-4.0' | 'ofl-1.1' | 'apache-2.0' | 'mit' | 'proprietary';

export type AssetLicense = {
  readonly id: AssetLicenseId;
  readonly name: string;
  readonly spdxId?: string;
  readonly url?: string;
  readonly attributionRequired: boolean;
  readonly commercialUse: boolean;
  readonly shareAlike: boolean;
  /** Plain-language summary shown in the licence dialog. */
  readonly summary: string;
};

export type AssetProvenance = {
  readonly source: 'bundled-sample' | 'catalogue' | 'user-upload' | 'generated';
  readonly author: string;
  readonly sourceUrl?: string;
  /** ISO date the record was added to the catalogue. */
  readonly addedAt: string;
  /**
   * Whether a human has checked the licence and provenance. Anything unverified must be surfaced to
   * the user before it is used in commercial work (docs/DECISIONS.md → ADR-0008).
   */
  readonly verified: boolean;
  readonly notes: string;
};

/** How the catalogue card previews a record without shipping the asset itself. */
export type AssetPreview =
  | { readonly kind: 'swatch'; readonly colors: readonly string[] }
  | { readonly kind: 'layout'; readonly aspect: string; readonly blocks: readonly string[] }
  | { readonly kind: 'glyph'; readonly glyph: string }
  | { readonly kind: 'symbol'; readonly symbol: string };

/**
 * A renderable file shipped with the catalogue.
 *
 * Records carry a `file` only when a real, repository-authored file exists at `href`; the editor
 * places graphics from this field and nothing else, so a metadata-only record can never end up on a
 * canvas claiming to be artwork.
 */
export type AssetFile = {
  /** Public path served by the app, e.g. `/forge-assets/aurora-mesh.svg`. */
  readonly href: string;
  readonly mediaType: string;
  /** Intrinsic pixel size, used to place the graphic without loading it first. */
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
};

export type AssetRecord = {
  readonly id: AssetId;
  readonly name: string;
  readonly kind: AssetKind;
  readonly description: string;
  readonly tags: readonly string[];
  readonly license: AssetLicense;
  readonly provenance: AssetProvenance;
  /** Studios this asset is intended for; empty means discipline-agnostic. */
  readonly studioIds: readonly string[];
  readonly documentTypes: readonly string[];
  readonly formats: readonly string[];
  /** Only `sample` records exist in Phase 1; `planned` records document the intended catalogue. */
  readonly status: AssetStatus;
  readonly preview: AssetPreview;
  /** Present only when a real file ships with the catalogue and can be placed on a canvas. */
  readonly file?: AssetFile | undefined;
  /** Free-text surface where the asset can be used, e.g. "Design Studio artboards". */
  readonly usageNote: string;
};

/** True when a record can actually be placed on a canvas as a graphic layer. */
export function isPlaceable(record: AssetRecord): boolean {
  return record.file !== undefined;
}

/** Records that can be placed, which is what the editor offers. */
export function placeableRecords(records: readonly AssetRecord[]): readonly AssetRecord[] {
  return records.filter(isPlaceable);
}

export type AssetSortOrder = 'name-asc' | 'name-desc' | 'newest' | 'relevance';

export type AssetQuery = {
  readonly text?: string;
  readonly kinds?: readonly AssetKind[];
  readonly studioIds?: readonly string[];
  readonly licenseIds?: readonly AssetLicenseId[];
  readonly tags?: readonly string[];
  readonly status?: AssetRecord['status'];
  readonly sort?: AssetSortOrder;
  /** 1-based page number. */
  readonly page?: number;
  readonly pageSize?: number;
};

export type Page<TItem> = {
  readonly items: readonly TItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
};

export const DEFAULT_ASSET_PAGE_SIZE = 12;

export type AssetFacets = {
  readonly kinds: readonly {
    readonly value: AssetKind;
    readonly label: string;
    readonly count: number;
  }[];
  readonly licenses: readonly {
    readonly value: AssetLicenseId;
    readonly label: string;
    readonly count: number;
  }[];
  readonly studios: readonly {
    readonly value: string;
    readonly label: string;
    readonly count: number;
  }[];
  readonly total: number;
};
