import { PLATFORM_CAPABILITIES, type PlatformCapability } from './status';

/** Lookup helper for the capability ledger, shared by the roadmap and status pages. */
export function getCapability(id: string): PlatformCapability | undefined {
  return PLATFORM_CAPABILITIES.find((capability) => capability.id === id);
}

export function capabilityLabel(id: string): string {
  return getCapability(id)?.label ?? id;
}
