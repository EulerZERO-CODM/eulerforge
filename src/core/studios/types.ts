/**
 * Studio domain model.
 *
 * A *studio* is a specialist editing environment (design, photo, video …). Studios are declared as
 * data so that the shell, navigation, discovery pages and roadmap can all be driven from one
 * registry — adding a discipline must not require rewriting the application shell (ADR-0002).
 *
 * This module and everything under `src/core/studios` is framework-free: no React, no DOM. The icon
 * is referenced by name and resolved to a component in the presentation layer.
 */

import type { DocumentTypeId } from '../documents/types';
import type { Branded } from '../types/brand';

export type StudioId = Branded<string, 'StudioId'>;
export type StudioSlug = Branded<string, 'StudioSlug'>;

/**
 * `available` — a working entry point exists and the UI may link to it.
 * `in-development` — build work has started; the entry point exists but is explicitly partial.
 * `planned` — designed and scheduled, not started.
 * `exploratory` — a real possibility under evaluation; no commitment to a technology yet.
 */
export type StudioAvailability = 'available' | 'in-development' | 'planned' | 'exploratory';

export const STUDIO_AVAILABILITY_LABELS: Readonly<Record<StudioAvailability, string>> = {
  available: 'Available now',
  'in-development': 'In development',
  planned: 'Planned',
  exploratory: 'Exploratory',
};

/** Accent token names; the mapping to concrete colours lives in the presentation layer. */
export type StudioAccent = 'cobalt' | 'ember' | 'plum' | 'teal' | 'violet' | 'slate';

/** Icon names resolved by `src/components/studios/studio-icon.tsx`. */
export type StudioIconName = 'layout' | 'aperture' | 'film' | 'keyframe' | 'pen' | 'cube';

export type CapabilityStatus = 'available' | 'planned' | 'exploratory';

export const CAPABILITY_STATUS_LABELS: Readonly<Record<CapabilityStatus, string>> = {
  available: 'Ready to use',
  planned: 'Planned',
  exploratory: 'Exploratory',
};

export type StudioCapability = {
  readonly id: string;
  readonly label: string;
  readonly status: CapabilityStatus;
  /** One sentence a beginner can act on. */
  readonly detail: string;
};

/**
 * How this studio will plug into Forge Core.
 *
 * Recorded now because the answer differs per discipline — forcing all of them through one renderer
 * is the mistake this platform is designed to avoid (ADR-0004).
 */
export type StudioEngineBoundary = {
  /** Rendering/interaction technology this studio is expected to use. */
  readonly renderer: string;
  /** Supporting infrastructure (decoding, encoding, geometry, …). */
  readonly pipeline: string;
  /** Where the integration will live once implemented. */
  readonly integrationPoint: string;
  readonly rationale: string;
};

export type StudioEntryPoint = {
  /** Internal route to the studio entry screen, or `null` while the studio is not usable. */
  readonly route: string | null;
  /** Button/verb label, e.g. "Open design workspace". */
  readonly label: string;
};

export type StudioDefinition = {
  readonly id: StudioId;
  readonly slug: StudioSlug;
  readonly name: string;
  /** One-line promise shown on cards. */
  readonly tagline: string;
  /** Two or three sentences for the studio detail page. */
  readonly purpose: string;
  readonly icon: StudioIconName;
  readonly accent: StudioAccent;
  readonly availability: StudioAvailability;
  /** Honest maturity statement rendered next to the availability badge. */
  readonly maturityNote: string;
  /** Things this studio is meant to produce, phrased for a newcomer. */
  readonly produces: readonly string[];
  readonly documentTypes: readonly DocumentTypeId[];
  readonly capabilities: readonly StudioCapability[];
  readonly engine: StudioEngineBoundary;
  readonly entry: StudioEntryPoint;
  /** Slugs of learning lessons that onboard into this studio. */
  readonly learningSlugs: readonly string[];
  /** Studios whose output this one will be able to consume. */
  readonly consumesFrom: readonly StudioId[];
  /** Definition revision, bumped when the contract changes in a breaking way. */
  readonly definitionVersion: number;
};
