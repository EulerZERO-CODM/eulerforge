/**
 * Icon-set export.
 *
 * An icon set is not "one SVG containing everything": it is several named icons that another system
 * has to look up by name. So this builds, from the layers a user selected:
 *
 * - one SVG file per icon, named after its layer, ready to drop into a project;
 * - a sprite file using `<symbol>` elements, for `<use href="icons.svg#name">` in markup;
 * - a manifest describing every icon, so a build step or a person can enumerate them;
 * - a single zip archive holding all of it, because a browser gives a page one download per click.
 *
 * Every icon is normalised into the document's artboard box, so a set exported from one document
 * lines up when it is used together — which is the entire reason icons are drawn on a shared grid.
 *
 * Determinism is a hard requirement here: two exports of the same artwork are byte-identical, which
 * is what lets a repository track the output of this function in version control and lets the tests
 * assert on real bytes rather than on a description of them.
 */

import type { Layer, PathLayer } from '../documents/layer-types';
import { isPathLayer } from '../documents/layer-types';
import type { VectorBox } from '../vector';
import { err, forgeError, ok, type Result } from '../result';
import { toPathData } from '../vector/path-data';
import { createArtwork, createShape } from './artwork';
import { iconIdFor, serializeIconSprite, serializeSvg } from './serialize';
import { createZip } from './zip';

export type IconSource = {
  readonly layerId: string;
  readonly name: string;
};

export type IconEntryResult = {
  /** Slug used for the file name, the sprite id and the manifest key. */
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  /** `M0 0 …` path data for this icon alone, in artboard coordinates. */
  readonly pathData: string;
  readonly nodeCount: number;
  readonly svg: string;
};

export type IconSet = {
  readonly name: string;
  readonly entries: readonly IconEntryResult[];
  readonly sprite: string;
  readonly manifest: string;
  readonly archive: Uint8Array;
  readonly archiveFileName: string;
  /** Total bytes of the per-icon files plus the sprite and manifest, before zipping. */
  readonly totalBytes: number;
};

export type IconSetOptions = {
  /** Artboard box every icon is written into. Defaults to the bounding box of the chosen layers. */
  readonly box?: VectorBox | undefined;
  readonly setName?: string | undefined;
  readonly digits?: number | undefined;
};

function boxOf(layers: readonly PathLayer[]): VectorBox | null {
  return layers.reduce<VectorBox | null>((accumulated, layer) => {
    const box: VectorBox = {
      minX: layer.frame.x,
      minY: layer.frame.y,
      maxX: layer.frame.x + layer.frame.width,
      maxY: layer.frame.y + layer.frame.height,
    };
    return accumulated === null
      ? box
      : {
          minX: Math.min(accumulated.minX, box.minX),
          minY: Math.min(accumulated.minY, box.minY),
          maxX: Math.max(accumulated.maxX, box.maxX),
          maxY: Math.max(accumulated.maxY, box.maxY),
        };
  }, null);
}

/** A file-system-safe slug: the sprite id rules, plus a fallback. */
function fileNameFor(id: string): string {
  return `${id}.svg`;
}

/**
 * Builds the icon set.
 *
 * Fails when nothing was chosen, when a chosen layer is not vector artwork, or when a chosen layer's
 * geometry cannot be written — with the layer named, so the message is actionable.
 */
export function buildIconSet(
  layers: readonly Layer[],
  options: IconSetOptions = {},
): Result<IconSet> {
  const vectorLayers = layers.filter(isPathLayer);
  if (vectorLayers.length === 0) {
    return err(
      forgeError(
        'validation-failed',
        'Choose at least one vector layer to export as an icon set.',
        {
          detail:
            'Only vector paths can become icons; rectangles and ellipses become paths on export once converted.',
          retryable: false,
        },
      ),
    );
  }

  const box = options.box ?? boxOf(vectorLayers);
  if (!box || box.maxX <= box.minX || box.maxY <= box.minY) {
    return err(
      forgeError('validation-failed', 'Those layers have no area to export as icons.', {
        retryable: false,
      }),
    );
  }

  const setName = options.setName ?? 'icon-set';
  const digits = options.digits ?? 3;
  const entries: IconEntryResult[] = [];
  const used = new Set<string>();

  for (const layer of vectorLayers) {
    const artwork = createArtwork(
      { width: box.maxX - box.minX, height: box.maxY - box.minY },
      [createShape(layer.name, layer.vector.path, layer.vector.style, layer.opacity)],
      { viewBox: box },
    );
    const written = serializeSvg(artwork, { digits, includeNames: true });
    if (!written.ok) {
      return err(
        forgeError(
          written.error.code,
          `“${layer.name}” cannot be written as an icon: ${written.error.message}`,
          {
            retryable: false,
          },
        ),
      );
    }

    const base = iconIdFor(layer.name);
    let id = base;
    let counter = 2;
    while (used.has(id)) {
      id = `${base}-${String(counter)}`;
      counter += 1;
    }
    used.add(id);

    entries.push({
      id,
      name: layer.name,
      fileName: fileNameFor(id),
      pathData: toPathData(layer.vector.path, { digits }),
      nodeCount: layer.vector.path.contours.reduce(
        (total, contour) => total + contour.nodes.length,
        0,
      ),
      svg: written.value,
    });
  }

  const spriteResult = serializeIconSprite(
    entries.map((entry, index) => ({
      name: entry.name,
      artwork: createArtwork(
        { width: box.maxX - box.minX, height: box.maxY - box.minY },
        [
          createShape(
            entry.name,
            vectorLayers[index]?.vector.path ?? { contours: [] },
            vectorLayers[index]?.vector.style ?? {},
            vectorLayers[index]?.opacity ?? 1,
          ),
        ],
        { viewBox: box },
      ),
    })),
    { digits },
  );
  if (!spriteResult.ok) return err(spriteResult.error);

  const manifest = `${JSON.stringify(
    {
      generator: 'eulerforge-svg-icon-set/1',
      name: setName,
      viewBox: [box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY],
      icons: entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        file: entry.fileName,
        nodes: entry.nodeCount,
      })),
      sprite: 'icons.svg',
    },
    null,
    2,
  )}\n`;

  const files = new Map<string, string>();
  for (const entry of entries) files.set(entry.fileName, entry.svg);
  files.set('icons.svg', spriteResult.value);
  files.set('icons.json', manifest);

  const encoder = new TextEncoder();
  const archive = createZip(
    [...files].map(([name, contents]) => ({ name, data: encoder.encode(contents) })),
  );

  const totalBytes = [...files.values()].reduce((total, contents) => total + contents.length, 0);

  return ok({
    name: setName,
    entries,
    sprite: spriteResult.value,
    manifest,
    archive,
    archiveFileName: `${iconIdFor(setName)}.zip`,
    totalBytes,
  });
}
