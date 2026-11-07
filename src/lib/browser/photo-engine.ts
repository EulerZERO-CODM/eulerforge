/**
 * The browser raster engine for Photo Studio.
 *
 * Two renderers behind one API:
 *
 * - **WebGL2** runs one full-screen pass per adjustment, in stack order, on the GPU. Clarity is two
 *   passes (a 3×3 box blur, then the unsharp mix) so it sees exactly what the CPU reference sees at
 *   that point in the stack. The mask is applied in a final mix pass, so a local adjustment is the
 *   same edit on both paths.
 * - **Canvas2D** decodes the image to pixels, runs the pure pipeline in `src/core/photo`, and puts
 *   the result back. This is the reference implementation and the tested fallback: it works with no
 *   GPU, no extensions and no shader compilation, and the shader is checked against it.
 *
 * The module owns every DOM call (canvas, image decoding, shader compilation); the maths and the
 * document model stay in `src/core/**`.
 */

import type {
  PhotoAdjustment,
  PhotoMask,
  PhotoPayload,
  PhotoRetouchStroke,
  PhotoSource,
} from '../../core/documents/payload';
import {
  MAX_PHOTO_HREF_LENGTH,
  MAX_PHOTO_WORKING_EDGE,
  maskHasCoverage,
} from '../../core/documents/payload';
import { applyRangeSelections } from '../../core/photo/range';
import type { PhotoExportMimeType } from '../../core/photo/export';
import { applyPhotoPipeline } from '../../core/photo/pipeline';
import { err, forgeError, ok, type Result } from '../../core/result';

export type PhotoEngineId = 'webgl2' | 'canvas2d';

/** The drawable types this module accepts: both 2D drawing and WebGL uploads understand them. */
export type PhotoImageSource = HTMLImageElement | ImageBitmap | HTMLCanvasElement;

export type PhotoRenderRequest = {
  readonly image: PhotoImageSource;
  readonly payload: PhotoPayload;
  readonly width: number;
  readonly height: number;
};

export type PhotoRenderResult = {
  readonly canvas: HTMLCanvasElement;
  readonly engine: PhotoEngineId;
  /** Set when the requested engine could not be used and the fallback ran instead. */
  readonly fallbackReason: string | null;
  readonly durationMs: number;
};

/** Capability check that does not throw and does not keep a context alive. */
export function detectWebgl2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------------------------------- */
/* Mask and retouch rasterisation                                                                */
/* --------------------------------------------------------------------------------------------- */

const FULL = 255;

