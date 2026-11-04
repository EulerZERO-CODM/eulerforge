import type { Metadata } from 'next';

import { AccountPanel } from '../../components/account/account-panel';
import { SettingsView } from '../../components/settings/settings-view';
import { PageHeader } from '../../components/ui/section';

export const metadata: Metadata = {
  title: 'Settings',
  description:
    'Document defaults, catalogue behaviour, accessibility and local data management. Device-local only.',
};

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Settings"
        lead="These settings apply to this browser. Work does not require an account: syncing to a server you run is optional, and this page says exactly what that server would store."
      />
      <SettingsView />
      <AccountPanel />
    </div>
  );
}
