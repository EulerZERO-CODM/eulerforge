/**
 * Licence records.
 *
 * Summaries are plain-language on purpose: a user must be able to tell whether attribution is
 * required before dropping an asset into client work. `forge-sample` is the licence that applies to
 * the bundled sample records shipped in Phase 1 — it is *not* a production licence for third-party
 * content, and the UI says so.
 */

import type { AssetLicense, AssetLicenseId } from './types';

export const LICENSES: Readonly<Record<AssetLicenseId, AssetLicense>> = {
  'forge-sample': {
    id: 'forge-sample',
    name: "Euler's Forge sample content",
    attributionRequired: false,
    commercialUse: false,
    shareAlike: false,
    summary:
      'Placeholder content authored for this repository so the catalogue can be explored. Use it to learn and experiment; do not ship it in commercial work and do not treat it as a production-ready asset library.',
  },
  'cc0-1.0': {
    id: 'cc0-1.0',
    name: 'Creative Commons Zero 1.0',
    spdxId: 'CC0-1.0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attributionRequired: false,
    commercialUse: true,
    shareAlike: false,
    summary:
      'Dedicated to the public domain. Use it for anything, including commercial work, without credit.',
  },
  'cc-by-4.0': {
    id: 'cc-by-4.0',
    name: 'Creative Commons Attribution 4.0',
    spdxId: 'CC-BY-4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    attributionRequired: true,
    commercialUse: true,
    shareAlike: false,
    summary: 'Free to use and adapt, including commercially, as long as you credit the creator.',
  },
  'ofl-1.1': {
    id: 'ofl-1.1',
    name: 'SIL Open Font License 1.1',
    spdxId: 'OFL-1.1',
    url: 'https://openfontlicense.org/',
    attributionRequired: true,
    commercialUse: true,
    shareAlike: true,
    summary:
      'Standard licence for open fonts: embed and redistribute freely, keep the copyright notice, and do not sell the font on its own.',
  },
  'apache-2.0': {
    id: 'apache-2.0',
    name: 'Apache License 2.0',
    spdxId: 'Apache-2.0',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
    attributionRequired: true,
    commercialUse: true,
    shareAlike: false,
    summary:
      'Permissive licence with an explicit patent grant. Keep the notice file with redistributed code.',
  },
  mit: {
    id: 'mit',
    name: 'MIT License',
    spdxId: 'MIT',
    url: 'https://opensource.org/license/mit',
    attributionRequired: true,
    commercialUse: true,
    shareAlike: false,
    summary: 'Very permissive: use, modify and redistribute, keeping the copyright notice.',
  },
  proprietary: {
    id: 'proprietary',
    name: 'Proprietary / licensed',
    attributionRequired: true,
    commercialUse: false,
    shareAlike: false,
    summary:
      'Restricted licence. Availability is limited to the account or seat that licensed it, and redistribution is not permitted.',
  },
};

export const LICENSE_LIST: readonly AssetLicense[] = Object.values(LICENSES);

export function getLicense(id: AssetLicenseId): AssetLicense {
  return LICENSES[id];
}
