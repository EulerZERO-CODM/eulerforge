import { describe, expect, it } from 'vitest';

import { ROADMAP, findRoadmapItem, roadmapCounts } from './roadmap';
import { getCapability } from './lookup';
import { PLATFORM_CAPABILITIES } from './status';

const allItems = ROADMAP.flatMap((phase) => phase.items);

describe('roadmap data', () => {
  it('distinguishes implemented, planned and exploratory work', () => {
    const statuses = new Set(allItems.map((item) => item.status));
    expect(statuses.has('done')).toBe(true);
    expect(statuses.has('planned')).toBe(true);
    expect(statuses.has('exploratory')).toBe(true);
  });

  it('marks Phase 1 complete and keeps later phases unfinished', () => {
    const phase1 = ROADMAP.find((phase) => phase.id === 'phase-1');
    expect(phase1?.status).toBe('complete');
    expect(phase1?.items.length).toBeGreaterThan(0);
    expect(phase1?.items.every((item) => item.status === 'done')).toBe(true);

    for (const phase of ROADMAP) {
      if (phase.id === 'phase-1') continue;
      expect(phase.status, phase.id).not.toBe('complete');
    }
  });

  it('gives every item measurable completion criteria and dependencies that resolve', () => {
    const ids = new Set(allItems.map((item) => item.id));
    for (const item of allItems) {
      expect(item.completionCriteria.length, item.id).toBeGreaterThan(0);
      for (const criterion of item.completionCriteria) {
        expect(criterion.length, item.id).toBeGreaterThan(0);
      }
      for (const dependency of item.dependsOn) {
        expect(ids.has(dependency), `${item.id} → ${dependency}`).toBe(true);
      }
    }
  });

  it('gives every phase exit criteria so a phase can be judged finished', () => {
    for (const phase of ROADMAP) {
      expect(phase.exitCriteria.length, phase.id).toBeGreaterThan(0);
      expect(phase.items.length, phase.id).toBeGreaterThan(0);
    }
  });

  it('links every roadmap item to capabilities that exist in the ledger', () => {
    const ledgerIds = new Set(PLATFORM_CAPABILITIES.map((capability) => capability.id));
    for (const item of allItems) {
      for (const capabilityId of item.capabilityIds) {
        expect(ledgerIds.has(capabilityId), `${item.id} → ${capabilityId}`).toBe(true);
        expect(getCapability(capabilityId)).toBeDefined();
      }
    }
  });

  it('does not claim a feature is done in a phase that is not complete', () => {
    for (const phase of ROADMAP) {
      if (phase.status === 'complete') continue;
      const prematurelyDone = phase.items.filter((item) => item.status === 'done');
      expect(
        prematurelyDone.map((item) => item.id),
        phase.id,
      ).toEqual([]);
    }
  });

  it('counts items by status and finds an item by id', () => {
    const counts = roadmapCounts();
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(allItems.length);

    const first = allItems[0]!;
    const found = findRoadmapItem(first.id);
    expect(found?.[1].title).toBe(first.title);
    expect(findRoadmapItem('not-a-roadmap-item')).toBeUndefined();
  });

  it('keeps the deferred work visible rather than hidden', () => {
    const exploratory = allItems.filter((item) => item.status === 'exploratory');
    expect(exploratory.length).toBeGreaterThan(0);
    for (const item of exploratory) expect(item.description.length).toBeGreaterThan(0);
  });
});
