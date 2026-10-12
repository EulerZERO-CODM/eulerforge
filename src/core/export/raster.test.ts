// @vitest-environment node
/**
 * Raster export, verified against real pixels.
 *
 * `@napi-rs/canvas` (a development dependency) implements the same Canvas 2D API as the browser, so
 * these tests run the *real* export pipeline — plan, paint, encode, decode — and read the pixels
 * back. The browser path differs only in which canvas object is supplied.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { loadImage } from '@napi-rs/canvas';

import {
  DEFAULT_JPEG_QUALITY,
  exportRasterImage,
  jpegBackgroundColor,
  MAX_EXPORT_PIXELS,
  rasterDimensions,
  rasterFileName,
  validateRasterRequest,
  type CanvasFactory,
  type RasterCanvas,
} from './raster';
import type { ForgeDocument } from '../documents/types';
import {
  documentFixture,
  ellipseLayer,
  imageLayer,
  rectLayer,
  sceneOf,
  textLayer,
} from '../../testing/layers';
import { loadImageFixtures, nodeCanvasFactory, pixelCanvas, rgbaAt } from '../../testing/raster';

const createCanvas = nodeCanvasFactory();

function assetPath(name: string): string {
  return join(process.cwd(), 'public', 'forge-assets', name);
}

const assetFixtures = async () => ({
  '/forge-assets/aurora-mesh.svg': readFileSync(assetPath('aurora-mesh.svg')),
});

/** Decodes an exported blob back into pixels, which is the only honest way to check an encoder. */
async function decode(blob: Blob): Promise<ReturnType<typeof pixelCanvas>> {
  const bytes = Buffer.from(await blob.arrayBuffer());
  const image = await loadImage(bytes);
  const target = pixelCanvas(image.width, image.height);
  target.context.drawImage(image, 0, 0);
  return target;
}

function squareDocument(overrides: Parameters<typeof documentFixture>[0] = {}): ForgeDocument {
  return documentFixture({
    canvas: {
      width: 200,
      height: 200,
      unit: 'px',
      dpi: 96,
      background: '#101820',
      transparent: false,
    },
    ...overrides,
  });
}

const noImages = () => ({ error: 'no graphic registered in this test' });

describe('rasterDimensions', () => {
  it('uses the document size, never the viewport', () => {
    const document = squareDocument();
    expect(rasterDimensions(document, 1)).toEqual({ width: 200, height: 200 });
    expect(rasterDimensions(document, 0.5)).toEqual({ width: 100, height: 100 });
    expect(rasterDimensions(document, 3)).toEqual({ width: 600, height: 600 });
  });

  it('rounds odd sizes to whole pixels', () => {
    const document = documentFixture({
      canvas: {
        width: 1921,
        height: 1081,
        unit: 'px',
        dpi: 96,
        background: '#000000',
        transparent: false,
      },
    });
    expect(rasterDimensions(document, 0.5)).toEqual({ width: 961, height: 541 });
  });
});

describe('rasterFileName', () => {
  it('builds a readable name that states the exported size', () => {
    const document = documentFixture({ title: 'Launch Poster — v2!' });
    expect(rasterFileName(document, 'png', { width: 1080, height: 1080 })).toBe(
      'launch-poster-v2-1080x1080.png',
    );
    expect(rasterFileName(document, 'jpeg', { width: 540, height: 540 })).toBe(
      'launch-poster-v2-540x540.jpg',
    );
  });
});

describe('validateRasterRequest', () => {
  it('accepts the scales the interface offers', () => {
    for (const scale of [0.5, 1, 2, 3]) {
      expect(validateRasterRequest({ document: squareDocument(), format: 'png', scale }).ok).toBe(
        true,
      );
    }
  });

  it('rejects a scale outside the supported range', () => {
    const tooBig = validateRasterRequest({ document: squareDocument(), format: 'png', scale: 5 });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error.code).toBe('validation-failed');
    expect(
      validateRasterRequest({ document: squareDocument(), format: 'png', scale: 0.1 }).ok,
    ).toBe(false);
    expect(
      validateRasterRequest({ document: squareDocument(), format: 'png', scale: Number.NaN }).ok,
    ).toBe(false);
  });

  it('refuses an output larger than the pixel budget, with the size named', () => {
    const huge = documentFixture({
      canvas: {
        width: 20_000,
        height: 20_000,
        unit: 'px',
        dpi: 96,
        background: '#000000',
        transparent: false,
      },
    });
    const result = validateRasterRequest({ document: huge, format: 'png', scale: 0.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unsupported');
      expect(result.error.detail).toContain('10000 x 10000');
      expect(MAX_EXPORT_PIXELS).toBe(40_000_000);
    }
  });

  it('rejects an out-of-range JPEG quality', () => {
    expect(
      validateRasterRequest({ document: squareDocument(), format: 'jpeg', scale: 1, quality: 0.1 })
        .ok,
    ).toBe(false);
    expect(
      validateRasterRequest({ document: squareDocument(), format: 'jpeg', scale: 1, quality: 0.8 })
        .ok,
    ).toBe(true);
  });
});

