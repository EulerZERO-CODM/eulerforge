/**
 * The assistant's typed tool registry.
 *
 * The assistant is not a chat window with an imagination: every action it can take is one of the
 * tools declared here, with named parameters, documented ranges and an honest availability label.
 * Two consequences follow, and both are the point:
 *
 *  - **A plan is data, not code.** Whether it is written by the deterministic planner that ships
 *    with this build or by a provider's model, a plan is a list of `ToolCall`s. Nothing in a plan can
 *    reach the document except through a tool in this registry.
 *  - **Refusal is a first-class answer.** A capability this build cannot offer is registered as
 *    `unavailable` with a reason, so the assistant can say what it will not do instead of producing a
 *    plausible-sounding step that silently does nothing.
 *
 * Argument validation happens here, not in the tools: a model can emit `{"value": "lots"}`, and the
 * registry must reject it before any document is touched.
 */

import { err, forgeError, ok, type Result } from '../result';
import { PHOTO_ADJUSTMENT_KINDS } from '../documents/payload';
import { PATH_TEXT_BASELINES, PATH_TEXT_LIMITS } from '../documents/layer-types';

export const ASSISTANT_STUDIOS = ['design', 'photo', 'illustration', 'motion', 'video'] as const;
export type AssistantStudio = (typeof ASSISTANT_STUDIOS)[number];

export const STUDIO_LABELS: Readonly<Record<AssistantStudio, string>> = {
  design: 'Design Studio',
  photo: 'Photo Studio',
  illustration: 'Illustration Studio',
  motion: 'Motion Studio',
  video: 'Video Studio',
};

export type ToolParamType = 'string' | 'number' | 'boolean' | 'enum';

export type ToolParam = {
  readonly name: string;
  readonly type: ToolParamType;
  readonly description: string;
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly string[];
  /** Largest accepted string, in characters. */
  readonly maxLength?: number;
};

export type ToolAvailability =
  /** Runs entirely in this build, through the document commands. */
  | { readonly kind: 'native' }
  /** Requires an external model or service that this deployment has not configured. */
  | { readonly kind: 'needs-provider'; readonly reason: string }
  /** Not implemented in this build at all; the assistant must say so rather than improvise. */
  | { readonly kind: 'unavailable'; readonly reason: string };

export type ToolSpec = {
  /** Stable dotted id, e.g. `photo.adjust`. Plans reference this and nothing else. */
  readonly id: string;
  readonly studio: AssistantStudio;
  readonly label: string;
  readonly description: string;
  readonly params: readonly ToolParam[];
  readonly availability: ToolAvailability;
  /** What the tool changes, in one line, for the before/after summary. */
  readonly effect: string;
};

export type ToolArgs = Readonly<Record<string, string | number | boolean>>;

export type ToolCall = {
  readonly id: string;
  readonly tool: string;
  readonly args: ToolArgs;
};

export type UnsupportedRequest = {
  readonly request: string;
  readonly why: string;
  readonly alternatives: readonly string[];
};

export type AssistantPlan = {
  /** What the assistant understood, in one sentence, shown before anything runs. */
  readonly intent: string;
  readonly steps: readonly ToolCall[];
  readonly unsupported: readonly UnsupportedRequest[];
  readonly source: 'native' | 'provider';
};

/** Why a planned step cannot run in this build. */
export type PlanIssue = {
  readonly stepId: string;
  readonly tool: string;
  readonly message: string;
};

export const PHOTO_ADJUSTMENT_OPTIONS = PHOTO_ADJUSTMENT_KINDS;

const COLOUR_ARG: ToolParam = {
  name: 'colour',
  type: 'string',
  description: 'Six-digit hex colour, e.g. #22cc88.',
  required: true,
};

