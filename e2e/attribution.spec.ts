import { expect, test, type Page } from '@playwright/test';

import { SAMPLE_ASSETS } from '../src/core/assets/data';
import { isPlaceable } from '../src/core/assets/types';
import {
  STORAGE_KEY,
  createProject,
  selectLayerFromList,
  storedWhen,
  type StoredAttribution,
} from './fixtures';

/**
 * Attribution, after the project is closed and reopened.
 *
 * Placing a catalogue graphic copies its licence and provenance into the *document*, so the record
 * survives the catalogue changing, the project being shared, and the catalogue not being reachable at
 * all. The panel is transient - it appears when a graphic layer is selected, which is not persisted -
 * so this spec places a real graphic through the product's own picker, leaves the project, comes back
 * through the library, reselects the layer and compares what the interface shows with the record in
 * the saved document *and* with the catalogue it came from.
 *
 * The third spec goes further: it edits the saved record and shows that the panel follows the
 * document rather than re-deriving anything from the catalogue, which is the promise ADR-0008 makes.
 *
 * The provenance warning: every catalogue record that can be placed in this build is verified, so the
 * amber "not been verified" line cannot be reached through the picker. The third spec reaches it by
 * saving a document whose record is not verified, which is what a document written before
 * verification - or under a different catalogue - looks like.
 */

const PLACED = 'Aurora mesh';

/** Opens the graphic picker and places the named catalogue graphic with a click. */
async function placeGraphic(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Graphic', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Place a graphic' });
  await expect(picker).toBeVisible();
  await picker.getByLabel('Search graphics').fill(name);
  await picker
    .locator('li')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Place on canvas' })
    .click();
  await expect(picker).toBeHidden();
}

/** Reads a stored record and rewrites its fields, the way a document from another catalogue would. */
async function patchStoredAttribution(
  page: Page,
  patch: Partial<StoredAttribution>,
): Promise<void> {
  await page.evaluate(
    ({ key, patch }) => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) throw new Error('no document has been saved yet');
      const envelope = JSON.parse(raw) as { documents?: Record<string, unknown>[] };
      const document = envelope.documents?.[0];
      if (!document) throw new Error('the saved envelope holds no document');
      const records = document['attribution'];
      if (!Array.isArray(records) || records.length === 0) {
        throw new Error('the document holds no attribution record');
      }
      records[0] = { ...(records[0] as Record<string, unknown>), ...patch };
      window.localStorage.setItem(key, JSON.stringify(envelope));
    },
    { key: STORAGE_KEY, patch },
  );
}

