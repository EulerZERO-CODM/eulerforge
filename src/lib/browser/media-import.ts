/**
 * Reading a real media file.
 *
 * The metadata a timeline needs — duration and picture size — is not in the file name and not in the
 * `File` object; it comes from asking the browser's own decoder. That is also the only honest way to
 * know whether this browser can play the file at all: a `.mp4` that Chromium cannot decode must be
 * refused at import with the reason, not placed on a track as a black rectangle.
 *
 * MediaRecorder output (which this studio itself produces) is written without a duration in its
 * header, so `duration` reads as `Infinity` until the file is sampled. The documented workaround is
 * to seek past the end and let the browser compute the real duration; it is implemented here because
 * otherwise a user could not re-import a clip this studio exported.
 */

import type { VideoMedia } from '../../core/documents/payload';
import { createPayloadItemId } from '../../core/documents/payload';
import { err, forgeError, ok, type Result } from '../../core/result';

export type ProbedMedia = {
  readonly kind: 'video' | 'audio';
  readonly name: string;
  readonly mimeType: string;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly size: number;
};

const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|mov|ogv|ogg|mkv)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/i;

function mediaKind(file: File): 'video' | 'audio' | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (VIDEO_EXTENSIONS.test(file.name)) return 'video';
  if (AUDIO_EXTENSIONS.test(file.name)) return 'audio';
  return null;
}

function waitForEvent(
  target: HTMLMediaElement,
  event: 'loadedmetadata' | 'durationchange',
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (): void => {
      window.clearTimeout(timer);
      target.removeEventListener(event, done);
      target.removeEventListener('error', done);
      resolve(true);
    };
    const failed = (): void => {
      window.clearTimeout(timer);
      target.removeEventListener(event, done);
      target.removeEventListener('error', failed);
      resolve(false);
    };
    const timer = window.setTimeout(() => {
      target.removeEventListener(event, done);
      target.removeEventListener('error', failed);
      resolve(false);
    }, timeoutMs);
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', failed, { once: true });
  });
}

/**
 * Asks the browser to decode the file and report its metadata.
 *
 * The element is never added to the document and its object URL is revoked on every path, so a
 * refused import does not leave a decoder or a blob alive.
 */
export async function probeMediaFile(file: File): Promise<Result<ProbedMedia>> {
  const kind = mediaKind(file);
  if (!kind) {
    return err(
      forgeError('unsupported', 'That file is not a video or an audio file.', {
        detail: `“${file.name}” has type “${file.type || 'unknown'}”. Import an MP4, WebM, MOV, MP3, WAV, M4A or Ogg file.`,
        retryable: false,
      }),
    );
  }
  if (file.size === 0) {
    return err(
      forgeError('validation-failed', 'That file is empty.', {
        detail: `“${file.name}” has no bytes, so there is nothing to decode.`,
        retryable: false,
      }),
    );
  }

  const url = URL.createObjectURL(file);
  const element =
    kind === 'video' ? document.createElement('video') : document.createElement('audio');
  element.preload = 'metadata';
  element.muted = true;
  if (kind === 'video') {
    element.setAttribute('playsinline', '');
  }

  try {
    element.src = url;
    const loaded = await waitForEvent(element, 'loadedmetadata', 15_000);
    if (!loaded) {
      return err(
        forgeError('unsupported', 'This browser could not read that file.', {
          detail: `“${file.name}” (${file.type || 'unknown type'}) did not decode. It may use a codec this browser does not support.`,
          retryable: false,
        }),
      );
    }

    let duration = element.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      // MediaRecorder output has no duration until the file is sampled; seeking past the end makes
      // the browser compute it, and the element then reports the real value.
      element.currentTime = 1e101;
      await waitForEvent(element, 'durationchange', 4_000);
      duration = element.duration;
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      return err(
        forgeError('unsupported', 'That file does not say how long it is.', {
          detail: `“${file.name}” has no usable duration metadata, so it cannot be placed on a timeline. Re-encode it as MP4 or WebM.`,
          retryable: false,
        }),
      );
    }

    return ok({
      kind,
      name: file.name,
      mimeType: file.type || (kind === 'video' ? 'video/*' : 'audio/*'),
      duration: Math.round(duration * 1000) / 1000,
      width: element instanceof HTMLVideoElement ? element.videoWidth : 0,
      height: element instanceof HTMLVideoElement ? element.videoHeight : 0,
      size: file.size,
    });
  } finally {
    element.removeAttribute('src');
    element.load();
    URL.revokeObjectURL(url);
  }
}

/** The record a probed file becomes in the document and in the media store. */
export function mediaRecordFor(probed: ProbedMedia, id = createPayloadItemId('media')): VideoMedia {
  return {
    id,
    name: probed.name,
    kind: probed.kind,
    mimeType: probed.mimeType,
    duration: probed.duration,
    width: probed.width,
    height: probed.height,
    size: probed.size,
  };
}

/** A human-readable size, for the media bin. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