describe('jpegBackgroundColor', () => {
  const opaque = squareDocument();
  const transparent = documentFixture({
    canvas: {
      width: 200,
      height: 200,
      unit: 'px',
      dpi: 96,
      background: '#101820',
      transparent: true,
    },
  });

  it('uses the canvas colour for an opaque document when asked to flatten onto it', () => {
    expect(jpegBackgroundColor(opaque, 'canvas')).toBe('#101820');
  });

  it('falls back to white when a transparent document has no colour to flatten onto', () => {
    expect(jpegBackgroundColor(transparent, 'canvas')).toBe('#ffffff');
  });

  it('honours an explicit white or black choice for either document', () => {
    expect(jpegBackgroundColor(opaque, 'white')).toBe('#ffffff');
    expect(jpegBackgroundColor(transparent, 'black')).toBe('#000000');
  });
});

describe('exportRasterImage — real pixels', () => {
  it('writes a PNG at the document size', async () => {
    const result = await exportRasterImage({
      document: squareDocument(),
      format: 'png',
      scale: 1,
      createCanvas,
      resolveImage: noImages,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.mimeType).toBe('image/png');
    expect(result.value.width).toBe(200);
    expect(result.value.height).toBe(200);
    expect(result.value.bytes).toBeGreaterThan(0);

    const decoded = await decode(result.value.blob);
    expect(decoded.canvas.width).toBe(200);
    expect(decoded.canvas.height).toBe(200);
    expect(rgbaAt(decoded, 5, 5)).toEqual([0x10, 0x18, 0x20, 255]);
  });

  it('scales the bitmap, including every layer', async () => {
    const document = squareDocument({
      scene: sceneOf(
        rectLayer('lyr-square', { x: 50, y: 50, width: 100, height: 100, fill: '#ff0000' }),
      ),
    });
    const result = await exportRasterImage({
      document,
      format: 'png',
      scale: 2,
      createCanvas,
      resolveImage: noImages,
    });
    if (!result.ok) throw new Error(result.error.message);

    const decoded = await decode(result.value.blob);
    expect([decoded.canvas.width, decoded.canvas.height]).toEqual([400, 400]);
    // The rectangle occupied 50..150 in document space: 100..300 after a 2x scale.
    expect(rgbaAt(decoded, 120, 120)).toEqual([255, 0, 0, 255]);
    expect(rgbaAt(decoded, 20, 20)).toEqual([0x10, 0x18, 0x20, 255]);
  });

  it('composes layers in stacking order, with the top-most layer winning', async () => {
    const document = squareDocument({
      scene: sceneOf(
        rectLayer('lyr-bottom', { x: 0, y: 0, width: 200, height: 200, fill: '#0000ff' }),
        rectLayer('lyr-top', { x: 50, y: 50, width: 100, height: 100, fill: '#00ff00' }),
      ),
    });
    const result = await exportRasterImage({
      document,
      format: 'png',
      scale: 1,
      createCanvas,
      resolveImage: noImages,
    });
    if (!result.ok) throw new Error(result.error.message);

    const decoded = await decode(result.value.blob);
    expect(rgbaAt(decoded, 100, 100)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(decoded, 10, 10)).toEqual([0, 0, 255, 255]);
  });

  it('draws an ellipse as an ellipse, not as its bounding box', async () => {
    const withEllipse = squareDocument({
      scene: sceneOf(ellipseLayer('lyr-ellipse', { x: 0, y: 0, fill: '#ffff00' })),
    });

    const result = await exportRasterImage({
      document: withEllipse,
      format: 'png',
      scale: 1,
      createCanvas,
      resolveImage: noImages,
    });
    if (!result.ok) throw new Error(result.error.message);

    const decoded = await decode(result.value.blob);
    expect(rgbaAt(decoded, 100, 100)).toEqual([255, 255, 0, 255]);
    // The bounding box corner is outside the ellipse, so the background shows through.
    expect(rgbaAt(decoded, 2, 2)).toEqual([0x10, 0x18, 0x20, 255]);
  });

  it('keeps transparency in a PNG of a transparent document', async () => {
    const transparent = documentFixture({
      canvas: {
        width: 100,
        height: 100,
        unit: 'px',
        dpi: 96,
        background: '#ffffff',
        transparent: true,
      },
      scene: sceneOf(
        rectLayer('lyr-square', { x: 10, y: 10, width: 40, height: 40, fill: '#ff0000' }),
      ),
    });
    const result = await exportRasterImage({
      document: transparent,
      format: 'png',
      scale: 1,
      createCanvas,
      resolveImage: noImages,
    });
    if (!result.ok) throw new Error(result.error.message);

    const decoded = await decode(result.value.blob);
    expect(rgbaAt(decoded, 5, 5)[3]).toBe(0);
    expect(rgbaAt(decoded, 20, 20)).toEqual([255, 0, 0, 255]);
  });

  it('paints the document background for an opaque PNG', async () => {
    const result = await exportRasterImage({
      document: squareDocument(),
      format: 'png',
      scale: 1,
      createCanvas,
      resolveImage: noImages,
    });
    if (!result.ok) throw new Error(result.error.message);

    const decoded = await decode(result.value.blob);
    expect(rgbaAt(decoded, 5, 5)[3]).toBe(255);
  });

  it('flattens a JPEG onto white by default, with no transparent pixels left', async () => {
    const transparent = documentFixture({
      canvas: {
        width: 64,
        height: 64,
        unit: 'px',
        dpi: 96,
        background: '#000000',
        transparent: true,
      },
    });
    const result = await exportRasterImage({
      document: transparent,
      format: 'jpeg',
      scale: 1,
      createCanvas,
      resolveImage: noImages,
    });
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.mimeType).toBe('image/jpeg');
    const decoded = await decode(result.value.blob);
    const pixel = rgbaAt(decoded, 32, 32);
    expect(pixel[3]).toBe(255);
    expect(pixel[0]).toBeGreaterThan(250);
    expect(pixel[1]).toBeGreaterThan(250);
    expect(pixel[2]).toBeGreaterThan(250);
  });

  it('flattens a JPEG onto the canvas colour when asked', async () => {
    const transparent = documentFixture({
      canvas: {
        width: 64,
        height: 64,
        unit: 'px',
        dpi: 96,
        background: '#000000',
        transparent: true,
      },
    });
    const result = await exportRasterImage({
      document: transparent,
      format: 'jpeg',
      scale: 1,
      jpegBackground: 'canvas',
      createCanvas,
      resolveImage: noImages,
    });
    if (!result.ok) throw new Error(result.error.message);

    // A transparent document has no canvas colour, so the predictable fallback is white.
    const decoded = await decode(result.value.blob);
    expect(rgbaAt(decoded, 32, 32)[0]).toBeGreaterThan(250);
  });

  it('applies the JPEG quality setting to the encoded size', async () => {
    const document = squareDocument({
      scene: sceneOf(
        rectLayer('lyr-square', { x: 0, y: 0, width: 200, height: 200, fill: '#3388cc' }),
      ),
    });
    const low = await exportRasterImage({
      document,
      format: 'jpeg',
      scale: 1,
      quality: 0.4,
      createCanvas,
      resolveImage: noImages,
    });
    const high = await exportRasterImage({
      document,
      format: 'jpeg',
      scale: 1,
      quality: 1,
      createCanvas,
      resolveImage: noImages,
    });
    if (!low.ok || !high.ok) throw new Error('expected both exports to succeed');
    expect(DEFAULT_JPEG_QUALITY).toBe(0.92);
    expect(high.value.bytes).toBeGreaterThan(low.value.bytes);
  });

  it('draws a placed graphic and reports no issues', async () => {
    const document = squareDocument({
      scene: sceneOf(
        imageLayer('lyr-graphic', {
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          href: '/forge-assets/aurora-mesh.svg',
          assetId: 'graphic.aurora-mesh',
          fit: 'cover',
        }),
      ),
    });
    const resolveImage = await loadImageFixtures(await assetFixtures());
    const result = await exportRasterImage({
      document,
      format: 'png',
      scale: 1,
      createCanvas,
      resolveImage,
    });
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.issues).toEqual([]);
    const decoded = await decode(result.value.blob);
    // The mesh is a coloured navy field, not the plain document background.
    expect(rgbaAt(decoded, 100, 100)).not.toEqual([0x10, 0x18, 0x20, 255]);
    expect(rgbaAt(decoded, 100, 100)[3]).toBe(255);
  });

  it.skipIf(!hasFonts())('places text inside its frame at the requested scale', async () => {
    const document = squareDocument({
      scene: sceneOf(
        textLayer('lyr-title', {
          x: 20,
          y: 60,
          width: 160,
          height: 80,
          content: 'FORGE',
          fontSize: 48,
          color: '#ffffff',
        }),
      ),
    });
    const result = await exportRasterImage({
      document,
      format: 'png',
      scale: 1,
      createCanvas,
      resolveImage: noImages,
    });
    if (!result.ok) throw new Error(result.error.message);

    const decoded = await decode(result.value.blob);
    expect(inkIn(decoded, 20, 60, 160, 80)).toBeGreaterThan(0);
    // No ink above the frame: text draws where the layer says it draws.
    expect(inkIn(decoded, 0, 0, 200, 40)).toBe(0);
  });
});

