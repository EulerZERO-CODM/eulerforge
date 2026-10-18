/**
 * Browser playback and export for Video Studio.
 *
 * **Decoding** is the browser's own: one `<video>`/`<audio>` element per media file, fed from a blob
 * URL. That is the only decoder a page is guaranteed to have, and it is the one that respects the
 * codecs the browser actually supports. WebCodecs would give frame-exact control, but it is not
 * available in every browser this project targets (and not in the CI browser), so it is not the
 * foundation here.
 *
 * **Caching** is deliberately small: the pool keeps one element per imported file and the browser
 * keeps a decode buffer around the playhead. There is no proxy generation and no frame cache of our
 * own; a very large file will seek more slowly than a small one, and the studio says so rather than
 * pretending an editor is a grading suite.
 *
 * **Export** has two honest shapes. A PNG sequence is rendered frame by frame by seeking each
 * element and painting the same picture the preview paints — deterministic, exact, and slow. A WebM
 * capture runs the composition in real time through `MediaRecorder`, which produces a real video
 * file but is a recording, not a render: dropped frames on a busy machine are possible, and the
 * result's duration is the wall-clock duration of the take.
 */

import type { ForgeDocument } from '../../core/documents/types';
import type { VideoMedia, VideoPayload } from '../../core/documents/payload';
import type { VideoCapturePlan, VideoExportPlan } from '../../core/video/export';
import {
  buildVideoManifest,
  videoArchiveName,
  videoCaptureFileName,
  videoFrameFileName,
} from '../../core/video/export';
import { evaluateVideoAt, type VideoFrameState } from '../../core/video/evaluate';
import { titleAnchorY } from '../../core/video/timeline';
import { createZip } from '../../core/svg/zip';
import { err, forgeError, ok, type ForgeError, type Result } from '../../core/result';

export type MediaElementLike = HTMLVideoElement | HTMLAudioElement;

export type MediaLoader = (mediaId: string) => Promise<Result<Blob | null>>;

const SEEK_TIMEOUT_MS = 8_000;
const METADATA_TIMEOUT_MS = 15_000;

function waitFor(
  target: EventTarget,
  events: readonly string[],
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      for (const event of events) target.removeEventListener(event, onEvent);
      resolve(value);
    };
    const onEvent = (): void => {
      finish(true);
    };
    const timer = window.setTimeout(() => {
      finish(false);
    }, timeoutMs);
    for (const event of events) target.addEventListener(event, onEvent);
  });
}

/**
 * One decoded element per media file, and the blob URLs that feed them.
 *
 * Elements are created lazily and kept for the life of the workspace: re-creating a video element per
 * frame would re-download (well, re-read) the whole file and make scrubbing unusable.
 */
export class VideoMediaPool {
  private readonly elements = new Map<string, MediaElementLike>();
  private readonly urls = new Map<string, string>();
  private readonly loading = new Map<string, Promise<Result<MediaElementLike>>>();

  constructor(private readonly load: MediaLoader) {}

  peek(mediaId: string): MediaElementLike | null {
    return this.elements.get(mediaId) ?? null;
  }

  /** Creates the element for a media file if it does not exist yet, and waits for metadata. */
  ensure(media: VideoMedia): Promise<Result<MediaElementLike>> {
    const existing = this.elements.get(media.id);
    if (existing) return Promise.resolve(ok(existing));
    const pending = this.loading.get(media.id);
    if (pending) return pending;

    const task = (async (): Promise<Result<MediaElementLike>> => {
      const blob = await this.load(media.id);
      if (!blob.ok) return blob;
      if (!blob.value) {
        return err(
          forgeError('not-found', `The file for “${media.name}” is not in this browser.`, {
            detail: 'Re-import the file to restore the clip.',
            retryable: false,
          }),
        );
      }
      const url = URL.createObjectURL(blob.value);
      const element: MediaElementLike =
        media.kind === 'video' ? document.createElement('video') : document.createElement('audio');
      element.preload = 'auto';
      element.muted = false;
      element.setAttribute('playsinline', '');
      element.src = url;
      const ready = await waitFor(element, ['loadedmetadata', 'canplay'], METADATA_TIMEOUT_MS);
      if (!ready) {
        URL.revokeObjectURL(url);
        return err(
          forgeError('unsupported', `“${media.name}” could not be decoded again.`, {
            detail: 'The browser refused this file on a second load. Re-import it.',
            retryable: false,
          }),
        );
      }
      this.urls.set(media.id, url);
      this.elements.set(media.id, element);
      return ok(element);
    })();

    this.loading.set(media.id, task);
    void task.finally(() => {
      this.loading.delete(media.id);
    });
    return task;
  }

