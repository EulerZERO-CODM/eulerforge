import { createCanvas, loadImage } from '@napi-rs/canvas';

import { expect, test, type Page } from '@playwright/test';

import { readZipEntry, readZipEntryNames } from '../src/core/svg/zip';
import { STORAGE_KEY } from './fixtures';

/**
 * Video Studio, in a real browser.
 *
 * Everything here needs a decoder: jsdom has no `<video>` pipeline and no `MediaRecorder`, so the
 * component suite mocks those and this suite is where the real thing is exercised. The fixture is
 * *recorded by the browser itself* — a MediaRecorder take of a canvas — which proves the import path
 * against a genuine WebM file rather than a committed binary, and proves the studio can re-import
 * its own output.
 *
 * The assertions that matter are on bytes and pixels: a downloaded zip is parsed, the manifest's own
 * times are read, and the frame at a timestamp is decoded and compared with the live preview at the
 * same timestamp. A capture is checked for the EBML magic number, not for a success message.
 */

type StoredVideoDocument = {
  readonly id: string;
  readonly title: string;
  readonly documentTypeId: string;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly studioPayload: {
    readonly kind: 'video';
    readonly duration: number;
    readonly fps: number;
    readonly media: readonly {
      readonly id: string;
      readonly name: string;
      readonly duration: number;
    }[];
    readonly tracks: readonly {
      readonly kind: string;
      readonly clips: readonly {
        readonly id: string;
        readonly kind: string;
        readonly start: number;
        readonly duration: number;
      }[];
    }[];
  } | null;
};

async function videoDocument(page: Page): Promise<StoredVideoDocument> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  if (raw === null) throw new Error('no document has been saved yet');
  const envelope = JSON.parse(raw) as { documents: StoredVideoDocument[] };
  const document = envelope.documents[0];
  if (!document) throw new Error('the saved envelope holds no document');
  return document;
}

/** Creates a video project through the studio page, the product's own entry point. */
async function createVideoDocument(page: Page, title = 'Browser timeline'): Promise<void> {
  await page.goto('/studios/video');
  await expect(page.getByRole('heading', { name: 'Video Studio', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Create a project' }).first().click();

  await expect(page).toHaveURL(/\/create\?studio=video$/);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Project name').fill(title);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.locator('dt', { hasText: 'Document type' }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('Video timeline');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.waitForURL(/\/workspace\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
}

/**
 * Records a one-second WebM with the browser's own MediaRecorder.
 *
 * The picture changes over time — a moving bar over a shifting hue — so a frame at 0.2 s and a frame
 * at 0.8 s are visibly different, which is what makes "the preview shows the right moment" testable.
 *
 * Frames are pushed explicitly through a manual capture stream rather than sampled on
 * `requestAnimationFrame`. An automated page may throttle animation frames, and a take that never
 * draws is a valid but frameless WebM: the studio then has nothing to decode and the failure looks
 * like a preview bug. A fixed loop with one `requestFrame()` per picture makes the fixture's content
 * independent of the runner's frame scheduling while still exercising a real MediaRecorder.
 */
async function recordFixtureWebm(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    // A frame rate of 0 means "only the frames requested explicitly are captured".
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (!track) throw new Error('the canvas did not expose a capture track');
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        resolve();
      };
    });
    recorder.start(100);
    const draw = (elapsed: number): void => {
      context.fillStyle = '#101820';
      context.fillRect(0, 0, 160, 90);
      context.fillStyle = `hsl(${String((elapsed * 320) % 360)} 85% 55%)`;
      context.fillRect(0, 0, 60, 90);
      context.fillStyle = '#ffffff';
      context.fillRect(8 + ((elapsed * 120) % 120), 30, 22, 22);
    };
    // 40 pictures at a nominal 30 fps: past the 1 s the title test seeks to, and well past the 0.8 s
    // the scrub test reads and the 0.6 s the export test renders, with wall-clock timestamps spaced
    // by the short wait below.
    for (let index = 0; index <= 39; index += 1) {
      draw(index / 30);
      track.requestFrame();
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 30);
      });
    }
    recorder.stop();
    await stopped;
    for (const streamTrack of stream.getTracks()) streamTrack.stop();
    const blob = new Blob(chunks, { type: 'video/webm' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length < 200) throw new Error('the recorded fixture is suspiciously small');
  return buffer;
}

