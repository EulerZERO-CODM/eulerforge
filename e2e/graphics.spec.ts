import { expect, test } from '@playwright/test';

import { createProject, placeGraphic } from './fixtures';

/**
 * A placed graphic on the artboard.
 *
 * A graphic is decoded asynchronously, so the picture the artboard paints first cannot contain it:
 * the plan is built while the image is still on its way. The canvas has to be painted again when
 * the decode finishes. Without that, the graphic is in the document, in the layer list and in the
 * exported file — and nowhere on the screen, which is the only place the user is looking.
 *
 * This is a browser check on purpose: the artboard is a real `<canvas>`, and only a real browser
 * can say what was painted into it.
 */
test('a placed graphic appears on the artboard once it has decoded', async ({ page }) => {
  await createProject(page, { width: 400, height: 200 });
  await placeGraphic(page, 'Speed lines');

  await expect(page.getByTestId('artboard')).toBeVisible();
  // The graphic has finished decoding and nothing is complaining about it.
  await expect(
    page.getByText(/Graphics are still loading|A graphic could not be loaded/),
  ).toHaveCount(0, { timeout: 30_000 });

  const painted = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="document-canvas"]');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('the artboard canvas is missing');
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) {
      // The document background is #0f1115; anything else is the graphic.
      const red = data[index] ?? -1;
      const green = data[index + 1] ?? -1;
      const blue = data[index + 2] ?? -1;
      if (red !== 0x0f || green !== 0x11 || blue !== 0x15) ink += 1;
    }
    return { ink, width: canvas.width, height: canvas.height };
  });

  expect(painted.ink, 'the artboard should show the placed graphic').toBeGreaterThan(0);
});