  /** Seeks an element and resolves once the frame is available. */
  async seek(mediaId: string, time: number): Promise<boolean> {
    const element = this.elements.get(mediaId);
    if (!element) return false;
    const target = Math.max(0, time);
    if (Math.abs(element.currentTime - target) < 0.001 && element.readyState >= 2) return true;

    const seeked = waitFor(element, ['seeked'], SEEK_TIMEOUT_MS);
    try {
      element.currentTime = target;
    } catch {
      return false;
    }
    const reached = await seeked;
    return reached && element.readyState >= 2;
  }

  /** Seconds of the element that are buffered ahead of the playhead, for the resource readout. */
  bufferedAhead(mediaId: string): number {
    const element = this.elements.get(mediaId);
    if (!element) return 0;
    const { buffered, currentTime } = element;
    for (let index = 0; index < buffered.length; index += 1) {
      if (currentTime >= buffered.start(index) && currentTime <= buffered.end(index)) {
        return Math.max(0, buffered.end(index) - currentTime);
      }
    }
    return 0;
  }

  pauseAll(): void {
    for (const element of this.elements.values()) element.pause();
  }

  playAll(): void {
    for (const element of this.elements.values()) {
      void element.play().catch(() => undefined);
    }
  }

  dispose(): void {
    for (const element of this.elements.values()) {
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.elements.clear();
    this.urls.clear();
    this.loading.clear();
  }
}

const TITLE_FONT_STACK =
  '600 %px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function paintTitle(
  context: CanvasRenderingContext2D,
  title: VideoFrameState['titles'][number],
  size: { width: number; height: number },
): void {
  const { clip } = title;
  let fontSize = Math.max(8, Math.min(clip.fontSize, size.width / 2));
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  // Shrink until the line fits the frame, so a long title is smaller rather than cropped. The loop
  // is bounded and deterministic, which is what keeps a frame and the preview identical.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    context.font = TITLE_FONT_STACK.replace('%p', String(Math.round(fontSize)));
    if (context.measureText(clip.text).width <= size.width * 0.9) break;
    fontSize *= 0.94;
  }

  const y = size.height * titleAnchorY(clip.position);
  const metrics = context.measureText(clip.text);
  const padding = fontSize * 0.4;
  if (clip.background !== null) {
    const width = metrics.width + padding * 2;
    const height = fontSize * 1.5;
    context.fillStyle = clip.background;
    context.fillRect((size.width - width) / 2, y - height / 2, width, height);
  }

  // A shadow keeps a light title legible on a light shot without a plate. It is part of the frame,
  // so the export has it too.
  context.shadowColor = 'rgba(0, 0, 0, 0.55)';
  context.shadowBlur = Math.max(2, fontSize * 0.08);
  context.fillStyle = clip.color;
  context.fillText(clip.text, size.width / 2, y);
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
}

/**
 * Paints one evaluated frame.
 *
 * Pure with respect to the elements: it only reads what the browser has already decoded, so the same
 * function serves the live preview, the frame export and the capture loop.
 */
