/**
 * The provider boundary.
 *
 * The assistant has exactly two ways to produce a plan: the deterministic native planner, and a
 * model reached through a server-side route. Both produce the same value — a list of typed tool
 * calls — and neither can touch a document by itself.
 *
 * This module owns the second path's contract:
 *
 *  - `readProviderConfig` reads the server's own environment. The credential is a field of a value
 *    that never crosses into a response, a document or a log line.
 *  - `buildProviderMessages` turns a goal and the registry's catalogue into a chat request. The
 *    catalogue is generated from the registry, so a model can only choose a tool that exists and
 *    only with the parameters that tool declares.
 *  - `planFromProvider` parses the answer. Unknown tools, tools from another studio, arguments
 *    outside the declared ranges and a plan with nothing in it are errors, not plans.
 *  - `publicProviderStatus` is the only provider value the browser may see: a label and whether a
 *    model is configured. It never contains a key, and it never contains a URL.
 *
 * Nothing here executes a tool. A provider plans; the executor runs; the registry validates.
 */

import {
  checkPlan,
  findTool,
  validateToolArgs,
  providerToolCatalogue,
  STUDIO_LABELS,
  type AssistantPlan,
  type AssistantStudio,
  type ToolCall,
  type UnsupportedRequest,
} from './registry';
import { err, forgeError, ok, type Result } from '../result';

/** The environment a deployment sets to enable model-assisted planning. */
export const PROVIDER_ENV = {
  url: 'ASSISTANT_PROVIDER_URL',
  key: 'ASSISTANT_PROVIDER_KEY',
  model: 'ASSISTANT_PROVIDER_MODEL',
} as const;

export type ProviderConfig = {
  /** A human label for the provider, safe to show. */
  readonly label: string;
  /** The chat-completions endpoint, without a trailing slash. */
  readonly baseUrl: string;
  readonly model: string;
  /** Server-only. Must never be serialised into a response or a log line. */
  readonly apiKey: string;
};

/** Public facts about provider availability. Never includes a key or a URL. */
export type ProviderStatus = {
  readonly configured: boolean;
  readonly provider: string | null;
  readonly model: string | null;
  /** Why a model is unavailable, in a sentence a person can act on. Null when configured. */
  readonly reason: string | null;
};

export const PROVIDER_LIMITS = {
  /** Longest goal accepted from the request field. */
  maxRequestChars: 2_000,
  /** A runaway model cannot turn one request into an unbounded run. */
  maxSteps: 32,
  maxIntentChars: 400,
  maxUnsupported: 8,
} as const;

function missingList(fields: readonly (readonly [string, string])[]): string {
  return fields
    .filter(([, value]) => value.trim().length === 0)
    .map(([name]) => name)
    .join(', ');
}

/**
 * Reads and validates the server's provider configuration.
 *
 * Absence is not an error condition of the application: it is the default, and the assistant works
 * without it. The returned error therefore says exactly what is missing and never quotes a value.
 */
export function readProviderConfig(
  env: Readonly<Record<string, string | undefined>>,
): Result<ProviderConfig> {
  const url = (env[PROVIDER_ENV.url] ?? '').trim();
  const key = (env[PROVIDER_ENV.key] ?? '').trim();
  const model = (env[PROVIDER_ENV.model] ?? '').trim();

  if (url.length === 0 && key.length === 0 && model.length === 0) {
    return err(
      forgeError('unsupported', 'No external model is configured.', {
        detail: `Set ${PROVIDER_ENV.url}, ${PROVIDER_ENV.key} and ${PROVIDER_ENV.model} on the server to enable model-assisted planning.`,
        retryable: false,
      }),
    );
  }

  const missing = missingList([
    [PROVIDER_ENV.url, url],
    [PROVIDER_ENV.key, key],
    [PROVIDER_ENV.model, model],
  ]);
  if (missing.length > 0) {
    return err(
      forgeError('unsupported', 'The assistant provider is only partly configured.', {
        detail: `Missing: ${missing}.`,
        retryable: false,
      }),
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err(
      forgeError('unsupported', 'The assistant provider URL is not a valid URL.', {
        detail: `Fix ${PROVIDER_ENV.url} on the server.`,
        retryable: false,
      }),
    );
  }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    return err(
      forgeError('unsupported', 'The assistant provider must use HTTPS.', {
        detail: `Plain HTTP is only accepted for a provider on this machine. Fix ${PROVIDER_ENV.url}.`,
        retryable: false,
      }),
    );
  }

  return ok({
    label: 'OpenAI-compatible',
    baseUrl: url.replace(/\/+$/, ''),
    model,
    apiKey: key,
  });
}