/** Paints the stroke outline (or filled lasso) onto a context already scaled to the canvas. */
function paintStrokeShape(
  context: CanvasRenderingContext2D,
  points: readonly { readonly x: number; readonly y: number }[],
  radius: number,
  width: number,
  height: number,
  fill: boolean,
): void {
  context.beginPath();
  if (fill) {
    for (const [index, point] of points.entries()) {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
    return;
  }
  const shortest = Math.min(width, height);
  context.lineWidth = Math.max(1, radius * 2 * shortest);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (points.length === 1) {
    const point = points[0];
    if (!point) return;
    context.arc(
      point.x * width,
      point.y * height,
      Math.max(0.5, radius * shortest),
      0,
      Math.PI * 2,
    );
    context.fill();
    return;
  }
  for (const [index, point] of points.entries()) {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

/**
 * Draws one stroke into a fresh canvas with the requested softness.
 *
 * Softness is a blur of the hard shape rather than a linear gradient, so a stroke that doubles back
 * on itself blends with itself instead of showing seams.
 */
function strokeCanvas(
  points: readonly { readonly x: number; readonly y: number }[],
  radius: number,
  hardness: number,
  fill: boolean,
  width: number,
  height: number,
): HTMLCanvasElement {
  const hard = document.createElement('canvas');
  hard.width = width;
  hard.height = height;
  const hardContext = hard.getContext('2d');
  if (!hardContext) return hard;
  hardContext.fillStyle = '#ffffff';
  hardContext.strokeStyle = '#ffffff';
  paintStrokeShape(hardContext, points, radius, width, height, fill);

  const blurPx = (1 - hardness) * Math.max(1, radius * Math.min(width, height) * 1.5);
  if (blurPx < 0.75) return hard;

  const soft = document.createElement('canvas');
  soft.width = width;
  soft.height = height;
  const softContext = soft.getContext('2d');
  if (!softContext) return hard;
  softContext.filter = `blur(${blurPx.toFixed(2)}px)`;
  softContext.drawImage(hard, 0, 0);
  softContext.filter = 'none';
  return soft;
}

/**
 * RGBA bytes of the source photograph at the requested mask size.
 *
 * Range selections are measured from the photograph, not from the adjusted preview, so this draws
 * the decoded image into an offscreen canvas once per render size. Returns `null` when the browser
 * refuses a 2D context, which the caller reports rather than silently dropping the selection.
 */
export function sourcePixelsOf(
  image: PhotoImageSource,
  width: number,
  height: number,
): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  } catch {
    // A canvas that cannot draw this image is reported as "no source" rather than thrown: the
    // caller decides whether the selection is essential (it is, in the renderer) or decoration
    // (it is not, in the overlay).
    return null;
  }
}

/**
 * Rasterises the mask to one strength byte per pixel.
 *
 * Painting adds, erasing subtracts, and the order is the stored order — exactly what the mask
 * panel shows. Source-pixel ranges are then unioned into the painted coverage, and `inverted` is
 * applied once to that union: the order in which two ways of selecting overlap cannot change what
 * "the selected area" means. A range needs `source`; omitting it is a programming error and throws
 * rather than quietly returning an unselected mask.
 */
export function rasteriseMask(
  mask: PhotoMask,
  width: number,
  height: number,
  source?: Uint8ClampedArray | null,
): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const painted = new Uint8ClampedArray(width * height);
  if (!context) return painted;

  for (const stroke of mask.strokes) {
    const layer = strokeCanvas(
      stroke.points,
      stroke.radius,
      stroke.hardness,
      stroke.fill,
      width,
      height,
    );
    context.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    context.drawImage(layer, 0, 0);
  }
  context.globalCompositeOperation = 'source-over';

  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 0; index < painted.length; index += 1) {
    painted[index] = pixels[index * 4 + 3] ?? 0;
  }

  const ranges = mask.ranges ?? [];
  let strength: Uint8ClampedArray = painted;
  if (ranges.length > 0) {
    if (!source) {
      throw new Error(
        'A range selection needs the source pixels; pass the photograph’s RGBA data to rasteriseMask.',
      );
    }
    strength = applyRangeSelections(painted, ranges, source, width, height);
  }

  if (!mask.inverted) return strength;
  for (let index = 0; index < strength.length; index += 1) {
    strength[index] = FULL - (strength[index] ?? 0);
  }
  return strength;
}

/**
 * Applies retouch strokes to a rendered canvas.
 *
 * Clone copies a shifted region; heal blends towards a blurred copy. Both are composited through a
 * soft stroke mask, so they edit the pixels rather than drawing a mark on top.
 */
export function applyRetouch(
  canvas: HTMLCanvasElement,
  strokes: readonly PhotoRetouchStroke[],
): void {
  const context = canvas.getContext('2d');
  if (!context || strokes.length === 0) return;
  const { width, height } = canvas;

  for (const stroke of strokes) {
    const buffer = document.createElement('canvas');
    buffer.width = width;
    buffer.height = height;
    const bufferContext = buffer.getContext('2d');
    if (!bufferContext) continue;

    if (stroke.mode === 'clone') {
      bufferContext.drawImage(
        canvas,
        stroke.offsetX * width,
        stroke.offsetY * height,
        width,
        height,
        0,
        0,
        width,
        height,
      );
    } else {
      const blur = Math.max(2, stroke.radius * Math.min(width, height) * 0.35);
      bufferContext.filter = `blur(${blur.toFixed(2)}px)`;
      bufferContext.drawImage(canvas, 0, 0);
      bufferContext.filter = 'none';
    }

    const mask = strokeCanvas(stroke.points, stroke.radius, stroke.hardness, false, width, height);
    bufferContext.globalCompositeOperation = 'destination-in';
    bufferContext.drawImage(mask, 0, 0);
    bufferContext.globalCompositeOperation = 'source-over';

    context.drawImage(buffer, 0, 0);
  }
}

