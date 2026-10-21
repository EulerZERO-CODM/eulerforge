import { expect, test, type Page } from '@playwright/test';

import { STORAGE_KEY, addLayer, createProject, layerRow, stored } from './fixtures';

/**
 * The promises a person relies on when they open this app for the first time.
 *
 * The rest of the browser suite drives a 1440 × 960 window on a machine where the optional server is
 * running. Those are the wrong assumptions for three of the product's claims:
 *
 *   - **Small screens work.** A laptop is not the only device; the navigation has a drawer and the
 *     workspace stacks, and neither is worth anything if nobody checks it at a phone's width.
 *   - **No server is required.** Local-first means every studio keeps working when the optional
 *     server is unreachable — not only when it happens to be running.
 *   - **Damaged storage is survivable.** A half-written record must produce a sentence and a way out,
 *     never a blank page or a silent overwrite of the user's other projects.
 *
 * Each test starts from a clean browser profile, so nothing here depends on a previous spec.
 */

const PHONE = { width: 390, height: 844 } as const;

/**
 * Collects uncaught exceptions: a page that throws is not usable even if it still renders.
 *
 * The route is part of each entry — a hydration mismatch is reported by React as a minified error on
 * the console, and without the path the message says nothing about where to look.
 */
function watchForCrashes(page: Page): string[] {
  const crashes: string[] = [];
  page.on('pageerror', (error) => {
    crashes.push(`[${new URL(page.url()).pathname}] ${error.message}`);
  });
  return crashes;
}

