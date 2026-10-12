import { describe, expect, it } from 'vitest';

import { getLayoutStarter, LAYOUT_STARTERS } from './starters';
import { DEFAULT_GUIDES } from './factories';
import { getCanvasPreset, CANVAS_PRESETS } from './presets';
import { validateGuides } from './validation';

describe('layout starters', () => {
  it('points every starter at a canvas preset that exists', () => {
    for (const starter of LAYOUT_STARTERS) {
      const preset = getCanvasPreset(starter.presetId);
      expect(preset, `${starter.id} → ${starter.presetId}`).toBeDefined();
    }
  });

  it('only references presets the registry actually ships', () => {
    const ids = new Set(CANVAS_PRESETS.map((preset) => preset.id as string));

    for (const starter of LAYOUT_STARTERS) {
      expect(ids.has(starter.presetId as string), starter.id).toBe(true);
    }
  });

  it('sets guides the document model accepts', () => {
    for (const starter of LAYOUT_STARTERS) {
      expect(validateGuides(starter.guides), starter.id).toEqual([]);
    }
  });

  it('describes the regions its guides create, and does not claim to place artwork', () => {
    for (const starter of LAYOUT_STARTERS) {
      expect(starter.regions.length, starter.id).toBeGreaterThan(0);
      for (const region of starter.regions) {
        expect(region.label.length, starter.id).toBeGreaterThan(0);
        expect(region.guidance.length, starter.id).toBeGreaterThan(0);
      }
      // A starter arranges guides; nothing renders a layout yet.
      expect(`${starter.label} ${starter.description}`).not.toMatch(/template|renders|places/i);
    }
  });

  it('starts from the documented defaults rather than inventing guide settings', () => {
    for (const starter of LAYOUT_STARTERS) {
      const diff = Object.keys(DEFAULT_GUIDES).filter(
        (key) =>
          starter.guides[key as keyof typeof DEFAULT_GUIDES] !==
          DEFAULT_GUIDES[key as keyof typeof DEFAULT_GUIDES],
      );
      expect(diff.length, `${starter.id} changed ${diff.join(', ')}`).toBeGreaterThan(0);
    }
  });

  it('keeps starter ids and suggested titles unique', () => {
    const ids = LAYOUT_STARTERS.map((starter) => starter.id as string);
    const titles = LAYOUT_STARTERS.map((starter) => starter.titleSuggestion);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(titles).size).toBe(titles.length);
    for (const title of titles) expect(title.trim().length).toBeGreaterThan(0);
  });

  it('resolves a starter by id and tolerates unknown or missing values', () => {
    const first = LAYOUT_STARTERS[0]!;

    expect(getLayoutStarter(first.id)?.label).toBe(first.label);
    expect(getLayoutStarter('not-a-starter')).toBeUndefined();
    expect(getLayoutStarter(null)).toBeUndefined();
    expect(getLayoutStarter(undefined)).toBeUndefined();
  });
});
