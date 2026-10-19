/**
 * The native planner: a deterministic compiler from a sentence to a typed plan.
 *
 * This build ships no model. Rather than pretend otherwise, the planner compiles the requests it can
 * prove it understands into the same tool calls a provider would produce, and returns an explicit
 * `unsupported` entry — with alternatives — for everything else. The interface labels plans from here
 * as “native”, so a request that needs a model is refused honestly instead of being mimed.
 *
 * Determinism matters for two reasons: the same sentence produces the same plan on every device, and
 * the tests can assert exact tool sequences instead of scoring fuzzy output.
 */

import { ok, type Result } from '../result';
import type {
  AssistantPlan,
  AssistantStudio,
  ToolArgs,
  ToolCall,
  UnsupportedRequest,
} from './registry';
import { findTool, STUDIO_LABELS } from './registry';

const COLOUR_NAMES: Readonly<Record<string, string>> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#facc15',
  orange: '#f97316',
  purple: '#a855f7',
  pink: '#ec4899',
  teal: '#14b8a6',
  black: '#111111',
  white: '#ffffff',
  grey: '#9ca3af',
  gray: '#9ca3af',
};

const HEX = /#[0-9a-f]{6}\b/i;

let sequence = 0;
function step(tool: string, args: ToolArgs): ToolCall {
  sequence += 1;
  return { id: `step-${String(sequence)}`, tool, args };
}

function colourFrom(text: string): string | null {
  const hex = HEX.exec(text)?.[0];
  if (hex) return hex.toLowerCase();
  for (const [name, value] of Object.entries(COLOUR_NAMES)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(text)) return value;
  }
  return null;
}

/** The quoted run in a sentence, or the words after “says”/“saying”. */
function quotedContent(text: string): string | null {
  const quoted = /"([^"]{1,240})"|'([^']{1,240})'/.exec(text);
  if (quoted) return quoted[1] ?? quoted[2] ?? null;
  const said = /\b(?:says|saying|reads?)\s+(.{1,200})$/i.exec(text);
  return said?.[1]?.trim() ?? null;
}

const EXPORT_FORMAT = (text: string): 'png' | 'jpeg' | 'webp' =>
  /\b(jpe?g)\b/i.test(text) ? 'jpeg' : /\bwebp\b/i.test(text) ? 'webp' : 'png';

const UNSUPPORTED_BACKGROUND: UnsupportedRequest = {
  request: 'Remove the background',
  why: 'Cutting a subject out of a photograph needs a segmentation model. This build has no model configured, and a luminance/colour range is not the same thing.',
  alternatives: [
    'Select a plain background by colour, then mask it: “select background colour #ffffff and lower the exposure”.',
    'Ask for the work in a deployment with a configured provider, where the same plan can call a segmentation step.',
  ],
};

const STUDIO_ALTERNATIVES: Readonly<Record<AssistantStudio, readonly string[]>> = {
  design: ['“add a rectangle 320x180”', '“add text that says Spring sale”'],
  photo: [
    '“make this cinematic”',
    '“brighter”',
    '“warmer”',
    '“black and white”',
    '“select dark pixels”',
    '“export a jpeg”',
  ],
  illustration: [
    '“fill the selected paths with #22cc88”',
    '“stroke the selected paths with black at 4”',
    '“put the text \\"Hello\\" on the path”',
    '“export the artboard as svg”',
  ],
  motion: ['Motion documents can be edited by hand; the assistant cannot drive the timeline yet.'],
  video: ['Video clips can be trimmed by hand; the assistant cannot drive the timeline yet.'],
};

export function noModelNotice(): string {
  return 'No external model is configured, so the native planner is used: it understands a fixed, documented vocabulary and refuses the rest.';
}