/** The page must not scroll sideways: a sideways scrollbar on a phone hides controls off-screen. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page scrolls horizontally').toBeLessThanOrEqual(1);
}

test.describe('a phone-sized screen', () => {
  test.use({ viewport: PHONE });

  test('navigates with the drawer, then creates, saves, reopens and exports a project', async ({
    page,
  }) => {
    const crashes = watchForCrashes(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The sidebar is hidden at this width; the drawer is the navigation.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Studios' }).click();
    await expect(page).toHaveURL(/\/studios$/);
    await expect(page.getByRole('heading', { name: 'Studios', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
    await expectNoHorizontalOverflow(page);

    // A project, made and saved at this width through the same controls a person sees.
    await createProject(page, { title: 'Phone project', width: 320, height: 240 });
    await expectNoHorizontalOverflow(page);
    await addLayer(page, 'Rectangle');
    await expect(layerRow(page, 'Rectangle')).toBeVisible();

    // The save indicator is the product's own statement that the write landed.
    await expect(page.getByText(/^Saved/).first()).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(layerRow(page, 'Rectangle')).toBeVisible();
    const reopened = await stored(page);
    expect(reopened.title).toBe('Phone project');
    expect(reopened.canvas.width).toBe(320);
    expect(reopened.canvas.height).toBe(240);

    // A real download from the phone-width layout, with the document's own pixel size.
    await page.getByLabel('Format', { exact: true }).selectOption({ label: 'PNG (.png)' });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export PNG' }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('the PNG download produced no file');
    const bytes = await (await import('node:fs/promises')).readFile(path);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.readUInt32BE(16)).toBe(320);
    expect(bytes.readUInt32BE(20)).toBe(240);

    expect(crashes).toEqual([]);
  });
});

test.describe('without the optional server', () => {
  test('keeps every studio, save, reopen and export working when the API is unreachable', async ({
    page,
  }) => {
    const crashes = watchForCrashes(page);
    // The strongest form of "no server": every API request fails at the network layer, exactly as it
    // would on a static host or with the server stopped.
    await page.route('**/api/**', (route) => route.abort('failed'));

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(
      page.getByText(
        'The optional server could not be reached. Everything still works in this browser.',
      ),
    ).toBeVisible();

    await createProject(page, { title: 'Offline project', width: 300, height: 200 });
    await addLayer(page, 'Ellipse');
    await page.reload();
    await expect(layerRow(page, 'Ellipse')).toBeVisible();

    await page.goto('/projects');
    await expect(page.getByRole('link', { name: /Offline project/ })).toBeVisible();

    // The account panel states the situation as a working state, not a failure.
    await page.goto('/settings');
    await expect(page.getByText('Working locally, as designed')).toBeVisible();
    await expect(page.getByText(/could not be reached/i).first()).toBeVisible();

    expect(crashes).toEqual([]);
  });
});

test.describe('damaged saved data', () => {
  test('reports the damage, keeps the page usable and lets the owner clear it', async ({
    page,
  }) => {
    const crashes = watchForCrashes(page);
    // A record that was truncated (a tab closed mid-write, a hand-edited key, a half-synced file).
    // It is written once, after the first load: an init script would put it back after the reset this
    // test performs, which is not what a damaged record does.
    await page.goto('/');
    await page.evaluate(
      ([key]) => {
        window.localStorage.setItem(String(key), '{"schemaVersion":1,"documents":[{');
      },
      [STORAGE_KEY],
    );

    await page.goto('/projects');
    await expect(page.getByText('The project library could not be read')).toBeVisible();
    // The reason, the recovery step and the raw parser message are all shown: a person gets a
    // sentence, the person helping them gets the detail, and nobody has to guess where the reset is.
    await expect(
      page
        .locator('#main-content')
        .getByText(
          'The saved project index could not be read. Nothing was deleted — clear it in Settings › Local data to start again.',
        ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open storage settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    // The rest of the product still renders around the failure.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

    // The damaged value is still there: opening the library must not quietly erase what it could not
    // read, so the way out is an explicit choice in Settings.
    const stillStored = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(stillStored).toContain('"documents"');

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Clear all local data' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm.getByText('Delete every locally stored project?')).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete everything' }).click();
    await expect(page.getByText('Local data cleared')).toBeVisible({ timeout: 15_000 });

    // After the deliberate reset the product is fully usable again.
    await page.goto('/projects');
    await createProject(page, { title: 'After the reset', width: 320, height: 240 });
    await addLayer(page, 'Text');
    await page.reload();
    await expect(layerRow(page, 'Text')).toBeVisible();

    expect(crashes).toEqual([]);
  });
});

test.describe('a first visit', () => {
  test('starts empty without pretending, and every destination exists', async ({ page }) => {
    const crashes = watchForCrashes(page);

    // Nothing stored yet: the home screen offers a way in rather than a blank page.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(
      page.getByRole('link', { name: /New project|Create a project/i }).first(),
    ).toBeVisible();

    // The empty library says it is empty, says where projects live, and offers the way in.
    await page.goto('/projects');
    await expect(page.getByText('Your library is empty')).toBeVisible();
    await expect(page.getByText(/stored in this browser on this device/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create a project' }).first()).toBeVisible();

    // Every studio page loads at a laptop width and offers its own entry point.
    for (const studio of ['design', 'illustration', 'photo', 'motion', 'video']) {
      await page.goto(`/studios/${studio}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page.getByRole('link', { name: /Create a project/i }).first()).toBeVisible();
    }

    // An unknown route is a real 404 page with destinations, not an empty render.
    const missing = await page.goto('/this-page-does-not-exist');
    expect(missing?.status()).toBe(404);
    await expect(page.getByText('That page does not exist')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse studios' })).toBeVisible();

    // A share link that cannot resolve explains itself instead of showing a broken document.
    await page.goto('/shared/not-a-real-token');
    await expect(page.getByText('This link does not open')).toBeVisible();
    await expect(page.getByText(/Links expire/)).toBeVisible();

    // The static pages that make the product's claims render without a server.
    for (const route of ['/roadmap', '/platform-status', '/learn', '/assets', '/settings']) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    }

    expect(crashes).toEqual([]);
  });
});

test.describe('every studio on a phone', () => {
  test.use({ viewport: PHONE });

  test('lays out without a sideways scroll', async ({ page }) => {
    for (const studio of ['design', 'illustration', 'photo', 'motion', 'video']) {
      await page.goto(`/studios/${studio}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    for (const route of ['/', '/projects', '/roadmap', '/settings']) {
      await page.goto(route);
      await expectNoHorizontalOverflow(page);
    }
  });
});
