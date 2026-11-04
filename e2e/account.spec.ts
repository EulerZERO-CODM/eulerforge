import { expect, test, type Page } from '@playwright/test';

import { createProject } from './fixtures';

/**
 * The optional account server, end to end in a real browser.
 *
 * The unit suite mocks the network and the server suite calls route handlers directly; this spec is
 * the only place both halves meet: a real Chromium session, a real cookie, the real Next server and
 * the real JSON store on disk. It registers an account with a unique address, pushes a local project,
 * proves a second sync has nothing to do, shares it and opens the link, then deletes the account and
 * checks the link is dead — the data-deletion promise, exercised rather than described.
 */

const PASSWORD = 'a correct horse battery';

function email(): string {
  return `e2e-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}@example.test`;
}

async function openAccount(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: /Account and sync/ })).toBeVisible();
  // The panel asks the server whether it is running; wait for the answer before touching the form.
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
}

async function registerAccount(page: Page, address: string): Promise<void> {
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Name to show').fill('Browser Ada');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  // The address appears in the success notice as well as the profile; either is the same account.
  await expect(page.getByText(address).first()).toBeVisible();
}

test.describe('optional accounts and sync', () => {
  test('registers, syncs a real project, shares it, and deletes the account with its data', async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180_000);
    const address = email();

    // A real project, created through the product's own flow: sync moves documents, not fixtures.
    await createProject(page, { title: 'Sync proof' });

    await openAccount(page);
    await expect(
      page.getByText(/Work stays in this browser unless you choose to sync it/),
    ).toBeVisible();
    await registerAccount(page, address);

    // The plan names the local project and says why it would be uploaded.
    await page.getByRole('button', { name: 'Check what would change' }).click();
    const plan = page.getByTestId('sync-plan');
    await expect(plan.getByText('Sync proof')).toBeVisible();
    await expect(plan.getByText('Only in this browser.')).toBeVisible();

    await page.getByRole('button', { name: 'Run sync' }).click();
    await expect(page.getByText(/Sync finished\. Nothing was overwritten/)).toBeVisible({
      timeout: 30_000,
    });

    // A second plan has nothing to do: the agreement was remembered.
    await page.getByRole('button', { name: 'Check what would change' }).click();
    await expect(page.getByTestId('sync-plan').getByText('Matches the server.')).toBeVisible();

    // A share link, opened in another browser context with no cookie at all.
    await page.getByRole('button', { name: 'Create link' }).click();
    const link = page.getByTestId('share-link');
    await expect(link).toBeVisible();
    const url = (await link.textContent())?.trim() ?? '';
    expect(url).toMatch(/\/shared\/[A-Za-z0-9_-]{43}$/);

    const guest = await browser.newContext();
    try {
      const guestPage = await guest.newPage();
      await guestPage.goto(url);
      await expect(guestPage.getByRole('heading', { name: 'Sync proof', level: 1 })).toBeVisible();
      await expect(guestPage.getByText(/read-only snapshot/)).toBeVisible();
      // No session in the guest context: signing in is not required to read a shared link.
      const cookies = await guest.cookies();
      expect(cookies.map((cookie) => cookie.name)).not.toContain('forge_session');
    } finally {
      await guest.close();
    }

    // Signing out ends this browser's session and leaves local work alone.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText('Signed out. Local work is untouched.')).toBeVisible();
    // The form keeps the mode it was last in, so choose sign-in explicitly. Both the mode switch and
    // the submit button are called "Sign in", so the switch is addressed inside its own group.
    await page
      .getByRole('group', { name: 'Account action' })
      .getByRole('button', { name: 'Sign in' })
      .click();
    await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
    await page.goto('/projects');
    await expect(page.getByText('Sync proof').first()).toBeVisible();

    // Sign back in and delete the account; the share link must stop working immediately.
    await openAccount(page);
    await page.getByLabel('Email').fill(address);
    await page.getByLabel('Password').fill(PASSWORD);
    await page
      .getByRole('form', { name: 'Sign in' })
      .getByRole('button', { name: 'Sign in' })
      .click();
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();

    await page.getByLabel('Type “delete my account” to confirm').fill('delete my account');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByText(/The account and its server-side data were deleted/)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Account action' })).toBeVisible();

    const afterDeletion = await context.newPage();
    try {
      await afterDeletion.goto(url);
      await expect(afterDeletion.getByText(/This link does not open/)).toBeVisible();
    } finally {
      await afterDeletion.close();
    }
  });
});
