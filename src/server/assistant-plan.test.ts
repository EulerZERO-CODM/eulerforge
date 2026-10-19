import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '../app/api/assistant/plan/route';
import { PROVIDER_ENV } from '../core/assistant/provider';

/**
 * The model-assisted planning route, exercised as a handler.
 *
 * The provider itself is stubbed: a live model is not part of a unit test, and the contract that
 * matters is the boundary — what is sent out, what is accepted back, and what must never appear in
 * a response.
 */

const KEY = 'sk-test-server-only';
const URL_UNDER_TEST = 'https://models.example.test/v1/chat/completions';

function configure(): void {
  vi.stubEnv(PROVIDER_ENV.url, URL_UNDER_TEST);
  vi.stubEnv(PROVIDER_ENV.key, KEY);
  vi.stubEnv(PROVIDER_ENV.model, 'studio-planner-1');
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    studio: 'photo',
    request: 'lift the shadows and export a png',
    document: {
      title: 'Harbour at dusk',
      documentType: 'photo.image',
      width: 1600,
      height: 900,
      layers: 2,
      selected: 1,
    },
    ...overrides,
  };
}

function post(payload: Record<string, unknown> = body(), origin?: string): Promise<Response> {
  return POST(
    new Request('http://localhost/api/assistant/plan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(payload),
    }),
  );
}

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/assistant/plan', () => {
  it('publishes availability without a key or an endpoint', async () => {
    configure();
    const response = await GET();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('studio-planner-1');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('models.example.test');
  });

  it('says that no model is configured by default', async () => {
    const response = await GET();
    const payload = (await response.json()) as {
      provider: { configured: boolean; reason: string };
    };
    expect(payload.provider.configured).toBe(false);
    expect(payload.provider.reason).toMatch(/no external model/i);
  });
});

describe('POST /api/assistant/plan', () => {
  it('refuses a request when the deployment has no provider', async () => {
    const response = await post();
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { error: { kind: string; detail?: string } };
    expect(payload.error.kind).toBe('provider-not-configured');
    expect(payload.error.detail).toContain(PROVIDER_ENV.key);
  });

  it('refuses a cross-origin caller', async () => {
    configure();
    const response = await post(body(), 'https://elsewhere.example.test');
    expect(response.status).toBe(403);
  });

  it('refuses an empty goal and an unknown studio', async () => {
    configure();
    expect((await post(body({ request: '   ' }))).status).toBe(422);
    expect((await post(body({ studio: 'audio' }))).status).toBe(422);
  });

  it('sends the provider its own key and returns only a validated plan', async () => {
    configure();
    const plan = {
      intent: 'Lift the shadows, then export a PNG.',
      steps: [
        { tool: 'photo.adjust', args: { adjustment: 'shadows', value: 20 } },
        { tool: 'photo.export', args: { format: 'png' } },
      ],
    };
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => {
      return chatResponse(JSON.stringify(plan));
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await post();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('models.example.test');
    const parsed = JSON.parse(text) as {
      plan: { source: string; steps: { tool: string }[] };
      provider: { label: string; model: string };
    };
    expect(parsed.plan.source).toBe('provider');
    expect(parsed.plan.steps.map((step) => step.tool)).toEqual(['photo.adjust', 'photo.export']);
    expect(parsed.provider.model).toBe('studio-planner-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(URL_UNDER_TEST);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    const sent = JSON.parse(rawBody) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(sent.model).toBe('studio-planner-1');
    expect(sent.messages[0]?.content).toContain('photo.adjust');
    expect(sent.messages[1]?.content).toContain('lift the shadows');
  });

  it('accepts a plan wrapped in a markdown fence, because providers do that', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        chatResponse(
          '```json\n{"intent":"Export it.","steps":[{"tool":"photo.export","args":{"format":"jpeg"}}]}\n```',
        ),
      ),
    );
    const response = await post();
    expect(response.status).toBe(200);
  });

  it('rejects text that is not a plan', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => chatResponse('Sure! I made it cinematic.')),
    );
    const response = await post();
    expect(response.status).toBe(502);
    const payload = (await response.json()) as { error: { kind: string } };
    expect(payload.error.kind).toBe('provider-invalid-response');
  });

  it('rejects a plan that names an unavailable tool instead of running what it can', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        chatResponse(
          JSON.stringify({
            intent: 'Animate the title.',
            steps: [
              { tool: 'motion.add_keyframe', args: { property: 'opacity', at: 0, value: 0 } },
            ],
          }),
        ),
      ),
    );
    const response = await post(body({ studio: 'motion' }));
    expect(response.status).toBe(502);
    const payload = (await response.json()) as { error: { kind: string; detail?: string } };
    expect(payload.error.kind).toBe('provider-invalid-response');
    expect(payload.error.detail).toMatch(/step 1/i);
  });

  it('reports a provider failure without forwarding its body', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('quota exceeded for sk-test-server-only', {
            status: 429,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    );
    const response = await post();
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain(KEY);
    const payload = JSON.parse(text) as { error: { kind: string; detail?: string } };
    expect(payload.error.kind).toBe('provider-unavailable');
    expect(payload.error.detail).toContain('429');
  });

  it('reports an unreachable provider as a sentence, not an exception', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND models.example.test');
      }),
    );
    const response = await post();
    expect(response.status).toBe(502);
    const payload = (await response.json()) as { error: { kind: string; message: string } };
    expect(payload.error.kind).toBe('provider-unavailable');
    expect(payload.error.message).toMatch(/could not be reached/i);
  });
});
