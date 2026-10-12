/**
 * Studio registry.
 *
 * The registry is the single source of truth for studio discovery, navigation and roadmap display.
 * It validates *structure* (unique ids, resolvable document types, honest availability flags) but
 * deliberately tolerates invalid definitions at runtime instead of crashing the shell — CI asserts
 * `getRegistryIssues()` is empty, so authoring mistakes fail the build rather than a user's browser.
 */

import { brand } from '../types/brand';
import { getDocumentType } from '../documents/document-types';
import type {
  StudioAvailability,
  StudioDefinition,
  StudioId,
  StudioSlug,
  CapabilityStatus,
} from './types';

export type StudioRegistryIssue = {
  readonly severity: 'error' | 'warning';
  readonly studioId: string;
  readonly message: string;
};

export type RegisterStudioOptions = {
  /** Replace an existing definition with the same id instead of reporting an issue. */
  readonly replace?: boolean;
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function validateDefinition(
  definition: StudioDefinition,
  existing: readonly StudioDefinition[],
): StudioRegistryIssue[] {
  const issues: StudioRegistryIssue[] = [];
  const id = definition.id as string;

  const push = (message: string, severity: StudioRegistryIssue['severity'] = 'error'): void => {
    issues.push({ severity, studioId: id, message });
  };

  if (!SLUG_PATTERN.test(definition.slug)) {
    push(`slug "${String(definition.slug)}" must be lowercase kebab-case`);
  }
  if (existing.some((other) => (other.slug as string) === (definition.slug as string))) {
    push(`slug "${String(definition.slug)}" is already registered`);
  }
  if (definition.documentTypes.length === 0) {
    push('must declare at least one document type');
  }
  for (const documentTypeId of definition.documentTypes) {
    const documentType = getDocumentType(documentTypeId);
    if (!documentType) {
      push(`references unknown document type "${String(documentTypeId)}"`);
      continue;
    }
    if (documentType.studioId !== id) {
      push(
        `document type "${String(documentTypeId)}" is owned by studio "${documentType.studioId}"`,
      );
    }
  }

  // Honesty rules: an availability claim must match the entry point and the capability flags.
  if (definition.availability === 'available' && definition.entry.route === null) {
    push('is marked available but has no entry route — add a route or lower the availability');
  }
  if (definition.availability !== 'available' && definition.entry.route !== null) {
    push(
      'exposes an entry route while not marked available — either implement it or remove the route',
    );
  }
  const misplaced = definition.capabilities.filter(
    (capability) => capability.status === 'available',
  );
  if (misplaced.length > 0 && definition.availability !== 'available') {
    push(
      `lists implemented capabilities (${misplaced
        .map((capability) => capability.id)
        .join(', ')}) while marked "${definition.availability}"`,
    );
  }
  if (definition.capabilities.length === 0) {
    push('must describe at least one capability so users know what it will do');
  }

  for (const consumed of definition.consumesFrom) {
    if (consumed === definition.id) push('cannot consume its own output');
    else if (!existing.some((other) => other.id === consumed)) {
      push(`consumes from unknown studio "${String(consumed)}"`, 'warning');
    }
  }

  if (definition.produces.length === 0) push('should list what it produces', 'warning');
  // Learning links are expected for anything a user could be onboarded into today. An exploratory
  // discipline is a possibility under evaluation, so demanding onboarding content for it would
  // produce noise rather than action.
  if (definition.learningSlugs.length === 0 && definition.availability !== 'exploratory') {
    push('has no linked learning content yet', 'warning');
  }

  return issues;
}

export class StudioRegistry {
  private readonly definitions = new Map<string, StudioDefinition>();
  private readonly issues: StudioRegistryIssue[] = [];

  public constructor(definitions: readonly StudioDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  /** Adds or replaces a definition. Structural problems are recorded, not thrown. */
  public register(definition: StudioDefinition, options: RegisterStudioOptions = {}): void {
    const id = definition.id as string;
    const existing = [...this.definitions.values()];
    const duplicate = this.definitions.has(id);

    if (duplicate && !options.replace) {
      this.issues.push({
        severity: 'error',
        studioId: id,
        message: 'duplicate studio id — pass `{ replace: true }` to override deliberately',
      });
      return;
    }

    const others = existing.filter((other) => (other.id as string) !== id);
    this.issues.push(...validateDefinition(definition, others));
    this.definitions.set(id, definition);
  }

  public list(): readonly StudioDefinition[] {
    return [...this.definitions.values()];
  }

  public listByAvailability(availability: StudioAvailability): readonly StudioDefinition[] {
    return this.list().filter((definition) => definition.availability === availability);
  }

  public get(id: string): StudioDefinition | undefined {
    return this.definitions.get(id) ?? this.bySlug(id);
  }

  public bySlug(slug: string): StudioDefinition | undefined {
    return this.list().find((definition) => (definition.slug as string) === slug);
  }

  /** Throws for unknown ids. Use at boundaries where the id came from a validated route. */
  public require(id: string): StudioDefinition {
    const found = this.get(id);
    if (!found) throw new Error(`Unknown studio: ${id}`);
    return found;
  }

  public countByAvailability(): Record<StudioAvailability, number> {
    const counts: Record<StudioAvailability, number> = {
      available: 0,
      'in-development': 0,
      planned: 0,
      exploratory: 0,
    };
    for (const definition of this.list()) counts[definition.availability] += 1;
    return counts;
  }

  public capabilitiesByStatus(studioId: string): Record<CapabilityStatus, readonly string[]> {
    const definition = this.get(studioId);
    const capabilities = definition?.capabilities ?? [];
    const labels = (status: CapabilityStatus): readonly string[] =>
      capabilities
        .filter((capability) => capability.status === status)
        .map((capability) => capability.label);

    return {
      available: labels('available'),
      planned: labels('planned'),
      exploratory: labels('exploratory'),
    };
  }

  /** Case-insensitive search across name, tagline, purpose and what the studio produces. */
  public search(query: string): readonly StudioDefinition[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.list();
    return this.list().filter((definition) =>
      [
        definition.name,
        definition.tagline,
        definition.purpose,
        ...definition.produces,
        ...definition.capabilities.map((capability) => capability.label),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }

  /** Structural problems found while registering definitions. CI asserts this is empty. */
  public getRegistryIssues(): readonly StudioRegistryIssue[] {
    return this.issues;
  }
}

export function createStudioId(value: string): StudioId {
  return brand<'StudioId'>(value);
}

export function createStudioSlug(value: string): StudioSlug {
  return brand<'StudioSlug'>(value);
}
