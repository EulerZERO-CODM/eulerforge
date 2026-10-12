/**
 * User preferences (device-local).
 *
 * Preferences are deliberately small: defaults for new documents plus display behaviour. Anything
 * that would require an account (synced settings, teams, billing) is out of scope and is presented
 * as such in Settings.
 */

import { z } from 'zod';

import { PROJECT_FILE_FORMAT_ID } from '../export/formats';
import { DEFAULT_GUIDES } from '../documents/factories';
import { LENGTH_UNITS } from '../documents/units';
import type { GuideSettings } from '../documents/types';

export const preferencesSchema = z.object({
  /** Unit applied to new documents. */
  defaultUnit: z.enum(['px', 'mm', 'in']).default('px'),
  /** Format preselected in the workspace export panel. */
  defaultExportFormatId: z.string().min(1).default(PROJECT_FILE_FORMAT_ID),
  /** Guide configuration applied to new documents. */
  defaultGuides: z
    .object({
      safeMarginMm: z.number().min(0).max(100),
      bleedMm: z.number().min(0).max(50),
      showGrid: z.boolean(),
      gridMm: z.number().min(1).max(100),
      showCentreLines: z.boolean(),
    })
    .default(DEFAULT_GUIDES),
  /** Rows per page in the asset catalogue. */
  cataloguePageSize: z.number().int().min(4).max(48).default(12),
  /**
   * Motion preference. `system` respects the OS setting; the other values override it.
   * Stored rather than inferred so the choice is inspectable and testable.
   */
  motion: z.enum(['system', 'reduce', 'allow']).default('system'),
  /** Hide studios that are not implemented yet from discovery listings. */
  hideUpcomingStudios: z.boolean().default(false),
  /** Studio preselected in the creation flow. */
  preferredStudioId: z.string().min(1).default('design'),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = preferencesSchema.parse({});

export const PREFERENCE_SECTIONS = ['documents', 'catalogue', 'accessibility', 'data'] as const;
export type PreferenceSection = (typeof PREFERENCE_SECTIONS)[number];

export type PreferenceFieldDefinition = {
  readonly key: keyof Preferences;
  readonly section: PreferenceSection;
  readonly label: string;
  readonly description: string;
};

/** Field metadata so the settings UI and tests agree on what is user-configurable. */
export const PREFERENCE_FIELDS: readonly PreferenceFieldDefinition[] = [
  {
    key: 'defaultUnit',
    section: 'documents',
    label: 'Default unit',
    description: 'Unit applied when a new document is created.',
  },
  {
    key: 'defaultGuides',
    section: 'documents',
    label: 'Default guides',
    description: 'Safe margin, bleed and grid applied to new documents.',
  },
  {
    key: 'preferredStudioId',
    section: 'documents',
    label: 'Preferred studio',
    description: 'Studio preselected in the creation flow.',
  },
  {
    key: 'defaultExportFormatId',
    section: 'documents',
    label: 'Default export format',
    description: 'Format preselected in the workspace export panel.',
  },
  {
    key: 'cataloguePageSize',
    section: 'catalogue',
    label: 'Catalogue page size',
    description: 'How many asset records load per page.',
  },
  {
    key: 'hideUpcomingStudios',
    section: 'catalogue',
    label: 'Hide upcoming studios',
    description: 'Show only studios that can be opened today.',
  },
  {
    key: 'motion',
    section: 'accessibility',
    label: 'Motion',
    description: 'Follow the system setting, or always reduce or allow interface motion.',
  },
] as const;

export function guideDefaultsFromPreferences(preferences: Preferences): GuideSettings {
  return { ...preferences.defaultGuides };
}

export { LENGTH_UNITS };
