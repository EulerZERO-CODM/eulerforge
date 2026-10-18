import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getDocumentType } from '../documents/document-types';
import { getLesson } from '../learning/query';
import { getRegistryIssues, listStudios, listStudiosByAvailability, studioRegistry } from './index';
import { collectAppRoutes, isRoutable } from '../../testing/routes';

// Vitest runs from the project root; the helper reads the App Router directory directly.
const appDir = resolve(process.cwd(), 'src/app');
const routes = collectAppRoutes(appDir);

describe('shipped studio registry', () => {
  it('registers definitions without any structural issues', () => {
    // Warnings are included on purpose: a duplicate slug or an unowned document type must fail CI
    // rather than surface at runtime (docs/DECISIONS.md → ADR-0010).
    expect(getRegistryIssues()).toEqual([]);
  });

  it('ships the six disciplines promised on the studios page', () => {
    expect(listStudios().map((studio) => studio.id)).toEqual([
      'design',
      'photo',
      'video',
      'motion',
      'illustration',
      'three-d',
    ]);
  });

  it('is honest about maturity: Design, Photo and Illustration are available, the rest are not', () => {
    // Every entry here is a claim backed by a working workspace; the studios that are still planned
    // must not creep into this list because a route or a placeholder appeared.
    expect(listStudiosByAvailability('available').map((studio) => studio.id)).toEqual([
      'design',
      'photo',
      'illustration',
    ]);
    expect(studioRegistry.countByAvailability()).toEqual({
      available: 3,
      'in-development': 0,
      planned: 2,
      exploratory: 1,
    });
  });

  it('only lists capabilities as available when the studio itself is available', () => {
    for (const studio of listStudios()) {
      const implemented = studio.capabilities.filter(
        (capability) => capability.status === 'available',
      );
      if (studio.availability === 'available') continue;
      expect(implemented, `${studio.id} lists implemented capabilities`).toEqual([]);
    }
  });

  it('exposes an entry route only for studios that are actually available', () => {
    for (const studio of listStudios()) {
      if (studio.availability === 'available') {
        expect(studio.entry.route, `${studio.id} is available`).not.toBeNull();
      } else {
        expect(studio.entry.route, `${studio.id} must not link anywhere yet`).toBeNull();
      }
    }
  });

  it('points every entry route at a page the App Router serves', () => {
    for (const studio of listStudios()) {
      if (studio.entry.route === null) continue;
      expect(isRoutable(appDir, studio.entry.route, routes), studio.entry.route).toBe(true);
    }
  });

  it('only claims implemented capabilities for available studios', () => {
    for (const studio of listStudios()) {
      const implemented = studio.capabilities.filter(
        (capability) => capability.status === 'available',
      );
      if (studio.availability === 'available') continue;
      expect(implemented, `${studio.id} lists implemented capabilities`).toEqual([]);
    }
  });

  it('describes what each studio will produce and how it will plug in', () => {
    for (const studio of listStudios()) {
      expect(studio.produces.length, studio.id).toBeGreaterThan(0);
      expect(studio.capabilities.length, studio.id).toBeGreaterThan(0);
      expect(studio.engine.renderer, studio.id).not.toBe('');
      expect(studio.engine.integrationPoint, studio.id).not.toBe('');
      expect(studio.maturityNote, studio.id).not.toBe('');
    }
  });

  it('owns its document types and declares only known ones', () => {
    for (const studio of listStudios()) {
      for (const documentTypeId of studio.documentTypes) {
        const documentType = getDocumentType(documentTypeId);
        expect(documentType, `${studio.id} → ${String(documentTypeId)}`).toBeDefined();
        expect(documentType?.studioId).toBe(studio.id as string);
      }
    }
  });

  it('links only to learning content that exists and is published', () => {
    for (const studio of listStudios()) {
      for (const slug of studio.learningSlugs) {
        const lesson = getLesson(slug);
        expect(lesson, `${studio.id} → ${slug}`).toBeDefined();
        expect(lesson?.status).toBe('published');
      }
    }
  });

  it('resolves studios by id, slug and entry route', () => {
    expect(studioRegistry.get('design')?.name).toBe('Design Studio');
    expect(studioRegistry.get('three-d')?.availability).toBe('exploratory');
    expect(studioRegistry.bySlug('photo')?.id).toBe('photo');
    expect(studioRegistry.get('nope')).toBeUndefined();
    expect(() => studioRegistry.require('nope')).toThrow(/Unknown studio/);
  });

  it('finds a studio by the route it owns', () => {
    const found = studioRegistry
      .list()
      .filter((studio) => studio.entry.route === '/studios/design');
    expect(found.map((studio) => studio.id)).toEqual(['design']);
  });
});
