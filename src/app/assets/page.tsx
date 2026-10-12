import type { Metadata } from 'next';

import { AssetCatalogue } from '../../components/assets/asset-catalogue';
import { PageHeader } from '../../components/ui/section';
import { SAMPLE_ASSETS } from '../../core/assets/data';

export const metadata: Metadata = {
  title: 'Assets',
  description:
    'A paginated, licence-aware asset catalogue. This build ships clearly-labelled sample records, not a production asset library.',
};

export default function AssetsPage() {
  const samples = SAMPLE_ASSETS.filter((asset) => asset.status === 'sample').length;
  const planned = SAMPLE_ASSETS.length - samples;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Asset catalogue"
        lead={`${SAMPLE_ASSETS.length} records bundled: ${samples} clearly-labelled samples authored for this repository and ${planned} planned-integration records that document intended metadata. Nothing here is a licensed production asset, and no third-party files are shipped.`}
      />
      <AssetCatalogue />
    </div>
  );
}
