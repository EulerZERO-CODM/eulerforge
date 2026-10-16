import { expect, test, type Page } from '@playwright/test';

import { createProject, historyLabels, selectLayerFromList } from './fixtures';

/**
 * Storage the browser refuses.
 *
 * Private windows, blocked site data and disabled cookies all make browser storage throw - either on
 * access or on the first write - and the application has a real fallback for that: an in-memory
 * store for the tab, with the interface saying so. This spec reproduces the refusal *before* the
 * application initialises and then checks the promises the product makes in ADR-0006:
 *
 *   - the app starts and stays usable,
 *   - it says the work is in memory only and what that costs,
 *   - it never claims a durable save it cannot deliver,
 *   - creating and editing work for the session, and
 *   - a reload loses the project, and the app says so honestly instead of pretending.
 *
 * The test never reads storage itself and the application has no test-only mode: the only thing that
 * changes is the browser's behaviour. Every assertion reads the interface - the notice, the save
 * indicator, the layer list, the history rail - because the interface is what has to be honest here.
 */

/**
 * Makes browser storage refuse writes and reads, the way a private window does.
 *
 * Three layers of the same refusal, because browsers differ in which one throws: the property
 * itself (disabled cookies throw on access), the `Storage` methods (some private modes expose the
 * API and throw on the write), and `sessionStorage` for symmetry. Nothing is stubbed in the
 * application: `createBrowserStorage()` catches this and reports `volatile`/`restricted`.
 */
async function denyStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const deny = (): never => {
      throw new DOMException(
        'Access to storage is not allowed from this context.',
        'SecurityError',
      );
    };
    for (const target of [window, Object.getPrototypeOf(window) as object]) {
      try {
        Object.defineProperty(target, 'localStorage', { configurable: true, get: deny });
        Object.defineProperty(target, 'sessionStorage', { configurable: true, get: deny });
      } catch {
        // Some browsers define these as non-configurable own properties; the method patch below
        // still produces the same refusal, which is what the application has to survive.
      }
    }
    for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
      try {
        Object.defineProperty(Storage.prototype, method, { configurable: true, value: deny });
      } catch {
        // Ignore: the property override above already refuses access.
      }
    }
  });
  // TEMPORARY DIAGNOSTIC: the first error the page reports arrives while React is still hydrating,
  // so the DOM at that moment is the tree React compared against the served markup.
  await page.addInitScript(() => {
    (window as unknown as { __forgeSnapshot?: string | null }).__forgeSnapshot = null;
    window.addEventListener(
      'error',
      () => {
        const store = window as unknown as { __forgeSnapshot?: string | null };
        if (store.__forgeSnapshot === null) store.__forgeSnapshot = document.body.outerHTML;
      },
      true,
    );
  });
}