export function paintVideoFrame(
  context: CanvasRenderingContext2D,
  state: VideoFrameState,
  pool: VideoMediaPool,
): void {
  context.save();
  context.fillStyle = state.background;
  context.fillRect(0, 0, state.width, state.height);

  for (const video of state.videos) {
    if (video.media.kind !== 'video') continue;
    const element = pool.peek(video.media.id);
    if (!(element instanceof HTMLVideoElement)) continue;
    if (element.readyState < 2 || element.videoWidth === 0) continue;
    context.drawImage(element, video.box.x, video.box.y, video.box.width, video.box.height);
  }

  for (const title of state.titles) {
    paintTitle(context, title, { width: state.width, height: state.height });
  }
  context.restore();
}

export type FrameProgress = { readonly rendered: number; readonly total: number };

export type VideoFrameExportRequest = {
  readonly document: ForgeDocument;
  readonly payload: VideoPayload;
  readonly plan: VideoExportPlan;
  readonly loadMedia: MediaLoader;
  readonly createdAt?: string;
  readonly onProgress?: (progress: FrameProgress) => void;
  readonly signal?: AbortSignal;
};

export type VideoFrameExport =
  | {
      readonly status: 'exported';
      readonly zip: Uint8Array;
      readonly frames: number;
      readonly width: number;
      readonly height: number;
      readonly fileName: string;
      readonly skipped: readonly string[];
    }
  | { readonly status: 'cancelled'; readonly frames: number }
  | { readonly status: 'failed'; readonly error: ForgeError; readonly frames: number };

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, 'image/png');
  });
}

/**
 * Renders every planned frame, then zips the PNGs with a manifest.
 *
 * One canvas, reused: a 1080p frame is 8 MB of pixels and holding 1800 of them is not possible in a
 * tab. Cancellation between frames discards the partial archive rather than delivering half a film.
 */
export async function exportVideoFrames(
  request: VideoFrameExportRequest,
): Promise<VideoFrameExport> {
  const entries: { name: string; data: Uint8Array }[] = [];
  const skipped = new Set<string>();
  const pool = new VideoMediaPool(request.loadMedia);
  const canvas = document.createElement('canvas');
  canvas.width = request.plan.width;
  canvas.height = request.plan.height;
  const context = canvas.getContext('2d');
  if (!context) {
    pool.dispose();
    return {
      status: 'failed',
      error: forgeError('unsupported', 'This browser cannot compose video frames.', {
        detail: 'A 2D canvas context is required to render the timeline.',
        retryable: false,
      }),
      frames: 0,
    };
  }

  const total = request.plan.frameCount;
  try {
    for (let index = 0; index < total; index += 1) {
      if (request.signal?.aborted === true) return { status: 'cancelled', frames: entries.length };
      const time = request.plan.times[index] ?? 0;
      const evaluated = evaluateVideoAt(request.document, time);
      if (!evaluated.ok) {
        return { status: 'failed', error: evaluated.error, frames: entries.length };
      }

      for (const video of evaluated.value.videos) {
        const element = await pool.ensure(video.media);
        if (!element.ok) {
          return { status: 'failed', error: element.error, frames: entries.length };
        }
        const reached = await pool.seek(video.media.id, video.sourceTime);
        if (!reached) skipped.add(video.media.name);
      }

      // The preview canvas is the document size; the plan may be scaled, so the state is drawn at
      // the planned size. Text is measured in the target size, which is why the scale is applied to
      // the whole state rather than to the output afterwards.
      const frameState: VideoFrameState = {
        ...evaluated.value,
        width: request.plan.width,
        height: request.plan.height,
        videos: evaluated.value.videos.map((video) => ({
          ...video,
          box: {
            x: video.box.x * request.plan.scale,
            y: video.box.y * request.plan.scale,
            width: video.box.width * request.plan.scale,
            height: video.box.height * request.plan.scale,
          },
        })),
      };
      paintVideoFrame(context, frameState, pool);

      const blob = await canvasToPng(canvas);
      if (!blob) {
        return {
          status: 'failed',
          error: forgeError('unknown', 'A frame could not be encoded as PNG.', { retryable: true }),
          frames: entries.length,
        };
      }
      entries.push({
        name: videoFrameFileName(index, total),
        data: new Uint8Array(await blob.arrayBuffer()),
      });
      request.onProgress?.({ rendered: entries.length, total });
    }

    const manifest = buildVideoManifest({
      document: request.document,
      payload: request.payload,
      plan: request.plan,
      createdAt: request.createdAt ?? new Date().toISOString(),
    });
    entries.push({ name: 'manifest.json', data: new TextEncoder().encode(manifest) });

    const zip = createZip(entries);
    if (zip.length === 0) {
      return {
        status: 'failed',
        error: forgeError('unknown', 'The frame archive could not be assembled.', {
          retryable: true,
        }),
        frames: entries.length,
      };
    }

    return {
      status: 'exported',
      zip,
      frames: total,
      width: request.plan.width,
      height: request.plan.height,
      fileName: videoArchiveName(request.document.title),
      skipped: [...skipped],
    };
  } finally {
    pool.dispose();
  }
}

