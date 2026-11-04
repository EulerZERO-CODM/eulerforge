import { describe, expect, it } from 'vitest';

import {
  buildProviderMessages,
  planFromProvider,
  PROVIDER_ENV,
  PROVIDER_LIMITS,
  publicProviderStatus,
  readProviderConfig,
  readProviderPlanResponse,
  readProviderStatus,
} from './provider';
import { checkPlan } from './registry';

const CONFIGURED = {
  [PROVIDER_ENV.url]: 'https://models.example.test/v1/chat/completions',
  [PROVIDER_ENV.key]: 'sk-server-only-secret',
  [PROVIDER_ENV.model]: 'studio-planner-1',
} as const;

const DOCUMENT = {
  title: 'Harbour at dusk',
  documentType: 'photo.image',
  width: 1600,
  height: 900,
  layers: 3,
  selected: 1,
} as const;

describe('the provider boundary', () => {
  it('reports absence without naming a value', () => {
    const result = readProviderConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/no external model/i);
    expect(result.error.detail).toContain(PROVIDER_ENV.key);
    expect(result.error.detail).not.toMatch(/sk-/);
  });

  it('names only the variables that are missing', () => {
    const result = readProviderConfig({
      [PROVIDER_ENV.url]: 'https://models.example.test/v1/chat/completions',
      [PROVIDER_ENV.model]: 'studio-planner-1',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toContain(PROVIDER_ENV.key);
    expect(result.error.detail).not.toContain(PROVIDER_ENV.url);
    expect(result.error.detail).not.toContain(PROVIDER_ENV.model);
  });

  it('accepts an HTTPS endpoint and trims a trailing slash', () => {
    const result = readProviderConfig({
      ...CONFIGURED,
      [PROVIDER_ENV.url]: 'https://models.example.test/v1/chat/completions///',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.baseUrl).toBe('https://models.example.test/v1/chat/completions');
    expect(result.value.model).toBe('studio-planner-1');
  });

  it('refuses plain HTTP to a remote host, and allows it on this machine', () => {
    const remote = readProviderConfig({
      ...CONFIGURED,
      [PROVIDER_ENV.url]: 'http://models.example.test/v1/chat',
    });
    expect(remote.ok).toBe(false);
    if (!remote.ok) expect(remote.error.message).toMatch(/HTTPS/i);

    const local = readProviderConfig({
      ...CONFIGURED,
      [PROVIDER_ENV.url]: 'http://localhost:8080/v1/chat',
    });
    expect(local.ok).toBe(true);
  });

  it('refuses a URL that is not a URL', () => {
    const result = readProviderConfig({ ...CONFIGURED, [PROVIDER_ENV.url]: 'models.example.test' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/not a valid URL/i);
  });

  it('publishes availability without publishing the key or the endpoint', () => {
    const status = publicProviderStatus(CONFIGURED);
    expect(status).toEqual({
      configured: true,
      provider: 'OpenAI-compatible',
      model: 'studio-planner-1',
      reason: null,
    });
    expect(JSON.stringify(status)).not.toContain('sk-server-only-secret');
    expect(JSON.stringify(status)).not.toContain('models.example.test');
  });

  it('publishes the reason a model is unavailable', () => {
    const status = publicProviderStatus({});
    expect(status.configured).toBe(false);
    expect(status.reason).toMatch(/no external model/i);
    expect(JSON.stringify(status)).not.toContain(PROVIDER_ENV.key);
  });
});

describe('the provider prompt', () => {
  it('offers only the studio’s own tools and repeats the no-code contract', () => {
    const messages = buildProviderMessages({
      studio: 'photo',
      request: 'make it cinematic and export a png',
      document: DOCUMENT,
    });
    expect(messages.system).toContain('photo.adjust');
    expect(messages.system).toContain('photo.export');
    expect(messages.system).not.toContain('design.add_text');
    expect(messages.system).not.toContain('illustration.set_fill');
    expect(messages.system).toMatch(/never write code/i);
    expect(messages.system).toContain(`"intent"`);
    expect(messages.user).toContain('make it cinematic and export a png');
    expect(messages.user).toContain('Harbour at dusk');
    expect(messages.user).toContain('1600 × 900');
  });

  it('does not smuggle a credential into the prompt', () => {
    const messages = buildProviderMessages({
      studio: 'design',
      request: 'add a title',
      document: { ...DOCUMENT, title: 'Poster', documentType: 'design.canvas' },
    });
    expect(JSON.stringify(messages)).not.toContain('sk-');
  });
});

describe('planFromProvider', () => {
  it('turns a valid answer into the same plan shape the native planner produces', () => {
    const result = planFromProvider('photo', {
      intent: 'Lift the shadows and export a PNG.',
      steps: [
        { tool: 'photo.adjust', args: { adjustment: 'shadows', value: 20 } },
        { tool: 'photo.export', args: { format: 'png' } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('provider');
    expect(result.value.steps.map((step) => step.tool)).toEqual(['photo.adjust', 'photo.export']);
    expect(result.value.steps[0]?.id).toBe('provider-1');
    expect(checkPlan(result.value)).toMatchObject({ ok: true, value: { issues: [] } });
  });

  it('rejects an unknown tool with the step number', () => {
    const result = planFromProvider('photo', {
      intent: 'Do something.',
      steps: [{ tool: 'photo.magic', args: {} }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/step 1 names an unknown tool/i);
  });

  it('rejects a tool from another studio', () => {
    const result = planFromProvider('photo', {
      intent: 'Add text.',
      steps: [{ tool: 'design.add_text', args: { content: 'Hello', x: 0, y: 0 } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/belongs to another studio/i);
  });

  it('rejects a tool this build marks unavailable, and says why', () => {
    const result = planFromProvider('motion', {
      intent: 'Animate the title.',
      steps: [{ tool: 'motion.add_keyframe', args: { property: 'opacity', at: 0, value: 0 } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/cannot run/i);
      expect(result.error.detail?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('rejects an argument outside its declared range', () => {
    const result = planFromProvider('photo', {
      intent: 'Darken it.',
      steps: [{ tool: 'photo.adjust', args: { adjustment: 'exposure', value: 400 } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/step 1/i);
  });

  it('rejects an unknown argument instead of dropping it silently', () => {
    const result = planFromProvider('photo', {
      intent: 'Darken it.',
      steps: [{ tool: 'photo.adjust', args: { adjustment: 'exposure', value: 10, layer: 'x' } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/layer/i);
  });

  it('rejects a plan with nothing in it, exactly as the executor would', () => {
    const result = planFromProvider('photo', { intent: 'Make it nicer.', steps: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/nothing in it/i);
  });

  it('keeps an honest refusal, with alternatives, alongside runnable steps', () => {
    const result = planFromProvider('photo', {
      intent: 'Darken the sky and cut out the subject.',
      steps: [{ tool: 'photo.adjust', args: { adjustment: 'shadows', value: 20 } }],
      unsupported: [
        {
          request: 'remove the background',
          why: 'No segmentation model is configured.',
          alternatives: ['select a colour range', 'select a luminance range'],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unsupported).toHaveLength(1);
    expect(result.value.unsupported[0]?.alternatives).toHaveLength(2);
  });

  it('caps the answer so a runaway model cannot build an unbounded run', () => {
    const steps = Array.from({ length: PROVIDER_LIMITS.maxSteps + 1 }, () => ({
      tool: 'photo.adjust',
      args: { adjustment: 'contrast', value: 1 },
    }));
    const result = planFromProvider('photo', { intent: 'A lot.', steps });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/too many steps/i);
  });

  it('rejects a malformed answer with an actionable sentence', () => {
    for (const answer of [null, 'plan', 42, { intent: '', steps: [] }, { intent: 'x' }]) {
      const result = planFromProvider('photo', answer);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects an unsupported entry without alternatives', () => {
    const result = planFromProvider('photo', {
      intent: 'Cut it out.',
      steps: [],
      unsupported: [{ request: 'remove the background', why: 'Unavailable.' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/alternatives/i);
  });
});

describe('reading the planning service’s answer', () => {
  it('accepts a well-formed response and freezes its steps', () => {
    const result = readProviderPlanResponse({
      plan: {
        intent: 'Lift the shadows.',
        steps: [
          { id: 'provider-1', tool: 'photo.adjust', args: { adjustment: 'shadows', value: 12 } },
        ],
        unsupported: [],
        source: 'provider',
      },
      provider: { label: 'OpenAI-compatible', model: 'studio-planner-1' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.source).toBe('provider');
    expect(result.value.plan.steps[0]?.args).toEqual({ adjustment: 'shadows', value: 12 });
    expect(result.value.provider.model).toBe('studio-planner-1');
  });

  it('rejects a response with no plan, a native source or a non-primitive argument', () => {
    expect(readProviderPlanResponse(null).ok).toBe(false);
    expect(readProviderPlanResponse({ provider: { label: 'x' } }).ok).toBe(false);
    expect(
      readProviderPlanResponse({
        plan: { intent: 'x', steps: [], unsupported: [], source: 'native' },
        provider: { label: 'x', model: 'y' },
      }).ok,
    ).toBe(false);
    expect(
      readProviderPlanResponse({
        plan: {
          intent: 'x',
          steps: [{ id: 'a', tool: 'photo.adjust', args: { adjustment: { nested: true } } }],
          unsupported: [],
          source: 'provider',
        },
        provider: { label: 'x', model: 'y' },
      }).ok,
    ).toBe(false);
  });

  it('reads the public status shape without inventing fields', () => {
    expect(readProviderStatus({ provider: { configured: false, reason: 'None.' } })).toEqual({
      configured: false,
      provider: null,
      model: null,
      reason: 'None.',
    });
    expect(readProviderStatus({ provider: {} })).toBeNull();
    expect(readProviderStatus('nope')).toBeNull();
  });
});
