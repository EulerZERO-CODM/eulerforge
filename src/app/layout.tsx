import type { Metadata, Viewport } from 'next';

import { AppShell } from '../components/shell/app-shell';
import { env } from '../config/env';
import { ForgeProvider } from '../state/forge-provider';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: {
    default: "Euler's Forge — Create anything. Learn everything.",
    template: "%s · Euler's Forge",
  },
  description:
    'A browser-first creative platform: set up real design documents, learn the craft inside the tools, and follow honest build status for photo, video, motion, illustration and 3D studios.',
  applicationName: "Euler's Forge",
  keywords: [
    'design',
    'photo editing',
    'motion graphics',
    'illustration',
    'learning',
    'creative tools',
  ],
  openGraph: {
    title: "Euler's Forge",
    description: 'Create anything. Learn everything.',
    type: 'website',
    url: env.siteUrl,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0a0c10',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <ForgeProvider>
          <AppShell>{children}</AppShell>
        </ForgeProvider>
      </body>
    </html>
  );
}