function hasFonts(): boolean {
  const probe = pixelCanvas(40, 20);
  probe.context.font = '16px sans-serif';
  return probe.context.measureText('Forge').width > 0.5;
}

/** Counts pixels that differ from the document background inside a region. */
function inkIn(
  target: ReturnType<typeof pixelCanvas>,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const data = target.context.getImageData(x, y, width, height).data;
  let ink = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] !== 0x10 || data[index + 1] !== 0x18 || data[index + 2] !== 0x20) ink += 1;
  }
  return ink;
}

describe('exportRasterImage — failure paths', () => {
  it('refuses to export when a graphic could not be loaded, naming the layer', async () => {
    const document = squareDocument({
      scene: sceneOf(imageLayer('lyr-graphic', { name: 'Background photo', href: '/missing.png' })),
    });
    const result = await exportRasterImage({
      document,
      format: 'png',
      scale: 1,
      createCanvas,
      resolveImage: () => ({ error: 'the file was not found' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unsupported');
      expect(result.error.detail).toContain('Background photo');
      expect(result.error.detail).toContain('the file was not found');
    }
  });

  it('reports an encoder that produces nothing instead of claiming success', async () => {
    const createNullCanvas: CanvasFactory = (width, height) => {
      const canvas = createCanvas(width, height);
      return { ...canvas, toBlob: (callback: (blob: Blob | null) => void) => callback(null) };
    };
    const result = await exportRasterImage({
      document: squareDocument(),
      format: 'png',
      scale: 1,
      createCanvas: createNullCanvas,
      resolveImage: noImages,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/could not encode/i);
  });

  it('reports a browser without a 2D context', async () => {
    const createContextlessCanvas: CanvasFactory = (width, height) => {
      const canvas = createCanvas(width, height);
      const adapter: RasterCanvas = {
        width,
        height,
        getContext: () => null,
        toBlob: () => undefined,
      };
      return { ...canvas, ...adapter };
    };
    const result = await exportRasterImage({
      document: squareDocument(),
      format: 'png',
      scale: 1,
      createCanvas: createContextlessCanvas,
      resolveImage: noImages,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported');
  });

  it('reports a canvas that cannot be created at all', async () => {
    const result = await exportRasterImage({
      document: squareDocument(),
      format: 'png',
      scale: 1,
      createCanvas: () => {
        throw new Error('out of memory');
      },
      resolveImage: noImages,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unknown');
      expect(result.error.detail).toContain('out of memory');
    }
  });

  it('warns about text overflow without blocking the export', async () => {
    const document = squareDocument({
      scene: sceneOf(
        textLayer('lyr-title', {
          x: 0,
          y: 0,
          width: 40,
          height: 20,
          content: 'This headline is far too long for its box',
          fontSize: 24,
        }),
      ),
    });
    const result = await exportRasterImage({
      document,
      format: 'png',
      scale: 1,
      createCanvas,
      resolveImage: noImages,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.warnings.join(' ')).toMatch(/taller than its box/i);
  });
});

describe('exportRasterImage — a full composition', () => {
  it('exports background, graphic, shape and text together at 2x', async () => {
    const document = squareDocument({
      scene: sceneOf(
        imageLayer('lyr-backdrop', {
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          href: '/forge-assets/aurora-mesh.svg',
          assetId: 'graphic.aurora-mesh',
          fit: 'cover',
        }),
        rectLayer('lyr-panel', {
          x: 20,
          y: 120,
          width: 160,
          height: 60,
          fill: '#101820',
          stroke: '#ff8a3d',
          strokeWidth: 4,
        }),
        textLayer('lyr-title', {
          x: 20,
          y: 130,
          width: 160,
          height: 40,
          content: 'Launch',
          fontSize: 28,
          color: '#ffffff',
        }),
      ),
    });

    const resolveImage = await loadImageFixtures(await assetFixtures());
    const result = await exportRasterImage({
      document,
      format: 'png',
      scale: 2,
      createCanvas,
      resolveImage,
    });
    if (!result.ok) throw new Error(result.error.message);

    const decoded = await decode(result.value.blob);
    expect([decoded.canvas.width, decoded.canvas.height]).toEqual([400, 400]);
    // The panel is opaque at 2x where it is drawn, and the graphic shows above it.
    expect(rgbaAt(decoded, 200, 300)[3]).toBe(255);
    expect(rgbaAt(decoded, 200, 100)).not.toEqual([0x10, 0x18, 0x20, 255]);
    expect(result.value.fileName).toBe('fixture-project-400x400.png');
  });
});