export type VideoCaptureRequest = {
  readonly document: ForgeDocument;
  readonly payload: VideoPayload;
  readonly plan: VideoCapturePlan;
  readonly loadMedia: MediaLoader;
  readonly onProgress?: (progress: { readonly elapsed: number; readonly total: number }) => void;
  readonly signal?: AbortSignal;
};

export type VideoCaptureOutcome =
  | {
      readonly status: 'captured';
      readonly blob: Blob;
      readonly mimeType: string;
      readonly extension: string;
      readonly bytes: number;
      readonly durationSeconds: number;
      readonly audioIncluded: boolean;
      readonly fileName: string;
    }
  | { readonly status: 'unsupported'; readonly error: ForgeError }
  | { readonly status: 'failed'; readonly error: ForgeError }
  | { readonly status: 'cancelled' };

/** The codecs this build will actually ask `MediaRecorder` for, in order of preference. */
export const CAPTURE_MIME_CANDIDATES: readonly string[] = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickCaptureMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const candidate of CAPTURE_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webm')) return 'webm';
  return 'bin';
}

/**
 * Records the composition in real time.
 *
 * The canvas is captured with `captureStream`, every media element is routed through one
 * `AudioContext` so the mix is real (not a silent video), and the recorder writes whatever container
 * the browser negotiated. The function reports that container instead of asserting one.
 */