function compilePhoto(clause: string): {
  readonly calls: readonly ToolCall[];
  readonly unsupported: readonly UnsupportedRequest[];
  readonly understood: boolean;
} {
  const lower = clause.toLowerCase();
  const calls: ToolCall[] = [];
  const unsupported: UnsupportedRequest[] = [];

  if (/\b(remove|drop|delete)\b.*\bbackground\b|\bcut\s*(it\s*)?out\b/.test(lower)) {
    unsupported.push(UNSUPPORTED_BACKGROUND);
  }
  if (/\bcinematic|\bfilmic|\bmoody|\bdramatic\b/.test(lower)) {
    calls.push(
      step('photo.adjust', { adjustment: 'contrast', value: 18, mode: 'add' }),
      step('photo.adjust', { adjustment: 'saturation', value: 8, mode: 'add' }),
      step('photo.adjust', { adjustment: 'temperature', value: -6, mode: 'add' }),
      step('photo.adjust', { adjustment: 'shadows', value: 12, mode: 'add' }),
      step('photo.adjust', { adjustment: 'vignette', value: 14, mode: 'add' }),
    );
  }
  if (/\bbrighter\b|\bbrighten\b|\blighter\b/.test(lower)) {
    calls.push(step('photo.adjust', { adjustment: 'exposure', value: 20, mode: 'add' }));
  }
  if (/\bdarker\b|\bdarken\b/.test(lower)) {
    calls.push(step('photo.adjust', { adjustment: 'exposure', value: -20, mode: 'add' }));
  }
  if (/\bwarmer\b|\bwarm it\b/.test(lower)) {
    calls.push(step('photo.adjust', { adjustment: 'temperature', value: 25, mode: 'add' }));
  }
  if (/\bcooler\b|\bcolder\b/.test(lower)) {
    calls.push(step('photo.adjust', { adjustment: 'temperature', value: -25, mode: 'add' }));
  }
  if (/\bmore contrast\b/.test(lower)) {
    calls.push(step('photo.adjust', { adjustment: 'contrast', value: 15, mode: 'add' }));
  }
  if (/\bless contrast\b/.test(lower)) {
    calls.push(step('photo.adjust', { adjustment: 'contrast', value: -15, mode: 'add' }));
  }
  if (/\bblack\s*(and|&)\s*white\b|\bmonochrome\b|\bb\s*&\s*w\b/.test(lower)) {
    calls.push(
      step('photo.adjust', { adjustment: 'grayscale', value: 100, mode: 'set' }),
      step('photo.adjust', { adjustment: 'contrast', value: 10, mode: 'add' }),
    );
  }
  if (/\bvignette\b/.test(lower) && !/\bcinematic\b/.test(lower)) {
    calls.push(step('photo.adjust', { adjustment: 'vignette', value: 20, mode: 'add' }));
  }
  if (/\bselect\b.*\b(dark|shadow|shadows)\b/.test(lower)) {
    calls.push(step('photo.range_select', { kind: 'luminance', min: 0, max: 0.35, feather: 0.15 }));
  }
  if (/\bselect\b.*\b(bright|highlight|highlights)\b/.test(lower)) {
    calls.push(step('photo.range_select', { kind: 'luminance', min: 0.65, max: 1, feather: 0.15 }));
  }
  if (/\bselect\b.*\bbackground\b/.test(lower)) {
    const colour = colourFrom(clause);
    if (colour) {
      calls.push(
        step('photo.range_select', { kind: 'colour', colour, tolerance: 0.18, feather: 0.1 }),
      );
    } else {
      unsupported.push({
        request: clause,
        why: 'A background selection needs the colour to match, and none was given.',
        alternatives: ['Name the colour: “select background colour #ffffff”.'],
      });
    }
  }
  if (/\bexport\b|\bsave\b|\bdownload\b/.test(lower)) {
    calls.push(step('photo.export', { format: EXPORT_FORMAT(lower) }));
  }

  return { calls, unsupported, understood: calls.length > 0 || unsupported.length > 0 };
}

function compileIllustration(clause: string): {
  readonly calls: readonly ToolCall[];
  readonly unsupported: readonly UnsupportedRequest[];
  readonly understood: boolean;
} {
  const lower = clause.toLowerCase();
  const calls: ToolCall[] = [];
  const unsupported: UnsupportedRequest[] = [];

  const colour = colourFrom(clause);
  if (/\bfill\b/.test(lower) && colour) {
    calls.push(step('illustration.set_fill', { colour }));
  }
  if (/\bstroke\b/.test(lower) && colour) {
    const width = /\b(\d+(?:\.\d+)?)\s*(?:px|units?)?\b/.exec(clause.replace(HEX, ''))?.[1];
    const args: Record<string, string | number> = { colour };
    if (width !== undefined) args.width = Number(width);
    calls.push(step('illustration.set_stroke', args));
  }
  if (/\btext\b/.test(lower) && /\bpath\b|\bcurve\b/.test(lower)) {
    const content = quotedContent(clause);
    if (content) {
      calls.push(step('illustration.text_on_path', { content }));
    } else {
      unsupported.push({
        request: clause,
        why: 'Text on a path needs the exact words, and none were quoted.',
        alternatives: ['Quote the run: “put the text \\"Hello\\" on the path”.'],
      });
    }
  }
  if (/\bexport\b|\bdownload\b|\bsave\b/.test(lower) && /\bsvg\b|\bartboard\b/.test(lower)) {
    calls.push(step('illustration.export_svg', {}));
  }

  return { calls, unsupported, understood: calls.length > 0 || unsupported.length > 0 };
}

