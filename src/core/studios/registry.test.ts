import { describe, expect, it } from 'vitest';

import { brand } from '../types/brand';
import { createStudioId, createStudioSlug, StudioRegistry } from './registry';
import type { StudioDefinition } from './types';

function definition(overrides: Partial<StudioDefinition> = {}): StudioDefinition {
  return {
    // The fixture reuses the `design` id on purpose: the only document types that exist today are
    // owned by real studios, so a made-up id would (correctly) be reported as mis-owned.
    id: createStudioId('design'),
    slug: createStudioSlug('design'),
    name: 'Test Studio',
    tagline: 'A studio used by the registry tests',
    purpose: 'Exists only to exercise validation rules.',
    icon: 'layout',
    accent: 'cobalt',
    availability: 'planned',
    maturityNote: 'Not built.',
    produces: ['Test artefacts'],
    documentTypes: [brand<'DocumentTypeId'>('design.canvas')],
    capabilities: [
      { id: 'test.capability', label: 'Nothing yet', status: 'planned', detail: 'Planned.' },
    ],
    engine: {
      renderer: 'None yet',
      pipeline: 'None yet',
      integrationPoint: 'src/core/studios',
      rationale: 'Placeholder definition for tests.',
    },
    entry: { route: null, label: 'Test Studio' },
    learningSlugs: ['canvas-and-units'],
    consumesFrom: [],
    definitionVersion: 1,
    ...overrides,
  };
}

function issuesFor(candidate: StudioDefinition, others: readonly StudioDefinition[] = []) {
  const registry = new StudioRegistry(others);
  registry.register(candidate);
  return registry.getRegistryIssues().filter((issue) => issue.studioId === String(candidate.id));
}

describe('StudioRegistry validation', () => {
  it('accepts a well-formed definition', () => {
    const registry = new StudioRegistry();
    registry.register(definition());
    expect(registry.getRegistryIssues()).toEqual([]);
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects a duplicate id unless the caller asks to replace it', () => {
    const registry = new StudioRegistry();
    registry.register(definition());
    registry.register(definition({ name: 'Second' }));

    expect(registry.getRegistryIssues()).toHaveLength(1);
    expect(registry.require('design').name).toBe('Test Studio');

    registry.register(definition({ name: 'Replacement' }), { replace: true });
    expect(registry.getRegistryIssues()).toHaveLength(1);
    expect(registry.require('design').name).toBe('Replacement');
  });

  it('rejects slugs that are not lowercase kebab-case', () => {
    const issues = issuesFor(definition({ slug: createStudioSlug('Test Studio') }));
    expect(issues.map((issue) => issue.message)).toContainEqual(
      expect.stringMatching(/kebab-case/),
    );
  });

  it('rejects duplicate slugs', () => {
    const other = definition({
      id: createStudioId('other'),
      slug: createStudioSlug('test-studio'),
    });
    const issues = issuesFor(
      definition({ id: createStudioId('third'), slug: createStudioSlug('test-studio') }),
      [other],
    );
    expect(issues.map((issue) => issue.message)).toContainEqual(
      expect.stringMatching(/already registered/),
    );
  });

  it('flags unknown document types and types owned by another studio', () => {
    const unknown = issuesFor(
      definition({ documentTypes: [brand<'DocumentTypeId'>('nothing.like-this')] }),
    );
    expect(unknown.map((issue) => issue.message)).toContainEqual(
      expect.stringMatching(/unknown document type/),
    );

    const misowned = issuesFor(
      definition({ documentTypes: [brand<'DocumentTypeId'>('photo.image')] }),
    );
    expect(misowned.map((issue) => issue.message)).toContainEqual(
      expect.stringMatching(/owned by studio/),
    );
  });

  it('requires at least one document type and one capability', () => {
    expect(
      issuesFor(definition({ documentTypes: [] })).map((issue) => issue.message),
    ).toContainEqual(expect.stringMatching(/at least one document type/));
    expect(
      issuesFor(definition({ capabilities: [] })).map((issue) => issue.message),
    ).toContainEqual(expect.stringMatching(/at least one capability/));
  });

  it('refuses to claim availability without an entry route', () => {
    const issues = issuesFor(definition({ availability: 'available' }));
    expect(issues.map((issue) => issue.message)).toContainEqual(
      expect.stringMatching(/has no entry route/),
    );
  });

  it('refuses to expose a route while claiming to be unfinished', () => {
    const issues = issuesFor(
      definition({ availability: 'planned', entry: { route: '/studios/test', label: 'Open' } }),
    );
    expect(issues.map((issue) => issue.message)).toContainEqual(
      expect.stringMatching(/while not marked available/),
    );
  });

  it('refuses implemented capabilities on an unfinished studio', () => {
    const issues = issuesFor(
      definition({
        availability: 'planned',
        capabilities: [
          { id: 'test.done', label: 'Done', status: 'available', detail: 'Claims to work.' },
        ],
      }),
    );
    expect(issues.map((issue) => issue.message)).toContainEqual(
      expect.stringMatching(/lists implemented capabilities/),
    );
  });

  it('warns about a missing learning link for anything a user can open', () => {
    const planned = issuesFor(definition({ learningSlugs: [] }));
    expect(planned.map((issue) => issue.severity)).toContain('warning');

    // Exploratory disciplines are exempt: there is no onboarding to link to yet.
    const exploratory = issuesFor(definition({ availability: 'exploratory', learningSlugs: [] }));
    expect(
      exploratory.map((issue) => issue.message).some((message) => message.includes('learning')),
    ).toBe(false);
  });

  it('warns about consuming from an unknown studio and about self-consumption', () => {
    const unknown = issuesFor(definition({ consumesFrom: [createStudioId('ghost')] }));
    expect(unknown.map((issue) => issue.message)).toContainEqual(
      expect.stringMatching(/unknown studio/),
    );

    const self = issuesFor(
      definition({
        id: createStudioId('loop'),
        slug: createStudioSlug('loop'),
        consumesFrom: [createStudioId('loop')],
      }),
    );
    expect(self.map((issue) => issue.message)).toContainEqual(
      expect.stringMatching(/cannot consume its own output/),
    );
  });
});

describe('StudioRegistry queries', () => {
  it('groups capability labels by status', () => {
    const registry = new StudioRegistry([
      definition({
        capabilities: [
          { id: 'a', label: 'Ready thing', status: 'available', detail: 'Works.' },
          { id: 'b', label: 'Later thing', status: 'planned', detail: 'Not yet.' },
          { id: 'c', label: 'Maybe thing', status: 'exploratory', detail: 'Unknown.' },
        ],
      }),
    ]);

    expect(registry.capabilitiesByStatus('design')).toEqual({
      available: ['Ready thing'],
      planned: ['Later thing'],
      exploratory: ['Maybe thing'],
    });
    expect(registry.capabilitiesByStatus('missing')).toEqual({
      available: [],
      planned: [],
      exploratory: [],
    });
  });

  it('searches names, taglines, outputs and capability labels', () => {
    const registry = new StudioRegistry([
      definition({ id: createStudioId('alpha'), slug: createStudioSlug('alpha'), name: 'Alpha' }),
      definition({
        id: createStudioId('beta'),
        slug: createStudioSlug('beta'),
        name: 'Beta',
        produces: ['Storyboards'],
      }),
    ]);

    expect(registry.search('alpha').map((studio) => studio.id)).toEqual(['alpha']);
    expect(registry.search('storyboard').map((studio) => studio.id)).toEqual(['beta']);
    expect(registry.search('   ')).toHaveLength(2);
    expect(registry.search('nothing matches this')).toHaveLength(0);
  });
});