test.describe('a browser that refuses to store anything', () => {
  test.beforeEach(async ({ page }) => {
    await denyStorage(page);
  });

  test('starts, says it is holding work in memory, and loses it on reload without pretending', async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on('pageerror', (error) => uncaught.push(`${error.message}\n${error.stack ?? ''}`));

    // TEMPORARY DIAGNOSTIC: React only reports an error code in a production build, so the served
    // markup and the DOM are flattened side by side and the first differences are named. The
    // snapshot is taken from the error listener, before React regenerates the tree, so a difference
    // is the mismatch itself rather than a later update.
    let served = '';
    page.on('response', (response) => {
      if (response.request().resourceType() !== 'document') return;
      void response
        .text()
        .then((body) => {
          served = body;
        })
        .catch(() => undefined);
    });

    type HydrationWindow = Window & { readonly __forgeSnapshot?: string | null };

    // The storage copy is *expected* to change here: the server says storage has not been checked and
    // the browser then reports the refusal. Comparing it would bury the mismatch under the one change
    // the spec is about, so both sides leave it out of the flattening.
    const storageCopy =
      /checking storage|stored in this browser|only in memory|not being saved to (this device|the device)|held in memory for this tab only/i;

    const describeDifference = (markup: string): Promise<string> =>
      page.evaluate((html) => {
        const skip = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'TITLE']);
        const flatten = (root: Element): string[] => {
          const lines: string[] = [];
          const walk = (node: Element, path: string): void => {
            if (storageCopy.test(node.textContent)) return;
            const own = [...node.childNodes]
              .filter((child) => child.nodeType === Node.TEXT_NODE)
              .map((child) => (child.textContent ?? '').trim())
              .join('')
              .slice(0, 70);
            const classes =
              typeof node.className === 'string' && node.className !== ''
                ? `.${node.className.split(/\s+/).slice(0, 2).join('.')}`
                : '';
            lines.push(`${path}<${node.tagName.toLowerCase()}${classes}>=${JSON.stringify(own)}`);
            [...node.children]
              .filter((child) => !skip.has(child.tagName))
              .forEach((child, index) => {
                walk(child, `${path}.${String(index)}`);
              });
          };
          walk(root, '');
          return lines;
        };

        const served = flatten(new DOMParser().parseFromString(html, 'text/html').body);
        const snapshot = (window as unknown as HydrationWindow).__forgeSnapshot ?? '';
        const sources: readonly (readonly [string, string])[] = [
          ['at-error', snapshot],
          ['live', document.body.outerHTML],
        ];
        const report: string[] = [];
        for (const [label, source] of sources) {
          if (source === '') continue;
          const live = flatten(new DOMParser().parseFromString(source, 'text/html').body);
          const found: string[] = [];
          for (let index = 0; index < Math.max(served.length, live.length); index += 1) {
            const server = served[index];
            const client = live[index];
            if (server !== client) {
              found.push(
                `#${String(index)} server ${server ?? '(absent)'} | client ${client ?? '(absent)'}`,
              );
              if (found.length >= 10) break;
            }
          }
          report.push(`${label} differences=${String(found.length)} ${found.join(' ;; ')}`);
          if (found.length > 0) break;
        }
        return report.join(' // ').slice(0, 1600);
      }, markup);

    const expectNoThrow = async (step: string): Promise<void> => {
      if (uncaught.length === 0) return;
      const diff = served === '' ? 'no served markup captured' : await describeDifference(served);
      expect(uncaught.splice(0), `${step} should not have thrown; ${diff}`).toEqual([]);
    };

    // 1. It starts. The shell renders and nothing threw on the way in.
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Primary' }).first()).toBeVisible();

    // 2. It reports memory-only storage, and explains what that means, in the user's words.
    const notice = page.getByText('Projects are not being saved to this device').first();
    await expect(notice).toBeVisible();
    const explanation = page.getByText(/held in memory for this tab only/i).first();
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText(/lost when it reloads or closes/i);
    await expect(explanation).toContainText(/export/i);

    // 3. It does not claim a durable save. Neither the persistent claim nor the persistent notice
    //    is on the page, and the claim it does make says memory only.
    await expect(page.getByText('Projects are stored in this browser only.')).toHaveCount(0);
    await expect(page.getByText(/Projects are stored in this browser on this device/)).toHaveCount(
      0,
    );
    await expect(
      page
        .getByText('Projects are only in memory and will be lost when this page reloads.')
        .first(),
    ).toBeVisible();
    await expectNoThrow('opening the home page with storage refused');

    // 4. Creating a project works for this session, through the real creation flow.
    await createProject(page, { title: 'Memory-only session', width: 320, height: 240 });
    await expect(page.getByTestId('artboard')).toBeVisible();
    await expect(notice).toBeVisible();
    await expectNoThrow('creating a project in a memory-only session');

    // 5. Editing works: a layer is added, it appears in the layer list, and the edit is recorded in
    //    the history rail. Both are read from the interface, not from storage, which the spec must
    //    not touch.
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await selectLayerFromList(page, 'Rectangle');
    expect(await historyLabels(page)).toContain('Add rectangle layer');

    // The save indicator says the change is held in memory rather than saved...
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /memory/i })
        .first(),
    ).toBeVisible();
    // ...and no status anywhere claims a save, because no save happened: the write went to memory.
    await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toHaveCount(0);
    await expectNoThrow('editing a layer in a memory-only session');

    // 6. A reload loses it, and the workspace says that rather than showing an empty editor or an
    //    error page: the project is genuinely gone, and the app is honest about why.
    await page.reload();
    await expect(page.getByText('Project not found').first()).toBeVisible();
    await expectNoThrow('reloading a project that only ever lived in memory');
    await expect(page.getByText(/may have been deleted/i).first()).toBeVisible();
    await expect(notice).toBeVisible();

    // 7. The library agrees: nothing was written, and it says so before the list.
    await page.goto('/projects');
    await expect(page.getByText('This list is not stored on this device').first()).toBeVisible();
    await expect(page.getByText('Your library is empty').first()).toBeVisible();
    await expect(page.getByText('Memory-only session')).toHaveCount(0);
    await expectNoThrow('opening the library after the reload lost the project');

    // Nothing along the way threw: a refused write is a reported state, not a crash.
    expect(uncaught).toEqual([]);
  });
});