/* --------------------------------------------------------------------------------------------- */
/* Canvas2D renderer                                                                             */
/* --------------------------------------------------------------------------------------------- */

function renderWithCanvas2d(request: PhotoRenderRequest): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = request.width;
  canvas.height = request.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser did not provide a 2D canvas context.');

  context.drawImage(request.image, 0, 0, request.width, request.height);
  const pixels = context.getImageData(0, 0, request.width, request.height);
  const adjustments = request.payload.adjustments;
  const mask = maskHasCoverage(request.payload.mask)
    ? rasteriseMask(request.payload.mask as PhotoMask, request.width, request.height, pixels.data)
    : null;

  const output = applyPhotoPipeline(
    { data: pixels.data, width: request.width, height: request.height },
    { adjustments, mask },
  );
  const rendered = context.createImageData(request.width, request.height);
  rendered.data.set(output);
  context.putImageData(rendered, 0, 0);
  applyRetouch(canvas, request.payload.retouch);
  return canvas;
}

/* --------------------------------------------------------------------------------------------- */
/* WebGL2 renderer                                                                               */
/* --------------------------------------------------------------------------------------------- */

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

/**
 * One adjustment per pass.
 *
 * The kind is an integer uniform, and the maths mirrors `applyAdjustmentPixel` line for line. A
 * shader per adjustment would compile faster at run time but make the two implementations drift.
 */
const ADJUST_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform sampler2D uBlur;
uniform int uKind;
uniform float uValue;
uniform vec2 uSize;

const float VIGNETTE_START = 0.55;
const float VIGNETTE_END = 1.15;

float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float smoothstep01(float edge0, float edge1, float value) {
  float t = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  vec3 color = texture(uSource, vUv).rgb * 255.0;
  float v = uValue;

  if (uKind == 0) {
    color *= pow(2.0, v / 50.0);
  } else if (uKind == 1) {
    color = (color - 127.5) * (1.0 + v / 100.0) + 127.5;
  } else if (uKind == 2) {
    float l = luminance(color);
    color = vec3(l) + (color - vec3(l)) * (1.0 + v / 100.0);
  } else if (uKind == 3) {
    float warm = v * 0.0025;
    color.r *= 1.0 + warm;
    color.b *= 1.0 - warm;
  } else if (uKind == 4) {
    float magenta = v * 0.0025;
    color.g *= 1.0 - magenta * 0.6;
    color.r *= 1.0 + magenta * 0.25;
    color.b *= 1.0 + magenta * 0.25;
  } else if (uKind == 5 || uKind == 6) {
    float l = luminance(color) / 255.0;
    float weight = uKind == 5
      ? smoothstep01(0.45, 1.0, l)
      : 1.0 - smoothstep01(0.0, 0.55, l);
    float amount = (v / 100.0) * weight * 0.75;
    color += amount * (v >= 0.0 ? vec3(255.0) - color : color);
  } else if (uKind == 7) {
    float mx = max(max(color.r, color.g), color.b);
    float mn = min(min(color.r, color.g), color.b);
    float current = (mx - mn) / 255.0;
    float l = luminance(color);
    float factor = 1.0 + (v / 100.0) * (1.0 - current) * 0.9;
    color = vec3(l) + (color - vec3(l)) * factor;
  } else if (uKind == 8) {
    vec3 soft = texture(uBlur, vUv).rgb * 255.0;
    color += (color - soft) * (v / 100.0) * 1.2;
  } else if (uKind == 9) {
    float l = luminance(color);
    color += (vec3(l) - color) * (v / 100.0);
  } else if (uKind == 10) {
    float amount = v / 100.0;
    vec3 sepia = vec3(
      0.393 * color.r + 0.769 * color.g + 0.189 * color.b,
      0.349 * color.r + 0.686 * color.g + 0.168 * color.b,
      0.272 * color.r + 0.534 * color.g + 0.131 * color.b
    );
    color += (sepia - color) * amount;
  } else if (uKind == 11) {
    vec2 centred = (gl_FragCoord.xy / uSize) - 0.5;
    float distance = length(centred) / 0.70710678;
    float factor = 1.0 - (v / 100.0) * smoothstep01(VIGNETTE_START, VIGNETTE_END, distance) * 0.85;
    color *= factor;
  }

  outColor = vec4(clamp(color, 0.0, 255.0) / 255.0, 1.0);
}`;

const BLUR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform vec2 uTexel;

void main() {
  vec3 total = vec3(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      total += texture(uSource, vUv + vec2(float(dx), float(dy)) * uTexel).rgb;
    }
  }
  outColor = vec4(total / 9.0, 1.0);
}`;