export const ASSISTANT_TOOLS: readonly ToolSpec[] = Object.freeze([
  {
    id: 'photo.adjust',
    studio: 'photo',
    label: 'Adjust a photograph',
    description:
      'Set or nudge one entry of the photo adjustment stack. Values are clamped to the same ranges the adjustment panel uses.',
    params: [
      {
        name: 'adjustment',
        type: 'enum',
        description: 'Which adjustment to change.',
        required: true,
        options: PHOTO_ADJUSTMENT_OPTIONS,
      },
      {
        name: 'value',
        type: 'number',
        description: 'New value in the panel’s units.',
        required: true,
        min: -100,
        max: 100,
      },
      {
        name: 'mode',
        type: 'enum',
        description: 'Replace the current value, or add to it.',
        options: ['set', 'add'],
      },
    ],
    availability: { kind: 'native' },
    effect: 'Adds or edits one adjustment in the non-destructive stack.',
  },
  {
    id: 'photo.range_select',
    studio: 'photo',
    label: 'Select pixels by luminance or colour',
    description:
      'Adds one range selection to the photo mask, measured from the unadjusted source pixels.',
    params: [
      {
        name: 'kind',
        type: 'enum',
        description: 'What to compare against.',
        required: true,
        options: ['luminance', 'colour'],
      },
      { name: 'min', type: 'number', description: 'Lower luminance bound, 0–1.', min: 0, max: 1 },
      { name: 'max', type: 'number', description: 'Upper luminance bound, 0–1.', min: 0, max: 1 },
      {
        name: 'colour',
        type: 'string',
        description: 'Target colour as six-digit hex.',
        maxLength: 7,
      },
      { name: 'tolerance', type: 'number', description: 'Colour distance, 0–1.', min: 0, max: 1 },
      { name: 'feather', type: 'number', description: 'Edge softness, 0–1.', min: 0, max: 1 },
    ],
    availability: { kind: 'native' },
    effect: 'Limits the stack to the selected pixels, unioned with any painted mask.',
  },
  {
    id: 'photo.export',
    studio: 'photo',
    label: 'Export the photograph',
    description: 'Renders the document at its stored size and downloads a real image file.',
    params: [
      {
        name: 'format',
        type: 'enum',
        description: 'Encoder to ask the browser for.',
        required: true,
        options: ['png', 'jpeg', 'webp'],
      },
    ],
    availability: { kind: 'native' },
    effect: 'Writes the exported bytes and reports the size the browser actually produced.',
  },
  {
    id: 'illustration.set_fill',
    studio: 'illustration',
    label: 'Fill the selected path',
    description: 'Sets the solid fill colour of every selected path layer.',
    params: [COLOUR_ARG],
    availability: { kind: 'native' },
    effect: 'Changes fill paint on the selected paths.',
  },
  {
    id: 'illustration.set_stroke',
    studio: 'illustration',
    label: 'Set the stroke',
    description: 'Sets the stroke colour and width of every selected path layer.',
    params: [
      COLOUR_ARG,
      {
        name: 'width',
        type: 'number',
        description: 'Stroke width in document units.',
        min: 0,
        max: 200,
      },
    ],
    availability: { kind: 'native' },
    effect: 'Changes stroke paint and width on the selected paths.',
  },
  {
    id: 'illustration.text_on_path',
    studio: 'illustration',
    label: 'Put text on the selected path',
    description: 'Lays one editable run of text along the selected path’s own contour.',
    params: [
      {
        name: 'content',
        type: 'string',
        description: 'The words to lay along the contour.',
        required: true,
        maxLength: PATH_TEXT_LIMITS.maxContentLength,
      },
      {
        name: 'fontSize',
        type: 'number',
        description: 'Glyph size in document units.',
        min: PATH_TEXT_LIMITS.minFontSize,
        max: PATH_TEXT_LIMITS.maxFontSize,
      },
      {
        name: 'baseline',
        type: 'enum',
        description: 'Which side of the line the run sits on.',
        options: PATH_TEXT_BASELINES,
      },
    ],
    availability: { kind: 'native' },
    effect: 'Stores a text run on the path and paints it.',
  },
  {
    id: 'illustration.export_svg',
    studio: 'illustration',
    label: 'Export the artboard as SVG',
    description: 'Serialises the artboard and downloads the file the exporter produced.',
    params: [],
    availability: { kind: 'native' },
    effect: 'Writes an SVG file and reports its real byte count.',
  },
  {
    id: 'design.add_text',
    studio: 'design',
    label: 'Add a text layer',
    description: 'Adds a text layer to the design canvas and sets its content.',
    params: [
      {
        name: 'content',
        type: 'string',
        description: 'The text to place.',
        required: true,
        maxLength: 200,
      },
      {
        name: 'x',
        type: 'number',
        description: 'Left edge in document units.',
        min: 0,
        max: 20_000,
      },
      {
        name: 'y',
        type: 'number',
        description: 'Top edge in document units.',
        min: 0,
        max: 20_000,
      },
    ],
    availability: { kind: 'native' },
    effect: 'Adds one undoable text layer.',
  },
  {
    id: 'design.add_rectangle',
    studio: 'design',
    label: 'Add a rectangle',
    description: 'Adds a rectangle layer of the requested size.',
    params: [
      {
        name: 'width',
        type: 'number',
        description: 'Width in document units.',
        required: true,
        min: 1,
        max: 20_000,
      },
      {
        name: 'height',
        type: 'number',
        description: 'Height in document units.',
        required: true,
        min: 1,
        max: 20_000,
      },
      {
        name: 'x',
        type: 'number',
        description: 'Left edge in document units.',
        min: 0,
        max: 20_000,
      },
      {
        name: 'y',
        type: 'number',
        description: 'Top edge in document units.',
        min: 0,
        max: 20_000,
      },
    ],
    availability: { kind: 'native' },
    effect: 'Adds one undoable rectangle layer.',
  },
  {
    id: 'motion.add_keyframe',
    studio: 'motion',
    label: 'Animate a property',
    description: 'Adds a keyframe to the motion timeline.',
    params: [
      {
        name: 'property',
        type: 'enum',
        description: 'Which property to animate.',
        required: true,
        options: ['x', 'y', 'opacity', 'scale'],
      },
      {
        name: 'time',
        type: 'number',
        description: 'Time in seconds.',
        required: true,
        min: 0,
        max: 600,
      },
      {
        name: 'value',
        type: 'number',
        description: 'Value at that time.',
        required: true,
        min: -20_000,
        max: 20_000,
      },
    ],
    availability: {
      kind: 'unavailable',
      reason:
        'The motion timeline is not connected to the assistant yet; it stays editable by hand.',
    },
    effect: 'Would add a keyframe to the active motion document.',
  },
  {
    id: 'video.trim',
    studio: 'video',
    label: 'Trim a clip',
    description: 'Sets the in and out points of a clip.',
    params: [
      {
        name: 'start',
        type: 'number',
        description: 'In point in seconds.',
        required: true,
        min: 0,
        max: 3600,
      },
      {
        name: 'end',
        type: 'number',
        description: 'Out point in seconds.',
        required: true,
        min: 0,
        max: 3600,
      },
    ],
    availability: {
      kind: 'unavailable',
      reason:
        'The video timeline is not connected to the assistant yet; trimming stays a manual edit.',
    },
    effect: 'Would set the clip’s in and out points.',
  },
]);

