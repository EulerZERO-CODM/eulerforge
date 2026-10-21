/**
 * Icon-set export.
 *
 * An icon set is a deliverable, so these tests check the deliverable: the bytes of the archive, the
 * symbols in the sprite, the manifest, and the fact that exporting the same artwork twice produces
 * the same file. A zip that opens, with one SVG per icon inside it, is the whole point.
 */

import { describe, expect, it } from 'vitest';

import { createLayer } from '../documents/layer-operations';
import type { Layer } from '../documents/layer-types';
import { parsePathData } from '../vector/path-data';
import { ellipsePath } from '../vector/shapes';
import { buildIconSet, iconLayersForSelection } from './icon-set';
import { parseSvg } from './parse';
import { crc32, createZip, readZipEntry, readZipEntryNames } from './zip';

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `lyr-${String(counter)}`;
};

function iconLayer(name: string, data: string, fill = '#112233'): Layer {
  const parsed = parsePathData(data);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const created = createLayer(
    {
      type: 'path',
      frame: { x: 0, y: 0, width: 24, height: 24 },
      vector: { path: parsed.value.path, style: { fill } },
    },
    { name, generateId: nextId },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

/** The icon grid every icon in these fixtures is drawn on. */
const GRID = { minX: 0, minY: 0, maxX: 24, maxY: 24 };

const PLUS = 'M4 10 L10 10 L10 4 L14 4 L14 10 L20 10 L20 14 L14 14 L14 20 L10 20 L10 14 L4 14 Z';
const SQUARE = 'M4 4 L20 4 L20 20 L4 20 Z';
const CIRCLE =
  'M12 4 C16.418 4 20 7.582 20 12 C20 16.418 16.418 20 12 20 C7.582 20 4 16.418 4 12 C4 7.582 7.582 4 12 4 Z';

describe('zip writer', () => {
  it('writes an archive whose entries can be read back with their contents', () => {
    const encoder = new TextEncoder();
    const archive = createZip([
      { name: 'a.svg', data: encoder.encode('<svg/>') },
      { name: 'b.svg', data: encoder.encode('<svg id="b"/>') },
    ]);
    expect(readZipEntryNames(archive)).toEqual(['a.svg', 'b.svg']);
    expect(new TextDecoder().decode(readZipEntry(archive, 'b.svg')!)).toBe('<svg id="b"/>');
    expect(readZipEntry(archive, 'missing.svg')).toBeNull();
  });

  it('is byte-identical for the same entries, which is what makes an export reproducible', () => {
    const encoder = new TextEncoder();
    const entries = [{ name: 'icon.svg', data: encoder.encode('<svg/>') }];
    expect([...createZip(entries)]).toEqual([...createZip(entries)]);
  });

  it('computes the CRC the format expects', () => {
    // The canonical check value for "123456789" in every CRC-32 implementation.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips a realistic payload size', () => {
    const big = new TextEncoder().encode('x'.repeat(100_000));
    const archive = createZip([{ name: 'big.svg', data: big }]);
    expect(readZipEntry(archive, 'big.svg')?.length).toBe(100_000);
  });
});

describe('icon sets', () => {
  it('writes one file per icon plus a sprite and a manifest', () => {
    const result = buildIconSet([iconLayer('Plus', PLUS), iconLayer('Square', SQUARE)], {
      setName: 'Basic Icons',
      box: GRID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const set = result.value;
    expect(set.entries.map((entry) => entry.fileName)).toEqual(['plus.svg', 'square.svg']);
    expect(set.archiveFileName).toBe('basic-icons.zip');
    expect(readZipEntryNames(set.archive)).toEqual([
      'plus.svg',
      'square.svg',
      'icons.svg',
      'icons.json',
    ]);
    expect(set.sprite).toContain('<symbol id="plus"');
    expect(set.sprite).toContain('<symbol id="square"');
    expect(JSON.parse(set.manifest)).toMatchObject({
      generator: 'eulerforge-svg-icon-set/1',
      name: 'Basic Icons',
      viewBox: [0, 0, 24, 24],
      icons: [
        { id: 'plus', name: 'Plus', file: 'plus.svg' },
        { id: 'square', name: 'Square', file: 'square.svg' },
      ],
    });
  });

  it('writes each icon file as valid SVG whose geometry re-imports', () => {
    const result = buildIconSet([iconLayer('Circle', CIRCLE)], { setName: 'Shapes', box: GRID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const file = new TextDecoder().decode(readZipEntry(result.value.archive, 'circle.svg')!);
    expect(file.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    const read = parseSvg(file);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.artwork.shapes).toHaveLength(1);
    expect(read.value.artwork.shapes[0]?.style.fill).toBe('#112233');
    // 24 × 24 viewBox, artwork inside it, and the name carried by the <title>.
    expect(read.value.artwork.viewBox).toEqual({ minX: 0, minY: 0, maxX: 24, maxY: 24 });
    expect(read.value.artwork.shapes[0]?.name).toBe('Circle');
  });

  it('produces byte-identical archives for the same artwork', () => {
    const first = buildIconSet([iconLayer('Plus', PLUS), iconLayer('Square', SQUARE)], {
      box: GRID,
    });
    const second = buildIconSet([iconLayer('Plus', PLUS), iconLayer('Square', SQUARE)], {
      box: GRID,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect([...second.value.archive]).toEqual([...first.value.archive]);
    expect(second.value.manifest).toBe(first.value.manifest);
  });

  it('de-duplicates names that slug to the same id', () => {
    const result = buildIconSet([iconLayer('Star Icon', SQUARE), iconLayer('star-icon', CIRCLE)], {
      box: GRID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries.map((entry) => entry.id)).toEqual(['star-icon', 'star-icon-2']);
  });

  it('normalises every icon into one box, so a set lines up', () => {
    const small = createLayer(
      {
        type: 'path',
        frame: { x: 0, y: 0, width: 24, height: 24 },
        vector: {
          path: ellipsePath({ minX: 8, minY: 8, maxX: 16, maxY: 16 }),
          style: { fill: '#000000' },
        },
      },
      { name: 'Dot', generateId: nextId },
    );
    if (!small.ok) throw new Error(small.error.message);
    const result = buildIconSet([iconLayer('Square', SQUARE), small.value], {
      setName: 'Mixed',
      box: GRID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.value.manifest).viewBox).toEqual([0, 0, 24, 24]);
    for (const entry of result.value.entries) {
      const read = parseSvg(entry.svg);
      expect(read.ok).toBe(true);
      if (read.ok)
        expect(read.value.artwork.viewBox).toEqual({ minX: 0, minY: 0, maxX: 24, maxY: 24 });
    }
  });

  it('defaults to the bounding box of the chosen artwork when no grid is given', () => {
    const result = buildIconSet([iconLayer('Plus', PLUS)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 4..20 rather than 0..24: without an artboard, the artwork's own bounds are the only honest box.
    expect(JSON.parse(result.value.manifest).viewBox).toEqual([4, 4, 16, 16]);
  });

  it('exports only the layers it is given, never the scene they came from', () => {
    const plus = iconLayer('Plus', PLUS);
    const square = iconLayer('Square', SQUARE);
    const circle = iconLayer('Circle', CIRCLE);
    const picked = iconLayersForSelection(
      [plus, square, circle],
      [String(square.id), String(plus.id)],
    );
    expect(picked.layers.map((layer) => layer.name)).toEqual(['Plus', 'Square']);
    expect(picked.skipped).toEqual([]);

    const result = buildIconSet(picked.layers, { setName: 'Picked', box: GRID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readZipEntryNames(result.value.archive)).toEqual([
      'plus.svg',
      'square.svg',
      'icons.svg',
      'icons.json',
    ]);
    const manifest = JSON.parse(result.value.manifest) as { icons: { name: string }[] };
    expect(manifest.icons.map((icon) => icon.name)).toEqual(['Plus', 'Square']);
  });

  it('leaves hidden and fully transparent layers out, and names them as skipped', () => {
    const shown = iconLayer('Shown', SQUARE);
    const hidden = { ...iconLayer('Hidden', CIRCLE), visible: false };
    const faded = { ...iconLayer('Faded', PLUS), opacity: 0 };
    const picked = iconLayersForSelection(
      [shown, hidden, faded],
      [String(shown.id), String(hidden.id), String(faded.id)],
    );
    expect(picked.layers.map((layer) => layer.name)).toEqual(['Shown']);
    expect(picked.skipped).toEqual([
      {
        layerId: String(hidden.id),
        layerName: 'Hidden',
        layerType: 'path',
        reason: 'the layer is hidden, so it is not part of the drawing',
      },
      {
        layerId: String(faded.id),
        layerName: 'Faded',
        layerType: 'path',
        reason: 'the layer is fully transparent, so it is not part of the drawing',
      },
    ]);

    const result = buildIconSet([shown, hidden], { setName: 'Visible only', box: GRID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries.map((entry) => entry.fileName)).toEqual(['shown.svg']);
    expect(result.value.skipped.map((layer) => layer.layerName)).toEqual(['Hidden']);
    expect(readZipEntryNames(result.value.archive)).toEqual([
      'shown.svg',
      'icons.svg',
      'icons.json',
    ]);

    const nothing = buildIconSet([hidden], { box: GRID });
    expect(nothing.ok).toBe(false);
    if (!nothing.ok) {
      expect(nothing.error.message).toContain('at least one vector layer');
      expect(nothing.error.detail ?? '').toContain('“Hidden”');
      expect(nothing.error.detail ?? '').toContain('hidden');
    }
  });

  it('reports the selected layers that are not paths, naming each one', () => {
    const square = iconLayer('Square', SQUARE);
    const text = createLayer(
      { type: 'text', frame: { x: 0, y: 0, width: 10, height: 10 }, text: { content: 'x' } },
      { name: 'Label', generateId: nextId },
    );
    if (!text.ok) throw new Error('fixture');
    const picked = iconLayersForSelection(
      [square, text.value],
      [String(square.id), String(text.value.id)],
    );
    expect(picked.layers.map((layer) => layer.name)).toEqual(['Square']);
    expect(picked.skipped.map((layer) => [layer.layerName, layer.layerType])).toEqual([
      ['Label', 'text'],
    ]);
  });

  it('refuses an empty selection, a non-vector layer and invalid geometry, naming the cause', () => {
    const none = buildIconSet([]);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.message).toContain('at least one vector layer');

    const text = createLayer(
      { type: 'text', frame: { x: 0, y: 0, width: 10, height: 10 }, text: { content: 'x' } },
      { name: 'Label', generateId: nextId },
    );
    if (!text.ok) throw new Error('fixture');
    const notVector = buildIconSet([text.value]);
    expect(notVector.ok).toBe(false);

    const bowtie = iconLayer('Bowtie', 'M0 0 L10 10 L10 0 L0 10 Z');
    const invalid = buildIconSet([bowtie], { box: GRID });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.message).toContain('Bowtie');
  });
});

describe('icon sets carry paint', () => {
  function paintedIcon(name: string): Layer {
    const parsed = parsePathData(SQUARE);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const created = createLayer(
      {
        type: 'path',
        frame: { x: 0, y: 0, width: 24, height: 24 },
        vector: {
          path: parsed.value.path,
          style: {
            fill: null,
            fillPaint: {
              kind: 'pattern',
              motif: 'dots',
              foreground: '#112233',
              background: '#ffffff',
              scale: 0.2,
              rotation: 0,
            },
          },
        },
      },
      { name, generateId: nextId },
    );
    if (!created.ok) throw new Error(created.error.message);
    return created.value;
  }

  it('writes the definition into each icon file and the shared sprite', () => {
    const result = buildIconSet([paintedIcon('Dotted'), paintedIcon('Dotted two')], {
      setName: 'Painted icons',
      box: GRID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const fileName of ['dotted.svg', 'dotted-two.svg']) {
      const file = new TextDecoder().decode(readZipEntry(result.value.archive, fileName)!);
      expect(file).toContain('<pattern');
      expect(file).toContain('data-forge-pattern=');
      expect(file).toContain('fill="url(#paint-1)"');
    }

    const sprite = new TextDecoder().decode(readZipEntry(result.value.archive, 'icons.svg')!);
    expect(sprite).toContain('<defs>');
    expect(sprite).toContain('id="paint-1"');
    expect(sprite).toContain('id="paint-2"');
    const referenced = [...sprite.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
    const defined = [...sprite.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    for (const reference of referenced) expect(defined).toContain(reference);
  });

  it('round-trips a painted icon back through the importer', () => {
    const result = buildIconSet([paintedIcon('Dotted')], { setName: 'Painted', box: GRID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const file = new TextDecoder().decode(readZipEntry(result.value.archive, 'dotted.svg')!);
    const read = parseSvg(file);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const paint = read.value.artwork.shapes.find((shape) => shape.style.fillPaint !== null)?.style
      .fillPaint;
    expect(paint).toMatchObject({ kind: 'pattern', motif: 'dots' });
  });
});