async function importClip(page: Page, name = 'clip.webm'): Promise<Buffer> {
  const buffer = await recordFixtureWebm(page);
  await page.getByLabel('Import video or audio files').setInputFiles({
    name,
    mimeType: 'video/webm',
    buffer,
  });
  return buffer;
}

/** The preview's pixels at points given as fractions of its own size. */
async function samplePreview(
  page: Page,
  points: readonly (readonly [number, number])[],
): Promise<number[][]> {
  return page.evaluate((samplePoints) => {
    const canvas = document.querySelector('[data-testid="video-preview"]');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('the preview canvas is missing');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('the preview has no 2d context');
    return samplePoints.map(([x, y]) => {
      const data = context.getImageData(
        Math.min(canvas.width - 1, Math.round(x * canvas.width)),
        Math.min(canvas.height - 1, Math.round(y * canvas.height)),
        1,
        1,
      ).data;
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
    });
  }, points);
}

const SAMPLE_POINTS: readonly (readonly [number, number])[] = [
  [0.08, 0.5],
  [0.2, 0.5],
  [0.35, 0.5],
  [0.5, 0.25],
  [0.5, 0.6],
  [0.62, 0.5],
  [0.75, 0.7],
  [0.9, 0.2],
];

/** Seeks the transport with the ruler's keyboard controls, which are also the accessible path. */
async function seekTo(page: Page, seconds: number): Promise<void> {
  const ruler = page.getByRole('slider', { name: 'Playhead' });
  await ruler.focus();
  const fps = 30;
  const frames = Math.round(seconds * fps);
  await ruler.press('Home');
  for (let index = 0; index < frames; index += 1) await ruler.press('ArrowRight');
  await expect(page.getByTestId('video-time')).toHaveText(`${seconds.toFixed(2)}s`);
}

const TITLE_BAND = { x0: 0.2, y0: 0.7, x1: 0.8, y1: 0.94 } as const;

/**
 * Counts near-white pixels inside a band, as a fraction of the canvas.
 *
 * A title is a thin glyph, so sampling a fixed point would be a coin flip. Counting the band makes
 * "the title is really drawn here" and "the exported frame draws it in the same place" both
 * measurable, and it fails if the title is missing rather than merely different.
 */
async function countBrightPixels(
  page: Page,
  band: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
): Promise<number> {
  return page.evaluate((region) => {
    const canvas = document.querySelector('[data-testid="video-preview"]');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('the preview canvas is missing');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('the preview has no 2d context');
    const x = Math.floor(region.x0 * canvas.width);
    const y = Math.floor(region.y0 * canvas.height);
    const width = Math.floor((region.x1 - region.x0) * canvas.width);
    const height = Math.floor((region.y1 - region.y0) * canvas.height);
    const data = context.getImageData(x, y, width, height).data;
    let bright = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (
        (data[index] ?? 0) > 200 &&
        (data[index + 1] ?? 0) > 200 &&
        (data[index + 2] ?? 0) > 200
      ) {
        bright += 1;
      }
    }
    return bright;
  }, band);
}

async function waitForPicture(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const samples = await samplePreview(page, SAMPLE_POINTS);
        return new Set(samples.map((entry) => entry.slice(0, 3).join(','))).size;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(1);
}

/**
 * Waits for the preview to *settle* on a new frame after a seek.
 *
 * "More than one colour" only proves that some frame has been painted, and the stage paints
 * immediately with whatever is decoded and then repaints once the element holds the requested time.
 * Sampling a seeked preview therefore used to race the decoder, which produced a rare comparison
 * against the previous second. This waits for a picture that differs from the frame before the seek
 * and is unchanged across two consecutive samples, so the comparison below is against the frame at
 * the requested timestamp rather than an intermediate one.
 */
async function waitForSettledPicture(page: Page, before: readonly number[][]): Promise<void> {
  await expect
    .poll(
      async () => {
        const first = await samplePreview(page, SAMPLE_POINTS);
        await page.waitForTimeout(120);
        const second = await samplePreview(page, SAMPLE_POINTS);
        const changed = second.some(
          (pixel, index) => pixel.slice(0, 3).join(',') !== before[index]?.slice(0, 3).join(','),
        );
        const stable = second.every(
          (pixel, index) => pixel.slice(0, 3).join(',') === first[index]?.slice(0, 3).join(','),
        );
        return changed && stable;
      },
      { timeout: 20_000, intervals: [300] },
    )
    .toBe(true);
}