/** Tools a given studio can offer, in registry order. */
export function toolsForStudio(studio: AssistantStudio): readonly ToolSpec[] {
  return ASSISTANT_TOOLS.filter((tool) => tool.studio === studio);
}

export function findTool(id: string): ToolSpec | undefined {
  return ASSISTANT_TOOLS.find((tool) => tool.id === id);
}

/** True when a tool can run in this build without an external provider. */
export function isNative(tool: ToolSpec): boolean {
  return tool.availability.kind === 'native';
}

function invalid(message: string, detail?: string): Result<never> {
  return err(
    forgeError('validation-failed', message, {
      ...(detail === undefined ? {} : { detail }),
      retryable: false,
    }),
  );
}

/**
 * Validates and normalises a tool's arguments.
 *
 * Unknown keys are rejected rather than ignored: a model that invents `amount` when the parameter is
 * `value` has misunderstood the tool, and quietly dropping the argument would run a step that does
 * not do what the plan says. Numbers are never parsed from strings, because `"5"` and `5` reaching a
 * document as different types is exactly how a schema drift becomes a persisted bug.
 */
export function validateToolArgs(
  spec: ToolSpec,
  raw: Readonly<Record<string, unknown>>,
): Result<ToolArgs> {
  const known = new Set(spec.params.map((param) => param.name));
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      return invalid(
        `“${key}” is not a parameter of ${spec.id}.`,
        `Accepted: ${[...known].join(', ') || 'none'}.`,
      );
    }
  }

  const out: Record<string, string | number | boolean> = {};
  for (const param of spec.params) {
    const value = raw[param.name];
    if (value === undefined || value === null) {
      if (param.required) return invalid(`${spec.id} needs “${param.name}”.`);
      continue;
    }
    switch (param.type) {
      case 'string': {
        if (typeof value !== 'string') return invalid(`${param.name} must be a string.`);
        if (param.maxLength !== undefined && value.length > param.maxLength) {
          return invalid(`${param.name} is longer than ${String(param.maxLength)} characters.`);
        }
        if (value.trim().length === 0) return invalid(`${param.name} may not be empty.`);
        out[param.name] = value;
        break;
      }
      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          return invalid(`${param.name} must be a finite number.`);
        }
        if (param.min !== undefined && value < param.min) {
          return invalid(`${param.name} must be at least ${String(param.min)}.`);
        }
        if (param.max !== undefined && value > param.max) {
          return invalid(`${param.name} must be at most ${String(param.max)}.`);
        }
        out[param.name] = value;
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') return invalid(`${param.name} must be true or false.`);
        out[param.name] = value;
        break;
      }
      case 'enum': {
        if (typeof value !== 'string') return invalid(`${param.name} must be a string.`);
        if (!param.options?.includes(value)) {
          return invalid(
            `${param.name} must be one of ${param.options?.join(', ') ?? ''}.`,
            `Received “${value}”.`,
          );
        }
        out[param.name] = value;
        break;
      }
    }
  }
  return ok(Object.freeze(out));
}

