/**
 * /api/assistant/plan — model-assisted planning, behind a server boundary.
 *
 * The browser never holds a provider credential and never talks to a model directly. It sends a goal
 * and a tiny document summary here; this handler reads the deployment's own environment, calls the
 * provider and returns a *plan* — a list of tool calls with validated arguments. Executing that plan
 * happens in the browser through the same registry the native planner uses, so a provider cannot do
 * anything a person could not do with the panels.
 *
 * Two invariants are load-bearing:
 *
 *  - the response contains no key and no provider URL, only a plan and a model label;
 *  - a provider answer that names an unknown tool, a tool from another studio, an unavailable tool
 *    or an argument outside its range is rejected here, before the worker ever sees it.
 */

import {
  buildProviderMessages,
  planFromProvider,
  PROVIDER_LIMITS,
  PROVIDER_TIMEOUT_MS,
  publicProviderStatus,
  readProviderConfig,
  type ProviderDocumentSummary,
} from '../../../../core/assistant/provider';
import { ASSISTANT_STUDIOS, type AssistantStudio } from '../../../../core/assistant/registry';
import { readString } from '../../../../server/fields';
import {
  clientKey,
  crossOriginRequest,
  jsonResponse,
  MAX_BODY_BYTES,
  RateLimiter,
  rateLimitedResponse,
  readJsonBody,
} from '../../../../server/http';

export const runtime = 'nodejs';

/**
 * Twenty plans per ten minutes per client.
 *
 * This endpoint spends the operator's provider quota, so it is the one place where a loop costs real
 * money. The limiter is in-process like the auth limiters and is documented as such (`docs/SERVER.md`);
 * it stops a runaway tab or a naive script without pretending to be a distributed defence.
 */
export const assistantLimiter = new RateLimiter(20, 10 * 60_000);

type AssistantFailureKind =
  | 'validation'
  | 'provider-not-configured'
  | 'provider-unavailable'
  | 'provider-invalid-response'
  | 'bad-request';

type AssistantFailure = {
  readonly error: {
    readonly kind: AssistantFailureKind;
    readonly message: string;
    readonly detail?: string;
  };
};

function failure(
  status: number,
  kind: AssistantFailureKind,
  message: string,
  detail?: string,
): Response {
  const body: AssistantFailure = {
    error: detail === undefined ? { kind, message } : { kind, message, detail },
  };
  return jsonResponse(body, { status });
}

export async function GET(): Promise<Response> {
  // Deliberately public and deliberately tiny: whether a model is configured is not a secret, and
  // the browser needs it to explain the panel honestly. Keys and endpoints stay on the server.
  return jsonResponse({ provider: publicProviderStatus(process.env) });
}

function readNumber(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.min(max, Math.round(value));
}

function readSummary(body: Readonly<Record<string, unknown>>): ProviderDocumentSummary {
  const raw = body.document;
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    title: (readString(source, 'title', 120) ?? 'Untitled').trim() || 'Untitled',
    documentType: readString(source, 'documentType', 60) ?? 'unknown',
    width: readNumber(source.width, 100_000) ?? 0,
    height: readNumber(source.height, 100_000) ?? 0,
    layers: readNumber(source.layers, 10_000) ?? 0,
    selected: readNumber(source.selected, 10_000) ?? 0,
  };
}

function isStudio(value: string): value is AssistantStudio {
  return (ASSISTANT_STUDIOS as readonly string[]).includes(value);
}

/**
 * Pulls the model's text out of a chat-completions response.
 *
 * Some providers wrap JSON in a markdown fence even when asked for JSON, so the fence is stripped
 * before parsing. Anything else is treated as an invalid answer rather than guessed at.
 */
function messageText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices: unknown = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  const content = (first as { message?: { content?: unknown } }).message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) return null;
  return content.trim();
}

function unfence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return fenced?.[1] ?? text;
}

export async function POST(request: Request): Promise<Response> {
  if (crossOriginRequest(request)) {
    return failure(403, 'bad-request', 'Cross-origin requests are refused.');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    return failure(413, 'bad-request', 'That request is larger than this API accepts.');
  }
  const limit = assistantLimiter.check(clientKey(request));
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterMs);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== 'object' || body.value === null) {
    return failure(422, 'validation', 'Send a goal for the assistant to plan.');
  }
  const fields = body.value as Record<string, unknown>;
  const studio = readString(fields, 'studio', 40) ?? '';
  if (!isStudio(studio)) {
    return failure(422, 'validation', 'Name a studio the assistant supports.');
  }
  const goal = (readString(fields, 'request', PROVIDER_LIMITS.maxRequestChars) ?? '').trim();
  if (goal.length === 0) {
    return failure(422, 'validation', 'The request is empty.');
  }

  const config = readProviderConfig(process.env);
  if (!config.ok) {
    return failure(503, 'provider-not-configured', config.error.message, config.error.detail);
  }

  const messages = buildProviderMessages({
    studio,
    request: goal,
    document: readSummary(fields),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, PROVIDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(config.value.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.value.apiKey}`,
      },
      body: JSON.stringify({
        model: config.value.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
      }),
      signal: controller.signal,
    });
  } catch {
    return failure(
      502,
      'provider-unavailable',
      'The assistant’s model could not be reached.',
      'Check the provider endpoint and the server’s network access, then try again.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The provider's body can echo the prompt, so it is not forwarded. The status is enough for an
    // operator to diagnose; the user gets a sentence that does not leak their document.
    return failure(
      502,
      'provider-unavailable',
      'The assistant’s model refused the request.',
      `The provider answered with HTTP ${String(response.status)}.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failure(
      502,
      'provider-invalid-response',
      'The assistant’s model returned something that is not JSON.',
    );
  }
  const text = messageText(payload);
  if (text === null) {
    return failure(
      502,
      'provider-invalid-response',
      'The assistant’s model returned no plan text.',
    );
  }
  let answer: unknown;
  try {
    answer = JSON.parse(unfence(text));
  } catch {
    return failure(
      502,
      'provider-invalid-response',
      'The assistant’s model returned text that is not a plan.',
    );
  }

  const plan = planFromProvider(studio, answer);
  if (!plan.ok) {
    return failure(
      502,
      'provider-invalid-response',
      'The assistant’s model proposed a plan this build cannot run.',
      plan.error.message,
    );
  }

  return jsonResponse({
    plan: plan.value,
    provider: { label: config.value.label, model: config.value.model },
  });
}