export async function captureTimeline(request: VideoCaptureRequest): Promise<VideoCaptureOutcome> {
  if (typeof MediaRecorder === 'undefined') {
    return {
      status: 'unsupported',
      error: forgeError('unsupported', 'This browser cannot record video.', {
        detail: 'MediaRecorder is not available here, so a real-time capture cannot be made.',
        retryable: false,
      }),
    };
  }
  const mimeType = pickCaptureMimeType();
  if (!mimeType) {
    return {
      status: 'unsupported',
      error: forgeError('unsupported', 'This browser cannot record WebM video.', {
        detail: `None of these types are supported: ${CAPTURE_MIME_CANDIDATES.join(', ')}.`,
        retryable: false,
      }),
    };
  }
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return {
      status: 'unsupported',
      error: forgeError('unsupported', 'This browser cannot capture a canvas.', {
        detail: 'HTMLCanvasElement.captureStream is required for a real-time recording.',
        retryable: false,
      }),
    };
  }

  const pool = new VideoMediaPool(request.loadMedia);
  const canvas = document.createElement('canvas');
  canvas.width = request.plan.width;
  canvas.height = request.plan.height;
  const context = canvas.getContext('2d');
  if (!context) {
    pool.dispose();
    return {
      status: 'failed',
      error: forgeError('unsupported', 'This browser cannot compose video frames.', {
        detail: 'A 2D canvas context is required to render the timeline.',
        retryable: false,
      }),
    };
  }

  const startState = evaluateVideoAt(request.document, request.plan.from);
  if (!startState.ok) {
    pool.dispose();
    return { status: 'failed', error: startState.error };
  }

  try {
    // Decode everything the range needs before the take starts: a clip that loads halfway through
    // would appear late in the recording and there is no way to insert it afterwards.
    for (const mediaId of startState.value.mediaIds) {
      const media = request.payload.media.find((entry) => entry.id === mediaId);
      if (!media) continue;
      const element = await pool.ensure(media);
      if (!element.ok) return { status: 'failed', error: element.error };
    }
    for (const video of startState.value.videos) {
      await pool.seek(video.media.id, video.sourceTime);
    }

    paintVideoFrame(context, startState.value, pool);
    const canvasStream = canvas.captureStream(request.plan.fps);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    const hasAudibleMedia = request.payload.tracks.some((track) =>
      track.clips.some((clip) => clip.kind === 'audio' || (clip.kind === 'video' && !clip.muted)),
    );
    let audioContext: AudioContext | null = null;
    let audioIncluded = false;
    try {
      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      for (const media of request.payload.media) {
        const element = pool.peek(media.id);
        if (!element) continue;
        const source = audioContext.createMediaElementSource(element);
        source.connect(destination);
        source.connect(audioContext.destination);
      }
      const audioTracks = destination.stream.getAudioTracks();
      if (hasAudibleMedia && audioTracks.length > 0) {
        tracks.push(...audioTracks);
        audioIncluded = true;
      }
    } catch {
      // A browser that refuses Web Audio still gets a silent video; the outcome says so.
      audioIncluded = false;
    }

    const stream = new MediaStream(tracks);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        resolve();
      };
    });

    recorder.start(250);
    pool.playAll();
    void audioContext?.resume().catch(() => undefined);

    const total = request.plan.duration;
    const startedAt = performance.now();
    // A holder rather than a `let`: the value is written inside the animation callback, and the
    // compiler would otherwise narrow it to always-false at the read below.
    const capture = { cancelled: false };
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const elapsed = (performance.now() - startedAt) / 1000;
        if (request.signal?.aborted === true) {
          capture.cancelled = true;
          resolve();
          return;
        }
        if (elapsed >= request.plan.duration) {
          resolve();
          return;
        }
        const time = request.plan.from + elapsed;
        const evaluated = evaluateVideoAt(request.document, time);
        if (evaluated.ok) {
          // Keep the elements close to the timeline clock; a real-time capture cannot wait for a
          // seek, so the correction is only applied when the drift is visible.
          for (const video of evaluated.value.videos) {
            const element = pool.peek(video.media.id);
            if (!element) continue;
            if (Math.abs(element.currentTime - video.sourceTime) > 0.3) {
              element.currentTime = video.sourceTime;
            }
          }
          paintVideoFrame(context, evaluated.value, pool);
        }
        request.onProgress?.({ elapsed, total });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    pool.pauseAll();
    recorder.stop();
    await stopped;
    for (const track of stream.getTracks()) track.stop();
    void audioContext?.close().catch(() => undefined);

    if (capture.cancelled) return { status: 'cancelled' };

    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
    if (blob.size === 0) {
      return {
        status: 'failed',
        error: forgeError('unknown', 'The recording produced no data.', {
          detail: 'The browser stopped the recorder before it wrote anything; try a shorter range.',
          retryable: true,
        }),
      };
    }
    return {
      status: 'captured',
      blob,
      mimeType: recorder.mimeType || mimeType,
      extension: extensionFor(recorder.mimeType || mimeType),
      bytes: blob.size,
      durationSeconds: total,
      audioIncluded,
      fileName: videoCaptureFileName(
        request.document.title,
        extensionFor(recorder.mimeType || mimeType),
      ),
    };
  } finally {
    pool.dispose();
  }
}
