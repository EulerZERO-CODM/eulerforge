/**
 * Default studio registry instance and the extension entry point.
 *
 * A future studio package registers itself here (or into a registry instance it creates) with
 * `registerStudio`. `getRegistryIssues()` reports structural problems found at registration time;
 * the test suite asserts it is empty so authoring mistakes fail CI rather than users (ADR-0010).
 */

import { STUDIO_DEFINITIONS } from './definitions';
import { StudioRegistry, type RegisterStudioOptions } from './registry';
import type { StudioAvailability, StudioDefinition } from './types';

export const studioRegistry = new StudioRegistry(STUDIO_DEFINITIONS);

/** Registers an additional studio definition with the application registry. */
export function registerStudio(
  definition: StudioDefinition,
  options: RegisterStudioOptions = {},
): void {
  studioRegistry.register(definition, options);
}

export function getRegistryIssues() {
  return studioRegistry.getRegistryIssues();
}

export function listStudios(): readonly StudioDefinition[] {
  return studioRegistry.list();
}

export function listStudiosByAvailability(
  availability: StudioAvailability,
): readonly StudioDefinition[] {
  return studioRegistry.listByAvailability(availability);
}

export function getStudio(idOrSlug: string): StudioDefinition | undefined {
  return studioRegistry.get(idOrSlug);
}

export function requireStudio(idOrSlug: string): StudioDefinition {
  return studioRegistry.require(idOrSlug);
}

export function findStudioByRoute(route: string): StudioDefinition | undefined {
  return studioRegistry.list().find((studio) => studio.entry.route === route);
}

export { studioRegistry as default };
export * from './types';
export { StudioRegistry, createStudioId, createStudioSlug } from './registry';
export type { StudioRegistryIssue } from './registry';
