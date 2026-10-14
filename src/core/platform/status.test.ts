import { describe, expect, it } from 'vitest';

import { getCapability } from './lookup';
import {
  PLATFORM_CAPABILITIES,
  capabilitiesByArea,
  capabilityCounts,
  type PlatformArea,
} from './status';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const AREAS: readonly PlatformArea[] = [
  'core',
  'shell',
  'learning',
  'assets',
  'studios',
  'platform',
];

/** Entries that name a file in this repository (as opposed to a command or an external link). */
function referencedFiles(verification: readonly string[]): readonly string[] {
  return verification.filter((entry) => /^src\/.*\.(ts|tsx|css|json)$/.test(entry));
}

describe('capability ledger', () => {
  it('has unique ids and complete copy', () => {
    const ids = PLATFORM_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const capability of PLATFORM_CAPABILITIES) {
      expect(capability.label.length, capability.id).toBeGreaterThan(0);
      expect(capability.description.length, capability.id).toBeGreaterThan(0);
      // Unimplemented capabilities deliberately carry no evidence: `verification: []` means
      // "nothing to point at yet", which is different from naming a file that does not exist.
      if (capability.status === 'implemented' || capability.status === 'partial') {
        expect(capability.verification.length, capability.id).toBeGreaterThan(0);
      }
    }
  });

  it('requires evidence for anything claimed as implemented', () => {
    for (const capability of PLATFORM_CAPABILITIES) {
      if (capability.status !== 'implemented') continue;
      expect(capability.verification.length, capability.id).toBeGreaterThan(0);
    }
  });

  it('points every completed claim at a test file that exists', () => {
    for (const capability of PLATFORM_CAPABILITIES) {
      if (capability.status !== 'implemented' && capability.status !== 'partial') continue;
      for (const reference of referencedFiles(capability.verification)) {
        // Documentation references are fine, but a test named as evidence has to be real — this is
        // what stops a capability from claiming coverage it does not have.
        if (!reference.includes('.test.')) continue;
        expect(
          existsSync(resolve(process.cwd(), reference)),
          `${capability.id} → ${reference}`,
        ).toBe(true);
      }
    }
  });

  it('explains what is missing for anything that is not implemented', () => {
    for (const capability of PLATFORM_CAPABILITIES) {
      if (capability.status === 'implemented') continue;
      expect(capability.gap, capability.id).toBeDefined();
    }
  });

  it('groups capabilities by area and counts statuses consistently', () => {
    const grouped = capabilitiesByArea();
    for (const area of AREAS) expect(grouped[area].length, area).toBeGreaterThan(0);

    const total = AREAS.reduce((sum, area) => sum + grouped[area].length, 0);
    expect(total).toBe(PLATFORM_CAPABILITIES.length);

    const counts = capabilityCounts();
    const sum = Object.values(counts).reduce((total, count) => total + count, 0);
    expect(sum).toBe(PLATFORM_CAPABILITIES.length);
  });

  it('resolves capability ids and labels through the lookup helpers', () => {
    const first = PLATFORM_CAPABILITIES[0]!;
    expect(getCapability(first.id)?.label).toBe(first.label);
    expect(getCapability('core.not-a-capability')).toBeUndefined();
  });

  it('names the workspace panels honestly: the Design Studio entry stays partial until a browser run', () => {
    const design = PLATFORM_CAPABILITIES.find((capability) => capability.id === 'studios.design');
    expect(design?.status).toBe('partial');
    // The editing tools exist and are described as existing...
    expect(design?.description).toMatch(/artboard/i);
    // ...and the gap names what a jsdom suite cannot cover rather than staying silent.
    // A gap has to be specific about what is *not* covered, so it names the uncovered behaviour.
    expect(design?.gap).toMatch(/snapping is asserted in document space/i);
  });
});
