/**
 * Test support: layer and scene fixtures.
 *
 * Builders rather than object literals so that a test which only cares about one property does not
 * have to restate the whole layer contract — and so that a schema change updates every fixture in
 * one place.
 */

import { brand } from '../core/types/brand';
import { freezeDocument } from '../core/documents/freeze';
import {
  createDocument,
  DEFAULT_CANVAS,
  type CreateDocumentOptions,
} from '../core/documents/factories';
import {
  createLayer,
  createLayerId,
  emptyScene,
  type NewLayerInput,
} from '../core/documents/layer-operations';
import type {
  AttributionRecord,
  ImageLayer,
  Layer,
  LayerId,
  RectLayer,
  Scene,
  TextLayer,
} from '../core/documents/layer-types';
import { createRect, type Rect } from '../core/documents/geometry';
import type { Canvas, ForgeDocument } from '../core/documents/types';

export const TEST_DOCUMENT_TYPE = brand<'DocumentTypeId'>('design.canvas');

export function layerId(value: string): LayerId {
  return brand<'LayerId'>(value);
}

function build(input: NewLayerInput, id: string, name: string): Layer {
  const result = createLayer(input, { id: layerId(id), name });
  if (!result.ok) throw new Error(`fixture layer "${id}" is invalid: ${result.error.message}`);
  return result.value;
}

export function textLayer(
  id: string,
  overrides: {
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
    readonly name?: string;
    readonly content?: string;
    readonly fontSize?: number;
    readonly color?: string;
    readonly align?: TextLayer['text']['align'];
    readonly visible?: boolean;
  } = {},
): TextLayer {
  const layer = build(
    {
      type: 'text',
      frame: createRect(
        overrides.x ?? 0,
        overrides.y ?? 0,
        overrides.width ?? 240,
        overrides.height ?? 80,
      ),
      text: {
        content: overrides.content ?? 'Fixture text',
        ...(overrides.fontSize === undefined ? {} : { fontSize: overrides.fontSize }),
        ...(overrides.color === undefined ? {} : { color: overrides.color }),
        ...(overrides.align === undefined ? {} : { align: overrides.align }),
      },
    },
    id,
    overrides.name ?? `Text ${id}`,
  );
  if (layer.type !== 'text') throw new Error('expected a text layer');
  return overrides.visible === undefined ? layer : { ...layer, visible: overrides.visible };
}

export function rectLayer(
  id: string,
  overrides: {
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
    readonly name?: string;
    readonly fill?: string | null;
    readonly stroke?: string | null;
    readonly strokeWidth?: number;
    readonly cornerRadius?: number;
    readonly visible?: boolean;
  } = {},
): RectLayer {
  const layer = build(
    {
      type: 'rect',
      frame: createRect(
        overrides.x ?? 0,
        overrides.y ?? 0,
        overrides.width ?? 120,
        overrides.height ?? 120,
      ),
      shape: {
        ...(overrides.fill === undefined ? {} : { fill: overrides.fill }),
        ...(overrides.stroke === undefined ? {} : { stroke: overrides.stroke }),
        ...(overrides.strokeWidth === undefined ? {} : { strokeWidth: overrides.strokeWidth }),
        ...(overrides.cornerRadius === undefined ? {} : { cornerRadius: overrides.cornerRadius }),
      },
    },
    id,
    overrides.name ?? `Rectangle ${id}`,
  );
  if (layer.type !== 'rect') throw new Error('expected a rectangle layer');
  return overrides.visible === undefined ? layer : { ...layer, visible: overrides.visible };
}

export function ellipseLayer(
  id: string,
  overrides: {
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
    readonly fill?: string | null;
    readonly name?: string;
  } = {},
): Layer {
  return build(
    {
      type: 'ellipse',
      frame: createRect(
        overrides.x ?? 0,
        overrides.y ?? 0,
        overrides.width ?? 120,
        overrides.height ?? 120,
      ),
      shape: { ...(overrides.fill === undefined ? {} : { fill: overrides.fill }) },
    },
    id,
    overrides.name ?? `Ellipse ${id}`,
  );
}

export function imageLayer(
  id: string,
  overrides: {
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
    readonly href?: string;
    readonly assetId?: string | null;
    readonly name?: string;
    readonly fit?: ImageLayer['image']['fit'];
    readonly tint?: string | null;
  } = {},
): ImageLayer {
  const layer = build(
    {
      type: 'image',
      frame: createRect(
        overrides.x ?? 0,
        overrides.y ?? 0,
        overrides.width ?? 200,
        overrides.height ?? 200,
      ),
      image: {
        href: overrides.href ?? '/forge-assets/sample-gradient-grid.svg',
        ...(overrides.fit === undefined ? {} : { fit: overrides.fit }),
        ...(overrides.tint === undefined ? {} : { tint: overrides.tint }),
      },
    },
    id,
    overrides.name ?? `Graphic ${id}`,
  );
  if (layer.type !== 'image') throw new Error('expected an image layer');
  return overrides.assetId === undefined
    ? layer
    : { ...layer, image: { ...layer.image, assetId: overrides.assetId } };
}

/** A scene from an explicit layer list, bottom-most first — the same order the document stores. */
export function sceneOf(...layers: readonly Layer[]): Scene {
  return Object.freeze({ layers: Object.freeze([...layers]) });
}

export function empty(): Scene {
  return emptyScene();
}

/** A stack of `count` rectangles with stable ids, used by the 30-layer responsiveness tests. */
export function stackOf(count: number): Scene {
  return sceneOf(
    ...Array.from({ length: count }, (_, index) =>
      rectLayer(`lyr-stack-${index}`, {
        x: (index % 6) * 40,
        y: Math.floor(index / 6) * 40,
        name: `Layer ${index + 1}`,
      }),
    ),
  );
}

export function attributionRecord(overrides: Partial<AttributionRecord> = {}): AttributionRecord {
  return {
    id: 'attr-1',
    assetId: 'sample.gradient-grid',
    assetName: 'Gradient grid',
    assetKind: 'texture',
    licenseId: 'forge-sample',
    licenseName: 'Forge sample licence',
    licenseUrl: null,
    attributionRequired: true,
    commercialUse: false,
    author: 'Euler’s Forge',
    source: 'Repository-authored sample',
    verified: true,
    notes: '',
    placedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

export type DocumentFixtureOptions = CreateDocumentOptions & {
  readonly title?: string;
  readonly canvas?: Canvas;
  readonly scene?: Scene;
  readonly attribution?: readonly AttributionRecord[];
};

/** A valid, saved-shape document for tests that need a real one rather than a partial literal. */
export function documentFixture(options: DocumentFixtureOptions = {}): ForgeDocument {
  const created = createDocument(
    {
      title: options.title ?? 'Fixture project',
      studioId: 'design',
      documentTypeId: TEST_DOCUMENT_TYPE,
      canvas: options.canvas ?? DEFAULT_CANVAS,
      ...(options.scene ? { scene: options.scene } : {}),
    },
    { generateId: () => 'doc-fixture', ...options },
  );
  if (!created.ok) throw new Error(`fixture document is invalid: ${created.error.message}`);
  const document = created.value;
  if (!options.attribution) return document;
  return freezeDocument({ ...document, attribution: options.attribution });
}

export const FIXTURE_DOCUMENT_ID = brand<'DocumentId'>('doc-fixture');

export function rectFixture(x: number, y: number, width: number, height: number): Rect {
  return createRect(x, y, width, height);
}

/** Stable id generator for deterministic layer creation in tests. */
export function sequentialLayerIds(prefix = 'lyr-gen'): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

export { createLayerId };