/** What the browser is allowed to know about the provider. */
export function publicProviderStatus(
  env: Readonly<Record<string, string | undefined>>,
): ProviderStatus {
  const config = readProviderConfig(env);
  if (!config.ok) {
    return {
      configured: false,
      provider: null,
      model: null,
      reason: config.error.message,
    };
  }
  return {
    configured: true,
    provider: config.value.label,
    model: config.value.model,
    reason: null,
  };
}

/** The smallest useful description of a document, and nothing that could be private content. */
export type ProviderDocumentSummary = {
  readonly title: string;
  readonly documentType: string;
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly selected: number;
};

export type ProviderMessages = {
  readonly system: string;
  readonly user: string;
};

/**
 * Builds the two messages a chat-completions provider receives.
 *
 * The contract is repeated in the system message *and* enforced in `planFromProvider`, because a
 * model that ignores instructions must still be unable to write outside the registry.
 */
export function buildProviderMessages(input: {
  readonly studio: AssistantStudio;
  readonly request: string;
  readonly document: ProviderDocumentSummary;
}): ProviderMessages {
  const tools = providerToolCatalogue();
  const system = [
    'You plan edits for a local-first creative suite. You never write code, never invent tools and',
    'never claim an edit happened: a separate executor runs your plan and checks the result.',
    '',
    'Answer with one JSON object and nothing else, in this shape:',
    '{"intent": string, "steps": [{"tool": string, "args": object}], "unsupported": [{"request": string, "why": string, "alternatives": string[]}]}',
    '',
    `Use only the ${STUDIO_LABELS[input.studio]} tools listed below. A tool from another studio, an`,
    'unknown parameter, a value outside a declared range, or more than',
    `${String(PROVIDER_LIMITS.maxSteps)} steps makes the whole answer unusable.`,
    'If the goal needs something this build cannot do, describe it in "unsupported" with honest',
    'alternatives instead of adding a step that would not work. If no step is possible, return an',
    'empty "steps" array and explain why in "unsupported".',
    `Keep "intent" under ${String(PROVIDER_LIMITS.maxIntentChars)} characters. Tools that act on a`,
    'selection use the selection the editor already has; do not invent a layer id.',
    '',
    `Tools for ${STUDIO_LABELS[input.studio]}:`,
    JSON.stringify(
      tools.filter((tool) => tool.name.startsWith(`${input.studio}.`)),
      null,
      2,
    ),
  ].join('\n');

  const document = input.document;
  const user = [
    `Goal: ${input.request.trim()}`,
    '',
    'Document:',
    `- title: ${document.title}`,
    `- type: ${document.documentType}`,
    `- canvas: ${String(document.width)} × ${String(document.height)}`,
    `- layers: ${String(document.layers)}`,
    `- selected layers: ${String(document.selected)}`,
    '',
    'The goal is the user’s instruction about this document. Return the JSON plan only.',
  ].join('\n');

  return Object.freeze({ system, user });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUnsupported(raw: unknown): Result<readonly UnsupportedRequest[]> {
  if (raw === undefined) return ok([]);
  if (!Array.isArray(raw)) {
    return err(
      forgeError('validation-failed', 'The model’s “unsupported” field is not a list.', {
        retryable: false,
      }),
    );
  }
  if (raw.length > PROVIDER_LIMITS.maxUnsupported) {
    return err(
      forgeError('validation-failed', 'The model listed too many unsupported requests.', {
        detail: `At most ${String(PROVIDER_LIMITS.maxUnsupported)} are accepted.`,
        retryable: false,
      }),
    );
  }
  const out: UnsupportedRequest[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) {
      return err(
        forgeError('validation-failed', `Unsupported entry ${String(index + 1)} is not an object.`),
      );
    }
    const request = entry.request;
    const why = entry.why;
    const alternatives = entry.alternatives;
    if (typeof request !== 'string' || request.trim().length === 0) {
      return err(
        forgeError('validation-failed', `Unsupported entry ${String(index + 1)} has no request.`),
      );
    }
    if (typeof why !== 'string' || why.trim().length === 0) {
      return err(
        forgeError('validation-failed', `Unsupported entry ${String(index + 1)} has no reason.`),
      );
    }
    if (
      !Array.isArray(alternatives) ||
      alternatives.length > 6 ||
      !alternatives.every((value): value is string => typeof value === 'string')
    ) {
      return err(
        forgeError(
          'validation-failed',
          `Unsupported entry ${String(index + 1)} has no usable alternatives.`,
        ),
      );
    }
    out.push({
      request: request.trim().slice(0, 300),
      why: why.trim().slice(0, 400),
      alternatives: alternatives.map((value) => value.trim()).filter((value) => value.length > 0),
    });
  }
  return ok(out);
}