test.describe('Video Studio in a real browser', () => {
  test('imports a genuine WebM, places it, scrubs it and reopens it after a reload', async ({
    page,
  }) => {
    await createVideoDocument(page);
    const document = await videoDocument(page);
    await importClip(page);

    await expect(page.getByTestId('video-import-report')).toContainText('clip.webm');
    // The take is recorded in real time, so its exact length moves with the runner. What the report
    // must show is the length the browser decoded from the file — a plausible positive number for
    // the roughly one-second take, not a hard-coded caption.
    const report = await page.getByTestId('video-import-report').textContent();
    const reportedDuration = Number(/· ([\d.]+) s ·/.exec(report ?? '')?.[1]);
    expect(reportedDuration).toBeGreaterThan(1.05);
    expect(reportedDuration).toBeLessThan(1.4);
    const withMedia = await videoDocument(page);
    expect(withMedia.studioPayload?.media.map((media) => media.name)).toEqual(['clip.webm']);
    expect(withMedia.studioPayload?.media[0]?.duration).toBeGreaterThan(0.5);

    await page.getByRole('button', { name: 'Place clip.webm at the playhead' }).click();
    await expect(page.getByRole('button', { name: /^clip\.webm at 0\.00 seconds$/ })).toBeVisible();

    // The preview really decodes: a single flat colour would mean the video was never drawn.
    await waitForPicture(page);

    // Scrubbing changes the frame. At 0.1 s the moving white square is on the left; at 0.8 s it is
    // further right, so the sampled band around x = 0.45 differs between the two times.
    await seekTo(page, 0.1);
    const early = await samplePreview(page, SAMPLE_POINTS);
    await seekTo(page, 0.8);
    const late = await samplePreview(page, SAMPLE_POINTS);
    expect(JSON.stringify(early)).not.toBe(JSON.stringify(late));

    await seekTo(page, 0.4);
    const beforeReload = await samplePreview(page, SAMPLE_POINTS);
    await expect
      .poll(async () => (await samplePreview(page, SAMPLE_POINTS))[3])
      .toEqual(beforeReload[3]);

    // A reload reopens the saved document, and the media bytes come back from IndexedDB.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^clip\.webm at 0\.00 seconds$/ })).toBeVisible();
    await waitForPicture(page);

    const reopened = await videoDocument(page);
    expect(reopened.canvas.width).toBe(document.canvas.width);
    expect(reopened.studioPayload?.media).toHaveLength(1);
    expect(
      reopened.studioPayload?.tracks
        .flatMap((track) => track.clips)
        .filter((clip) => clip.kind === 'video'),
    ).toHaveLength(1);
  });

  test('exports a frame sequence whose frame matches the preview at the same timestamp', async ({
    page,
  }) => {
    await createVideoDocument(page, 'Frame parity');
    await importClip(page);
    await page.getByRole('button', { name: 'Place clip.webm at the playhead' }).click();
    await expect(page.getByRole('button', { name: /^clip\.webm at 0\.00 seconds$/ })).toBeVisible();
    await waitForPicture(page);

    await page.getByLabel('Export end').fill('0.6');
    await page.getByRole('button', { name: 'Check range' }).click();
    const planText = await page.getByTestId('video-export-plan').textContent();
    expect(planText).toMatch(/18 frames at \d+ × \d+, 30 fps/);
    const size = /at (\d+) × (\d+)/.exec(planText ?? '');
    const width = Number(size?.[1]);
    const height = Number(size?.[2]);
    expect(width).toBeGreaterThan(0);

    const beforeSeek = await samplePreview(page, SAMPLE_POINTS);
    await seekTo(page, 0.4);
    await waitForSettledPicture(page, beforeSeek);
    const previewSamples = await samplePreview(page, SAMPLE_POINTS);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export frames' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('frame-parity-video-frames.zip');
    const path = await file.path();
    if (!path) throw new Error('the download has no path');
    const bytes = new Uint8Array(await (await import('node:fs/promises')).readFile(path));

    // A real zip: local file header, central directory, and exactly the planned entries.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const names = readZipEntryNames(bytes);
    expect(names).toHaveLength(19);
    expect(names[0]).toBe('frames/frame-0001.png');
    expect(names.at(-2)).toBe('frames/frame-0018.png');
    expect(names.at(-1)).toBe('manifest.json');

    const manifestBytes = readZipEntry(bytes, 'manifest.json');
    if (!manifestBytes) throw new Error('the manifest is missing');
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      format: string;
      frameCount: number;
      times: number[];
      width: number;
      height: number;
      media: { name: string }[];
    };
    expect(manifest.format).toBe('eulerforge-video-frames/1');
    expect(manifest.frameCount).toBe(18);
    expect(manifest.width).toBe(width);
    expect(manifest.height).toBe(height);
    expect(manifest.media.map((media) => media.name)).toEqual(['clip.webm']);

    // The frame whose own recorded time is 0.4 s, decoded and compared with the live preview.
    const frameIndex = manifest.times.findIndex((time) => Math.abs(time - 0.4) < 1e-6);
    expect(frameIndex).toBeGreaterThanOrEqual(0);
    const frameName = `frames/frame-${String(frameIndex + 1).padStart(4, '0')}.png`;
    const frameBytes = readZipEntry(bytes, frameName);
    if (!frameBytes) throw new Error(`the frame ${frameName} is missing`);

    const frame = await loadImage(Buffer.from(frameBytes));
    expect(frame.width).toBe(width);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(frame, 0, 0);
    const deltas = SAMPLE_POINTS.map(([x, y], index) => {
      const data = context.getImageData(
        Math.min(width - 1, Math.round(x * width)),
        Math.min(height - 1, Math.round(y * height)),
        1,
        1,
      ).data;
      const preview = previewSamples[index] ?? [0, 0, 0, 0];
      return Math.max(
        Math.abs((data[0] ?? 0) - (preview[0] ?? 0)),
        Math.abs((data[1] ?? 0) - (preview[1] ?? 0)),
        Math.abs((data[2] ?? 0) - (preview[2] ?? 0)),
      );
    });
    expect(Math.max(...deltas), `channel deltas ${deltas.join(',')}`).toBeLessThanOrEqual(4);
    expect(deltas.filter((delta) => delta === 0).length).toBeGreaterThanOrEqual(
      SAMPLE_POINTS.length - 2,
    );

    await expect(page.getByTestId('video-export-report')).toContainText(
      `frame-parity-video-frames.zip · 18 frames at ${width} × ${height}`,
    );
  });

  test('draws a title over the video in the preview and in the exported frames', async ({
    page,
  }) => {
    await createVideoDocument(page, 'Title parity');
    await importClip(page);
    await page.getByRole('button', { name: 'Place clip.webm at the playhead' }).click();
    await waitForPicture(page);

    // The title is added at the playhead through the inspector, the same path a user takes.
    await page.getByLabel('Title text').fill('Launch day');
    await page.getByRole('button', { name: 'Add title' }).click();
    await expect(page.getByRole('button', { name: /^Launch day at 0\.00 seconds$/ })).toBeVisible();

    await seekTo(page, 1);
    await waitForPicture(page);
    const previewBright = await countBrightPixels(page, TITLE_BAND);
    expect(previewBright, 'the preview should actually draw the title').toBeGreaterThan(50);

    await page.getByLabel('Export start').fill('0.9');
    await page.getByLabel('Export end').fill('1.1');
    await page.getByRole('button', { name: 'Check range' }).click();
    await expect(page.getByTestId('video-export-plan')).toContainText(/6 frames at \d+ × \d+/);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export frames' }).click();
    const file = await download;
    const path = await file.path();
    if (!path) throw new Error('the download has no path');
    const bytes = new Uint8Array(await (await import('node:fs/promises')).readFile(path));

    const manifestBytes = readZipEntry(bytes, 'manifest.json');
    if (!manifestBytes) throw new Error('the manifest is missing');
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      times: number[];
      titles: { text: string; start: number; duration: number }[];
    };
    // The manifest records the title as part of the exported composition, not only as pixels.
    expect(manifest.titles.map((title) => title.text)).toEqual(['Launch day']);

    const frameIndex = manifest.times.findIndex((time) => Math.abs(time - 1) < 1e-6);
    expect(frameIndex, 'the range should include the 1.0 s frame').toBeGreaterThanOrEqual(0);
    const frameBytes = readZipEntry(
      bytes,
      `frames/frame-${String(frameIndex + 1).padStart(4, '0')}.png`,
    );
    if (!frameBytes) throw new Error('the frame at 1.0 s is missing');

    const frame = await loadImage(Buffer.from(frameBytes));
    const canvas = createCanvas(frame.width, frame.height);
    const context = canvas.getContext('2d');
    context.drawImage(frame, 0, 0);
    const x = Math.floor(TITLE_BAND.x0 * frame.width);
    const y = Math.floor(TITLE_BAND.y0 * frame.height);
    const width = Math.floor((TITLE_BAND.x1 - TITLE_BAND.x0) * frame.width);
    const height = Math.floor((TITLE_BAND.y1 - TITLE_BAND.y0) * frame.height);
    const data = context.getImageData(x, y, width, height).data;
    let exportedBright = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (
        (data[index] ?? 0) > 200 &&
        (data[index + 1] ?? 0) > 200 &&
        (data[index + 2] ?? 0) > 200
      ) {
        exportedBright += 1;
      }
    }

    expect(exportedBright, 'the exported frame should contain the title').toBeGreaterThan(50);
    // Same painter, same size, lossless PNG: the glyph coverage should agree closely. The band is
    // allowed a small difference for canvas-versus-PNG rounding, not for a missing title.
    expect(Math.abs(exportedBright - previewBright)).toBeLessThanOrEqual(
      Math.max(8, Math.round(previewBright * 0.02)),
    );
  });

  test('records a real-time WebM take and reports the container it got', async ({ page }) => {
    test.setTimeout(120_000);
    await createVideoDocument(page, 'Capture take');
    await importClip(page, 'take.webm');
    await page.getByRole('button', { name: 'Place take.webm at the playhead' }).click();
    await expect(page.getByRole('button', { name: /^take\.webm at 0\.00 seconds$/ })).toBeVisible();
    await waitForPicture(page);

    await page.getByLabel('Export start').fill('0');
    await page.getByLabel('Export end').fill('1');

    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Record WebM' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('capture-take-capture.webm');

    const path = await file.path();
    if (!path) throw new Error('the recording has no path');
    const bytes = new Uint8Array(await (await import('node:fs/promises')).readFile(path));
    // EBML magic: this is a real Matroska/WebM file, not a blob of text.
    expect([...bytes.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    await expect(page.getByTestId('video-capture-report')).toContainText(
      'capture-take-capture.webm',
    );
    await expect(page.getByTestId('video-capture-report')).toContainText('video/webm');
    await expect(page.getByTestId('video-capture-report')).toContainText('1.0 s');
  });

  test('refuses an empty range and a file that is not media, with sentences', async ({ page }) => {
    await createVideoDocument(page, 'Refusals');
    await importClip(page, 'refuse.webm');
    await page.getByRole('button', { name: 'Place refuse.webm at the playhead' }).click();
    await expect(
      page.getByRole('button', { name: /^refuse\.webm at 0\.00 seconds$/ }),
    ).toBeVisible();

    await page.getByLabel('Export start').fill('1');
    await page.getByLabel('Export end').fill('1');
    await page.getByRole('button', { name: 'Check range' }).click();
    await expect(page.getByText(/The export range is empty/)).toBeVisible();
    await expect(page.getByTestId('video-export-plan')).toHaveCount(0);

    await page.getByLabel('Import video or audio files').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is not a video'),
    });
    await expect(page.getByText(/is not a video or an audio file/)).toBeVisible();
    // The refused file did not enter the bin.
    expect((await videoDocument(page)).studioPayload?.media).toHaveLength(1);
  });

  test('removes a clip with Delete and restores it with undo', async ({ page }) => {
    await createVideoDocument(page, 'Undo take');
    await importClip(page, 'undo.webm');
    await page.getByRole('button', { name: 'Place undo.webm at the playhead' }).click();
    const clip = page.getByRole('button', { name: /^undo\.webm at 0\.00 seconds$/ });
    await expect(clip).toBeVisible();

    await clip.click();
    await page.keyboard.press('Delete');
    await expect(clip).toHaveCount(0);
    // The deletion is one labelled history entry, not an unlabelled mutation.
    await expect(page.getByText(/Remove “undo\.webm”/).first()).toBeVisible();
    expect(
      (await videoDocument(page)).studioPayload?.tracks.flatMap((track) => track.clips),
    ).toHaveLength(0);

    await page.keyboard.press('Control+z');
    await expect(clip).toBeVisible();
    expect(
      (await videoDocument(page)).studioPayload?.tracks.flatMap((track) => track.clips),
    ).toHaveLength(1);
  });
});