const MASK_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uOriginal;
uniform sampler2D uAdjusted;
uniform sampler2D uMask;

void main() {
  vec3 before = texture(uOriginal, vUv).rgb;
  vec3 after = texture(uAdjusted, vUv).rgb;
  float strength = texture(uMask, vUv).r;
  outColor = vec4(mix(before, after, strength), 1.0);
}`;

type Program = {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
};

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | string {
  const shader = gl.createShader(type);
  if (!shader) return 'the browser refused to create a shader';
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    gl.deleteShader(shader);
    return log;
  }
  return shader;
}

/**
 * Turns a failed WebGL `create*` call into a readable reason.
 *
 * lib.dom declares these methods as non-nullable, but the specification lets them return null when
 * the context is lost or the driver refuses a resource. Returning a string keeps the failure on the
 * existing `Result` path instead of crashing on a null object.
 */
function present<T>(value: T | null | undefined, message: string): T | string {
  if (value === null || value === undefined) return message;
  return value;
}

function buildProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  uniformNames: readonly string[],
): Program | string {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  if (typeof vertex === 'string') return `vertex shader: ${vertex}`;
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (typeof fragment === 'string') {
    gl.deleteShader(vertex);
    return `fragment shader: ${fragment}`;
  }
  const program = present(gl.createProgram(), 'the browser refused to create a program');
  if (typeof program === 'string') return program;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    return `program link: ${log}`;
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms };
}

const ADJUSTMENT_KIND_TO_CODE: Readonly<Record<PhotoAdjustment['kind'], number>> = {
  exposure: 0,
  contrast: 1,
  saturation: 2,
  temperature: 3,
  tint: 4,
  highlights: 5,
  shadows: 6,
  vibrance: 7,
  clarity: 8,
  grayscale: 9,
  sepia: 10,
  vignette: 11,
};

type Framebuffer = {
  readonly framebuffer: WebGLFramebuffer;
  readonly texture: WebGLTexture;
};

function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): Framebuffer | string {
  const texture = present(gl.createTexture(), 'the browser refused a render target');
  if (typeof texture === 'string') return texture;
  const framebuffer = present(gl.createFramebuffer(), 'the browser refused a render target');
  if (typeof framebuffer === 'string') return framebuffer;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE)
    return `render target incomplete (0x${status.toString(16)})`;
  return { framebuffer, texture };
}

function uploadTexture(
  gl: WebGL2RenderingContext,
  source: TexImageSource,
  flipY: boolean,
): WebGLTexture | string {
  const texture = present(gl.createTexture(), 'the browser refused a texture');
  if (typeof texture === 'string') return texture;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY ? 1 : 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function renderWithWebgl2(
  request: PhotoRenderRequest,
): { canvas: HTMLCanvasElement } | { error: string } {
  const glCanvas = document.createElement('canvas');
  glCanvas.width = request.width;
  glCanvas.height = request.height;
  const gl = glCanvas.getContext('webgl2', {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
  });
  if (!gl) return { error: 'This browser does not expose WebGL2.' };

  const adjust = buildProgram(gl, VERTEX_SHADER, ADJUST_FRAGMENT, [
    'uSource',
    'uBlur',
    'uKind',
    'uValue',
    'uSize',
  ]);
  if (typeof adjust === 'string') return { error: adjust };
  const blur = buildProgram(gl, VERTEX_SHADER, BLUR_FRAGMENT, ['uSource', 'uTexel']);
  if (typeof blur === 'string') return { error: blur };
  const maskProgram = buildProgram(gl, VERTEX_SHADER, MASK_FRAGMENT, [
    'uOriginal',
    'uAdjusted',
    'uMask',
  ]);
  if (typeof maskProgram === 'string') return { error: maskProgram };

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  // Every program declares `layout(location = 0)`, so one attribute binding covers all of them.
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const source = uploadTexture(gl, request.image, false);
  if (typeof source === 'string') return { error: source };

  let read = source;
  const first = createTarget(gl, request.width, request.height);
  if (typeof first === 'string') return { error: first };
  const second = createTarget(gl, request.width, request.height);
  if (typeof second === 'string') return { error: second };
  const third = createTarget(gl, request.width, request.height);
  if (typeof third === 'string') return { error: third };
  let writeTarget: Framebuffer = first;
  let spareTarget: Framebuffer = second;
  const blurTarget: Framebuffer = third;

  const drawTo = (target: Framebuffer): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, request.width, request.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const active = request.payload.adjustments.filter(
    (adjustment) => adjustment.enabled && adjustment.value !== 0,
  );

  for (const adjustment of active) {
    if (adjustment.kind === 'clarity') {
      // Pass 1: 3×3 box blur of the *current* state into a target that is neither the source nor
      // the destination, because sampling the attachment being written is a feedback loop.
      gl.useProgram(blur.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read);
      gl.uniform1i(blur.uniforms.uSource ?? null, 0);
      gl.uniform2f(blur.uniforms.uTexel ?? null, 1 / request.width, 1 / request.height);
      drawTo(blurTarget);
      const blurred = blurTarget.texture;

      // Pass 2: unsharp mix with the blurred copy.
      gl.useProgram(adjust.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read);
      gl.uniform1i(adjust.uniforms.uSource ?? null, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurred);
      gl.uniform1i(adjust.uniforms.uBlur ?? null, 1);
      gl.uniform1i(adjust.uniforms.uKind ?? null, ADJUSTMENT_KIND_TO_CODE.clarity);
      gl.uniform1f(adjust.uniforms.uValue ?? null, adjustment.value);
      gl.uniform2f(adjust.uniforms.uSize ?? null, request.width, request.height);
      drawTo(writeTarget);
    } else {
      gl.useProgram(adjust.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read);
      gl.uniform1i(adjust.uniforms.uSource ?? null, 0);
      gl.uniform1i(adjust.uniforms.uKind ?? null, ADJUSTMENT_KIND_TO_CODE[adjustment.kind]);
      gl.uniform1f(adjust.uniforms.uValue ?? null, adjustment.value);
      gl.uniform2f(adjust.uniforms.uSize ?? null, request.width, request.height);
      drawTo(writeTarget);
    }
    read = writeTarget.texture;
    const swap = writeTarget;
    writeTarget = spareTarget;
    spareTarget = swap;
  }

  const mask = request.payload.mask;
  if (mask && maskHasCoverage(mask)) {
    // Range selections are measured from the photograph, which the GPU has already uploaded; the
    // pixels are read back only when a range actually exists.
    const rangeSource =
      (mask.ranges?.length ?? 0) > 0
        ? sourcePixelsOf(request.image, request.width, request.height)
        : null;
    if ((mask.ranges?.length ?? 0) > 0 && !rangeSource) {
      return { error: 'the browser refused a source canvas for the range selection' };
    }
    const strength = rasteriseMask(mask, request.width, request.height, rangeSource);
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = request.width;
    maskCanvas.height = request.height;
    const maskContext = maskCanvas.getContext('2d');
    if (!maskContext) return { error: 'the browser refused a mask canvas' };
    const image = maskContext.createImageData(request.width, request.height);
    for (let index = 0; index < strength.length; index += 1) {
      const value = strength[index] ?? 0;
      image.data[index * 4] = value;
      image.data[index * 4 + 1] = value;
      image.data[index * 4 + 2] = value;
      image.data[index * 4 + 3] = 255;
    }
    maskContext.putImageData(image, 0, 0);
    const maskTexture = uploadTexture(gl, maskCanvas, false);
    if (typeof maskTexture === 'string') return { error: maskTexture };

    gl.useProgram(maskProgram.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(maskProgram.uniforms.uOriginal ?? null, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, read);
    gl.uniform1i(maskProgram.uniforms.uAdjusted ?? null, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);
    gl.uniform1i(maskProgram.uniforms.uMask ?? null, 2);
    drawTo(writeTarget);
    read = writeTarget.texture;
  }

  // Copy the final framebuffer into a readable canvas. `preserveDrawingBuffer` keeps the pixels
  // valid after the draw, which is what makes export a copy of the preview rather than a re-render.
  //
  // WebGL textures are sampled bottom-up while the 2D canvas is top-down. The source is uploaded
  // *without* the unpack flip (browsers ignore that flag for `ImageBitmap`, so relying on it would
  // make the preview depend on how the image happened to be decoded), which leaves the render
  // upside down; flipping once here, at the boundary, makes both decode paths agree.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, request.width, request.height);
  const composite = document.createElement('canvas');
  composite.width = request.width;
  composite.height = request.height;
  const context = composite.getContext('2d');
  if (!context) return { error: 'the browser refused a composite canvas' };

  if (read === source && active.length === 0) {
    context.drawImage(request.image, 0, 0, request.width, request.height);
  } else {
    // The last pass wrote into `read`'s texture; render a final copy pass from it.
    gl.useProgram(adjust.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read);
    gl.uniform1i(adjust.uniforms.uSource ?? null, 0);
    gl.uniform1i(adjust.uniforms.uKind ?? null, -1);
    gl.uniform1f(adjust.uniforms.uValue ?? null, 0);
    gl.uniform2f(adjust.uniforms.uSize ?? null, request.width, request.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, request.width, request.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    context.save();
    context.translate(0, request.height);
    context.scale(1, -1);
    context.drawImage(glCanvas, 0, 0);
    context.restore();
  }

  applyRetouch(composite, request.payload.retouch);
  return { canvas: composite };
}

/* --------------------------------------------------------------------------------------------- */
/* Decoding and the public render API                                                            */
/* --------------------------------------------------------------------------------------------- */

export type DecodedPhoto = {
  readonly image: PhotoImageSource;
  readonly width: number;
  readonly height: number;
};

/** Decodes a data URL or blob URL into a drawable image, preferring `createImageBitmap`. */
export async function decodePhotoSource(href: string): Promise<Result<DecodedPhoto>> {
  if (typeof createImageBitmap === 'function') {
    try {
      const response = await fetch(href);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      return ok({ image: bitmap, width: bitmap.width, height: bitmap.height });
    } catch {
      // Fall through to an <img> decode: some browsers refuse blob fetches for data URLs.
    }
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      resolve(ok({ image, width: image.naturalWidth, height: image.naturalHeight }));
    };
    image.onerror = () => {
      resolve(
        err(
          forgeError('unsupported', 'The image could not be decoded by this browser.', {
            detail: 'The file may be corrupt, or in a format this browser cannot open.',
            retryable: false,
          }),
        ),
      );
    };
    image.src = href;
  });
}

/** Renders a photo document at a given output size, choosing the engine the payload asks for. */
export async function renderPhoto(request: PhotoRenderRequest): Promise<Result<PhotoRenderResult>> {
  const started = performance.now();
  const preference = request.payload.engine;
  const hasWebgl = detectWebgl2();

  if (preference === 'webgl2' && !hasWebgl) {
    return err(
      forgeError('unsupported', 'The GPU renderer is not available in this browser.', {
        detail:
          'WebGL2 could not be created, so this document cannot use the GPU path. Switch the renderer to automatic or CPU.',
        retryable: false,
      }),
    );
  }

  const useWebgl = preference !== 'canvas2d' && hasWebgl;
  if (useWebgl) {
    let gpu: { canvas: HTMLCanvasElement } | { error: string };
    try {
      gpu = renderWithWebgl2(request);
    } catch (error) {
      gpu = { error: error instanceof Error ? error.message : 'the GPU renderer failed' };
    }
    if ('canvas' in gpu) {
      return ok({
        canvas: gpu.canvas,
        engine: 'webgl2',
        fallbackReason: null,
        durationMs: performance.now() - started,
      });
    }
    // A shader/context failure falls back rather than leaving the user with no image. The reason is
    // reported so the panel can say what happened instead of quietly changing engines.
    try {
      const canvas = renderWithCanvas2d(request);
      return ok({
        canvas,
        engine: 'canvas2d',
        fallbackReason: gpu.error,
        durationMs: performance.now() - started,
      });
    } catch (error) {
      return err(
        forgeError('unsupported', 'The photo could not be rendered.', {
          detail: `${gpu.error} ${error instanceof Error ? error.message : ''}`.trim(),
          retryable: false,
        }),
      );
    }
  }

  try {
    return ok({
      canvas: renderWithCanvas2d(request),
      engine: 'canvas2d',
      fallbackReason: null,
      durationMs: performance.now() - started,
    });
  } catch (error) {
    return err(
      forgeError('unsupported', 'The photo could not be rendered.', {
        detail: error instanceof Error ? error.message : 'the canvas renderer failed',
        retryable: false,
      }),
    );
  }
}

/* --------------------------------------------------------------------------------------------- */
/* Import                                                                                        */
/* --------------------------------------------------------------------------------------------- */

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type PreparedPhoto = {
  readonly source: PhotoSource;
  readonly downscaledFrom: { readonly width: number; readonly height: number } | null;
};

function dataUrlMime(dataUrl: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (dataUrl.startsWith('data:image/png')) return 'image/png';
  if (dataUrl.startsWith('data:image/webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Decodes a user's file, scales the working copy down to the documented limit, and re-encodes it.
 *
 * SVG is deliberately refused: an SVG is a document that can reference external resources and carry
 * script, and embedding one in a project would make opening a project a way to load it. PNG, JPEG
 * and WebP are decoded by the browser's own image pipeline and copied into pixels.
 */
export async function preparePhoto(file: File): Promise<Result<PreparedPhoto>> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return err(
      forgeError('unsupported', 'That file type cannot be opened as a photo.', {
        detail:
          file.type === 'image/svg+xml'
            ? 'SVG is a document rather than a bitmap and is not imported into Photo Studio.'
            : `Choose a PNG, JPEG or WebP file. This one is “${file.type || 'unknown'}”.`,
        retryable: false,
      }),
    );
  }

  const objectUrl = URL.createObjectURL(file);
  const decoded = await decodePhotoSource(objectUrl);
  URL.revokeObjectURL(objectUrl);
  if (!decoded.ok) return decoded;
  const { image, width, height } = decoded.value;
  const longest = Math.max(width, height);
  const scale = longest > MAX_PHOTO_WORKING_EDGE ? MAX_PHOTO_WORKING_EDGE / longest : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return err(forgeError('unsupported', 'This browser refused a canvas for the image.'));
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  let href = canvas.toDataURL('image/webp', 0.9);
  if (!href.startsWith('data:image/webp')) {
    href = canvas.toDataURL('image/jpeg', 0.92);
  }
  if (href.length > MAX_PHOTO_HREF_LENGTH) {
    return err(
      forgeError('storage-quota-exceeded', 'That photo is too large to store inside a project.', {
        detail: `The encoded working copy is ${String(href.length)} characters; the limit is ${String(MAX_PHOTO_HREF_LENGTH)}. Try a smaller image.`,
        retryable: false,
      }),
    );
  }

  if (typeof image !== 'string' && 'close' in image && typeof image.close === 'function') {
    image.close();
  }

  return ok({
    source: {
      name: file.name || 'Photo',
      href,
      width: targetWidth,
      height: targetHeight,
      mimeType: dataUrlMime(href),
      originalWidth: width,
      originalHeight: height,
    },
    downscaledFrom: scale < 1 ? { width, height } : null,
  });
}

/** Exports a rendered canvas as a real file through the browser's own encoder. */
export function canvasToBytes(
  canvas: HTMLCanvasElement,
  mimeType: PhotoExportMimeType,
  quality = 0.92,
): Promise<Result<Uint8Array>> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(err(forgeError('unsupported', 'The browser could not encode the image.')));
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => {
            resolve(ok(new Uint8Array(buffer)));
          })
          .catch(() => {
            resolve(err(forgeError('unsupported', 'The encoded image could not be read back.')));
          });
      },
      mimeType,
      quality,
    );
  });
}

/** True when the browser can encode the requested export type. */
export function canEncodeImage(mimeType: string): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL(mimeType).startsWith(`data:${mimeType}`);
}