/**
 * Turns a provider's parsed JSON answer into a plan the executor can run.
 *
 * Every step is checked against the registry — tool existence, studio ownership, availability and
 * argument ranges — before a plan object exists. This is deliberately stricter than the executor,
 * which revalidates because a plan may have travelled over a network.
 */
export function planFromProvider(studio: AssistantStudio, raw: unknown): Result<AssistantPlan> {
  if (!isRecord(raw)) {
    return err(
      forgeError('validation-failed', 'The model did not return a plan object.', {
        detail: 'Expected a JSON object with “intent” and “steps”.',
        retryable: true,
      }),
    );
  }
  const intent = typeof raw.intent === 'string' ? raw.intent.trim() : '';
  if (intent.length === 0 || intent.length > PROVIDER_LIMITS.maxIntentChars) {
    return err(
      forgeError('validation-failed', 'The model’s plan has no usable intent.', {
        detail: `“intent” must be 1–${String(PROVIDER_LIMITS.maxIntentChars)} characters.`,
        retryable: true,
      }),
    );
  }
  if (!Array.isArray(raw.steps)) {
    return err(
      forgeError('validation-failed', 'The model’s plan has no step list.', {
        retryable: true,
      }),
    );
  }
  if (raw.steps.length > PROVIDER_LIMITS.maxSteps) {
    return err(
      forgeError('validation-failed', 'The model proposed too many steps.', {
        detail: `At most ${String(PROVIDER_LIMITS.maxSteps)} are accepted.`,
        retryable: false,
      }),
    );
  }

  const steps: ToolCall[] = [];
  for (const [index, entry] of raw.steps.entries()) {
    const position = index + 1;
    if (!isRecord(entry) || typeof entry.tool !== 'string') {
      return err(
        forgeError('validation-failed', `Step ${String(position)} does not name a tool.`, {
          retryable: true,
        }),
      );
    }
    const tool = entry.tool;
    const spec = findTool(tool);
    if (!spec) {
      return err(
        forgeError(
          'validation-failed',
          `Step ${String(position)} names an unknown tool “${tool}”.`,
          {
            detail: 'The answer may only use the tools in the catalogue it was given.',
            retryable: true,
          },
        ),
      );
    }
    if (spec.studio !== studio) {
      return err(
        forgeError(
          'validation-failed',
          `Step ${String(position)} uses “${tool}”, which belongs to another studio.`,
          { retryable: true },
        ),
      );
    }
    if (spec.availability.kind !== 'native') {
      return err(
        forgeError('unsupported', `Step ${String(position)} cannot run: ${spec.label}.`, {
          detail: spec.availability.reason,
          retryable: false,
        }),
      );
    }
    if (!isRecord(entry.args)) {
      return err(
        forgeError('validation-failed', `Step ${String(position)} has no argument object.`, {
          retryable: true,
        }),
      );
    }
    // The registry is the single authority for shapes and ranges. The position is prefixed so a
    // model's mistake can be reported against the step that made it.
    const validated = validateToolArgs(spec, entry.args);
    if (!validated.ok) {
      return err(
        forgeError('validation-failed', `Step ${String(position)}: ${validated.error.message}`, {
          detail: validated.error.detail,
          retryable: true,
        }),
      );
    }
    steps.push({ id: `provider-${String(position)}`, tool, args: validated.value });
  }

  const unsupported = parseUnsupported(raw.unsupported);
  if (!unsupported.ok) return unsupported;

  const plan: AssistantPlan = {
    intent,
    steps: Object.freeze(steps),
    unsupported: unsupported.value,
    source: 'provider',
  };
  const checked = checkPlan(plan);
  if (!checked.ok) return checked;
  if (checked.value.issues.length > 0) {
    const first = checked.value.issues[0];
    return err(
      forgeError('validation-failed', first?.message ?? 'The model’s plan cannot run.', {
        detail: 'Fix the request or choose a tool this build offers.',
        retryable: true,
      }),
    );
  }
  return ok(plan);
}

