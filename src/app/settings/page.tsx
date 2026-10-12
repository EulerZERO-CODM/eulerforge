import type { Metadata } from 'next';

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
        lead="These settings apply to this browser. There is no account yet, so nothing here follows you to another device — and if a setting does not exist, this page says so rather than showing a control that does nothing."
      />
      <SettingsView />
    </div>
  );
}