/**
 * Checks a whole plan against the registry before a single step runs.
 *
 * A plan is rejected if a step names an unknown tool, if a step needs a capability this build does
 * not have, or if its arguments do not validate. The executor still revalidates at run time, because
 * a plan is data and may have travelled over the network.
 */
export function checkPlan(plan: AssistantPlan): Result<{ readonly issues: readonly PlanIssue[] }> {
  const issues: PlanIssue[] = [];
  if (plan.steps.length === 0 && plan.unsupported.length === 0) {
    return invalid(
      'The plan has nothing in it.',
      'Ask for a change to the document, not a question.',
    );
  }
  for (const step of plan.steps) {
    const spec = findTool(step.tool);
    if (!spec) {
      issues.push({ stepId: step.id, tool: step.tool, message: `Unknown tool “${step.tool}”.` });
      continue;
    }
    const args = validateToolArgs(spec, step.args);
    if (!args.ok) {
      issues.push({ stepId: step.id, tool: step.tool, message: args.error.message });
      continue;
    }
    if (spec.availability.kind !== 'native') {
      issues.push({
        stepId: step.id,
        tool: step.tool,
        message:
          spec.availability.kind === 'needs-provider'
            ? `${spec.label} needs a configured provider: ${spec.availability.reason}`
            : `${spec.label} is not available in this build: ${spec.availability.reason}`,
      });
    }
  }
  return ok({ issues: Object.freeze(issues) });
}

/**
 * The capability matrix the UI and a provider both see.
 *
 * It is generated from the registry rather than written by hand, so a tool that is added, removed or
 * marked unavailable cannot leave a stale sentence behind in the interface.
 */
export function capabilitySummary(): string {
  return ASSISTANT_STUDIOS.map((studio) => {
    const tools = toolsForStudio(studio).map((tool) =>
      tool.availability.kind === 'native' ? tool.id : `${tool.id} (${tool.availability.kind})`,
    );
    return `${STUDIO_LABELS[studio]}: ${tools.join(', ') || 'no tools yet'}`;
  }).join('\n');
}

/**
 * The catalogue an external provider may choose from.
 *
 * It contains ids, descriptions and parameter shapes only — never a document, a selection, a file
 * path or a credential. That separation is what lets the reasoning live on a server while the work
 * stays local.
 */
export function providerToolCatalogue(): readonly {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
}[] {
  return ASSISTANT_TOOLS.filter((tool) => isNative(tool)).map((tool) => ({
    name: tool.id,
    description: `${tool.label}. ${tool.description}`,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        tool.params.map((param) => [
          param.name,
          {
            type: param.type === 'enum' ? 'string' : param.type,
            description: param.description,
            ...(param.options ? { enum: param.options } : {}),
            ...(param.min !== undefined ? { minimum: param.min } : {}),
            ...(param.max !== undefined ? { maximum: param.max } : {}),
            ...(param.maxLength !== undefined ? { maxLength: param.maxLength } : {}),
          },
        ]),
      ),
      required: tool.params.filter((param) => param.required).map((param) => param.name),
      additionalProperties: false,
    },
  }));
}