/**
 * What the planning route returns, checked before the panel trusts it.
 *
 * The route is part of this application, but its answer still crosses a network boundary; treating
 * it as structured data rather than as a trusted object keeps a malformed deployment or a proxy
 * error from reaching the executor as a half-formed plan.
 */
export type ProviderPlanResponse = {
  readonly plan: AssistantPlan;
  readonly provider: {
    readonly label: string;
    readonly model: string;
  };
};

export function readProviderPlanResponse(raw: unknown): Result<ProviderPlanResponse> {
  if (!isRecord(raw) || !isRecord(raw.plan)) {
    return err(forgeError('validation-failed', 'The planning service returned no plan.'));
  }
  const plan = raw.plan;
  if (plan.source !== 'provider' || typeof plan.intent !== 'string' || !Array.isArray(plan.steps)) {
    return err(
      forgeError('validation-failed', 'The planning service returned an unreadable plan.', {
        retryable: true,
      }),
    );
  }
  const steps: ToolCall[] = [];
  for (const entry of plan.steps) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.tool !== 'string' ||
      !isRecord(entry.args)
    ) {
      return err(
        forgeError('validation-failed', 'The planning service returned a malformed step.', {
          retryable: true,
        }),
      );
    }
    const args: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(entry.args)) {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return err(
          forgeError('validation-failed', 'The planning service returned a malformed argument.', {
            retryable: true,
          }),
        );
      }
      args[key] = value;
    }
    steps.push({ id: entry.id, tool: entry.tool, args: Object.freeze(args) });
  }
  const unsupported = parseUnsupported(plan.unsupported);
  if (!unsupported.ok) return unsupported;
  if (!isRecord(raw.provider) || typeof raw.provider.label !== 'string') {
    return err(forgeError('validation-failed', 'The planning service named no provider.'));
  }
  const model = typeof raw.provider.model === 'string' ? raw.provider.model : '';
  return ok({
    plan: {
      intent: plan.intent,
      steps: Object.freeze(steps),
      unsupported: unsupported.value,
      source: 'provider',
    },
    provider: { label: raw.provider.label, model },
  });
}

/** The provider facts the status endpoint publishes, checked the same way. */
export function readProviderStatus(raw: unknown): ProviderStatus | null {
  if (!isRecord(raw) || !isRecord(raw.provider)) return null;
  const provider = raw.provider;
  if (typeof provider.configured !== 'boolean') return null;
  return {
    configured: provider.configured,
    provider: typeof provider.provider === 'string' ? provider.provider : null,
    model: typeof provider.model === 'string' ? provider.model : null,
    reason: typeof provider.reason === 'string' ? provider.reason : null,
  };
}