function compileDesign(clause: string): {
  readonly calls: readonly ToolCall[];
  readonly unsupported: readonly UnsupportedRequest[];
  readonly understood: boolean;
} {
  const lower = clause.toLowerCase();
  const calls: ToolCall[] = [];
  const unsupported: UnsupportedRequest[] = [];

  if (/\badd\b.*\b(text|headline|title|caption)\b/.test(lower)) {
    const content = quotedContent(clause);
    if (content) calls.push(step('design.add_text', { content }));
    else {
      unsupported.push({
        request: clause,
        why: 'A text layer needs the words, and none were quoted.',
        alternatives: ['Quote it: “add a headline that says Spring sale”.'],
      });
    }
  }
  const size = /\b(\d{1,5})\s*(?:x|×|by)\s*(\d{1,5})\b/.exec(lower);
  if (/\b(add|place|draw)\b.*\brectangle\b/.test(lower) && size) {
    calls.push(step('design.add_rectangle', { width: Number(size[1]), height: Number(size[2]) }));
  } else if (/\brectangle\b/.test(lower) && /\badd|place|draw\b/.test(lower)) {
    unsupported.push({
      request: clause,
      why: 'The rectangle needs a size, and none was given.',
      alternatives: ['Give the size: “add a rectangle 320x180”.'],
    });
  }

  return { calls, unsupported, understood: calls.length > 0 || unsupported.length > 0 };
}

/**
 * Splits a request into clauses without losing quoted text.
 *
 * “Make it warmer and put the text "sunset and sea" on the path” must not split inside the quotes.
 */
export function splitClauses(text: string): readonly string[] {
  const clauses: string[] = [];
  const pattern = /("[^"]*"|'[^']*')|([,;\n])|\b(?:and|then)\b/gi;
  let last = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    // A quoted run is text, not a separator: skip over it and keep scanning after it.
    if (match[1] !== undefined) continue;
    clauses.push(text.slice(last, match.index));
    last = pattern.lastIndex;
  }
  clauses.push(text.slice(last));
  return clauses.map((clause) => clause.trim()).filter((clause) => clause.length > 0);
}

/**
 * Compiles a request for one studio.
 *
 * The same sentence can be understood differently from studio to studio, which is deliberate: “make
 * it cinematic” is a photo adjustment order, not a vector one, and the planner never invents a step
 * for a studio whose registry does not contain it.
 */
export function planNatively(studio: AssistantStudio, request: string): Result<AssistantPlan> {
  const clauses = splitClauses(request);
  const calls: ToolCall[] = [];
  const unsupported: UnsupportedRequest[] = [];

  for (const clause of clauses) {
    const compiled =
      studio === 'photo'
        ? compilePhoto(clause)
        : studio === 'illustration'
          ? compileIllustration(clause)
          : studio === 'design'
            ? compileDesign(clause)
            : { calls: [], unsupported: [], understood: false };
    calls.push(...compiled.calls);
    unsupported.push(...compiled.unsupported);
  }

  // A provider may repeat itself; the native vocabulary does not need to. Identical calls collapse,
  // and a later clause may still refine an earlier one because each call carries its own arguments.
  const seen = new Set<string>();
  const unique = calls.filter((call) => {
    const key = `${call.tool}:${JSON.stringify(call.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (studio === 'motion' || studio === 'video') {
    return ok({
      intent: `The assistant cannot operate the ${STUDIO_LABELS[studio]} timeline yet.`,
      steps: [],
      unsupported: [
        {
          request,
          why: `${STUDIO_LABELS[studio]} is not connected to the assistant, and this build has no model to improvise with.`,
          alternatives: STUDIO_ALTERNATIVES[studio],
        },
      ],
      source: 'native',
    });
  }

  if (unique.length === 0 && unsupported.length === 0) {
    return ok({
      intent: 'No actionable request was found.',
      steps: [],
      unsupported: [
        {
          request,
          why: 'The native planner only understands a documented vocabulary, and this sentence is outside it.',
          alternatives: STUDIO_ALTERNATIVES[studio],
        },
      ],
      source: 'native',
    });
  }

  const labels = unique.map((call) => findTool(call.tool)?.label ?? call.tool);
  return ok({
    intent:
      labels.length > 0
        ? `${labels.length} step(s): ${labels.join(', ')}.`
        : 'No step can run, but the request is explained below.',
    steps: unique,
    unsupported,
    source: 'native',
  });
}
