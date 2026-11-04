import type { Metadata } from 'next';

import { SharedDocumentView } from '../../../components/account/shared-document-view';

/**
 * A read-only view of a shared document.
 *
 * The page is deliberately thin and server-rendered around a client component: the token is the
 * capability, it is checked by the API, and the page itself holds no session and shows no account
 * information. A link that has expired or been revoked gets the API's own sentence, not a fake page.
 */
export const metadata: Metadata = {
  title: 'Shared project',
  robots: { index: false, follow: false },
};

export default async function SharedPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <SharedDocumentView token={token} />
    </div>
  );
}