test.describe('attribution after reopening a project', () => {
  test('shows the licence recorded in the document, compared with the catalogue it came from', async ({
    page,
  }) => {
    await createProject(page, { title: 'Attribution check', width: 400, height: 300 });
    await placeGraphic(page, PLACED);

    // Placing a graphic adds the layer but does not select it, so the spec selects it the way a person
    // would, from the layer list, before capturing what the panel says. The layer carries the
    // catalogue's own name, which is how it can be found again after a reopen.
    await selectLayerFromList(page, PLACED);
    const placedPanel = page.getByTestId('attribution-panel');
    await expect(placedPanel).toBeVisible();
    const placedText = (await placedPanel.innerText()).replace(/\s+/g, ' ').trim();

    // The document and its attribution reached the store.
    const saved = await storedWhen(
      page,
      (document) => document.attribution.length === 1,
      'the placed graphic should have recorded its attribution',
    );
    const record = saved.attribution[0];
    if (!record) throw new Error('the document has no attribution record');

    // Field by field, the saved record is the catalogue's own data.
    const catalogue = SAMPLE_ASSETS.find((asset) => String(asset.id) === record.assetId);
    if (!catalogue) throw new Error(`no catalogue record for ${record.assetId}`);
    expect(isPlaceable(catalogue)).toBe(true);
    expect(record.assetName).toBe(catalogue.name);
    expect(record.licenseId).toBe(catalogue.license.id);
    expect(record.licenseName).toBe(catalogue.license.name);
    expect(record.author).toBe(catalogue.provenance.author);
    expect(record.source).toBe(catalogue.provenance.source);
    expect(record.attributionRequired).toBe(catalogue.license.attributionRequired);
    expect(record.commercialUse).toBe(catalogue.license.commercialUse);
    expect(record.verified).toBe(catalogue.provenance.verified);
    // The layer carries the catalogue name, which is how it can be found again in the layer list.
    expect(saved.scene.layers.map((layer) => layer.name)).toEqual([catalogue.name]);

    // Leave the project and reopen it through the library, as a person would.
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Attribution check' }).click();
    await expect(page.getByTestId('artboard')).toBeVisible();
    await expect(page).toHaveURL(/\/workspace\//);

    // Nothing is selected after a reopen - selection never reached the document - so the panel is
    // gone and the record is still there. That split is the point of the design.
    await expect(page.getByTestId('attribution-panel')).toHaveCount(0);

    await selectLayerFromList(page, catalogue.name);
    const panel = page.getByTestId('attribution-panel');
    await expect(panel).toBeVisible();

    // Every value on the panel now comes from the saved record, and the panel reads the same as it
    // did when the graphic was first placed.
    await expect(panel).toContainText('Attribution recorded');
    await expect(panel).toContainText(record.assetName);
    await expect(panel).toContainText(
      `${record.licenseName} · ${record.author} · via ${record.source}`,
    );
    await expect(panel).toContainText(
      record.attributionRequired
        ? 'Credit is required when this is published.'
        : 'No credit required by the licence.',
    );
    await expect(panel).toContainText(
      record.commercialUse ? 'Commercial use allowed.' : 'Non-commercial use only.',
    );
    const unverified = 'Provenance for this record has not been verified.';
    if (record.verified) await expect(panel).not.toContainText(unverified);
    else await expect(panel).toContainText(unverified);

    const reopenedText = (await panel.innerText()).replace(/\s+/g, ' ').trim();
    expect(reopenedText).toBe(placedText);

    // The catalogue and the document agree on the licence text the user is being shown.
    expect(record.licenseName).toBe(catalogue.license.name);
  });

  test('offers reference-only records with a reason instead of a control that cannot work', async ({
    page,
  }) => {
    await createProject(page, { title: 'Reference records', width: 400, height: 300 });
    await page.getByRole('button', { name: 'Graphic', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Place a graphic' });
    await picker.getByLabel('Search graphics').fill('Geometric marks');

    // A catalogue record with no file in this build is listed as a reference record, under the
    // catalogue's own explanation, and it offers no placement control at all.
    const reference = picker
      .getByRole('note')
      .filter({ hasText: 'Reference records in this result' });
    await expect(reference).toContainText('Geometric marks');
    await expect(reference.getByRole('button')).toHaveCount(0);

    // Nothing was added to the document by looking at the catalogue.
    const saved = await storedWhen(
      page,
      (document) => document.scene.layers.length === 0,
      'a reference record must not become a layer',
    );
    expect(saved.attribution).toEqual([]);
  });

  test('follows the record saved in the document rather than the catalogue it came from', async ({
    page,
  }) => {
    await createProject(page, { title: 'Saved record wins', width: 400, height: 300 });
    await placeGraphic(page, PLACED);
    await storedWhen(
      page,
      (document) => document.attribution.length === 1,
      'the placed graphic should have recorded its attribution',
    );

    // Rewrite the saved record: a licence, author and provenance that the catalogue does not hold,
    // and a provenance that has not been verified. The document is the authority for its own
    // records, so this is what the panel must show.
    await patchStoredAttribution(page, {
      assetName: 'Archived badge',
      licenseName: 'Archive licence 1.0',
      attributionRequired: true,
      commercialUse: true,
      author: 'Ada Lovelace',
      source: 'archive',
      verified: false,
    });

    await page.goto('/projects');
    await page.getByRole('link', { name: 'Saved record wins' }).click();
    // The layer keeps the name it was placed with; only the licence record was rewritten.
    await selectLayerFromList(page, PLACED);

    const panel = page.getByTestId('attribution-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Archived badge');
    await expect(panel).toContainText('Archive licence 1.0 · Ada Lovelace · via archive');
    await expect(panel).toContainText('Credit is required when this is published.');
    await expect(panel).toContainText('Commercial use allowed.');
    await expect(panel).toContainText('Provenance for this record has not been verified.');
    // ...and nothing of the catalogue record it was placed from is left in the panel.
    await expect(panel).not.toContainText('Euler');
    await expect(panel).not.toContainText('bundled-sample');
  });
});
