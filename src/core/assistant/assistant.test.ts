/**
 * The assistant's core: registry, planner, tools and executor.
 *
 * These tests are deliberately written against documents and commands rather than against text. A
 * passing assistant is one whose tool calls changed the document, whose verification read the change
 * back, and whose refusals name what it cannot do — not one whose prose sounds confident.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CANVAS, createDocument } from '../documents/factories';
import { createLayer } from '../documents/layer-operations';
import type { Layer } from '../documents/layer-types';
import type { ForgeDocument } from '../documents/types';
import type { SceneCommand } from '../editor/commands';
import { brand } from '../types/brand';
import { ok } from '../result';
import {
  ASSISTANT_TOOLS,
  capabilitySummary,
  checkPlan,
  findTool,
  isNative,
  toolsForStudio,
  validateToolArgs,
  type AssistantPlan,
  type ToolCall,
} from './registry';
import { planNatively, splitClauses } from './planner';
import { TOOL_RUNNERS, nativeToolIdsWithoutRunner } from './tools';
import { executePlan, type AssistantEnvironment, type RunReport } from './executor';

function photoDocument(): ForgeDocument {
  const created = createDocument(
    {
      title: 'Assistant fixture photo',
      studioId: 'photo',
      documentTypeId: brand<'DocumentTypeId'>('photo.image'),
      canvas: { ...DEFAULT_CANVAS, width: 320, height: 240 },
    },
    { generateId: () => 'doc-assistant-photo' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function vectorDocument(layers: readonly Layer[] = []): ForgeDocument {
  const created = createDocument(
    {
      title: 'Assistant fixture artboard',
      studioId: 'illustration',
      documentTypeId: brand<'DocumentTypeId'>('illustration.artboard'),
      canvas: { ...DEFAULT_CANVAS, width: 200, height: 200 },
      scene: { layers: [...layers] },
    },
    { generateId: () => 'doc-assistant-vector' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function designDocument(): ForgeDocument {
  const created = createDocument(
    {
      title: 'Assistant fixture canvas',
      studioId: 'design',
      documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
      canvas: { ...DEFAULT_CANVAS, width: 400, height: 300 },
    },
    { generateId: () => 'doc-assistant-design' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function pathLayer(name: string, id: string): Layer {
  const created = createLayer(
    {
      type: 'path',
      frame: { x: 0, y: 0, width: 10, height: 10 },
      vector: {
        path: {
          contours: [
            {
              closed: true,
              nodes: [
                { point: { x: 0, y: 0 }, handleIn: null, handleOut: null },
                { point: { x: 10, y: 0 }, handleIn: null, handleOut: null },
                { point: { x: 10, y: 10 }, handleIn: null, handleOut: null },
              ],
            },
          ],
        },
        style: { fill: '#000000' },
      },
    },
    { id: brand<'LayerId'>(id), name },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function applyCommands(document: ForgeDocument, commands: readonly SceneCommand[]): ForgeDocument {
  let next = document;
  for (const command of commands) {
    next = { ...next, ...command.patch } as ForgeDocument;
  }
  return next;
}

/** A host that applies commands to an in-memory document, like the session does. */
function host(
  document: ForgeDocument,
  options: {
    readonly selection?: readonly string[];
    readonly studio?: AssistantEnvironment['studio'];
    readonly download?: AssistantEnvironment['download'];
    /** When true the commit "succeeds" without applying anything, to test verification. */
    readonly dropCommands?: boolean;
  } = {},
): AssistantEnvironment & { currentDocument: () => ForgeDocument } {
  let current = document;
  return {
    studio: options.studio ?? (document.studioId as AssistantEnvironment['studio']),
    current: () => current,
    currentDocument: () => current,
    selection: () => options.selection ?? [],
    commit: async (command) => {
      if (!options.dropCommands) current = applyCommands(current, [command]);
      return true;
    },
    download: options.download ?? (async (kind) => ok({ fileName: `export.${kind}`, bytes: 1024 })),
  };
}

const plan = (
  steps: readonly ToolCall[],
  unsupported: AssistantPlan['unsupported'] = [],
): AssistantPlan => ({
  intent: 'test plan',
  steps,
  unsupported,
  source: 'native',
});

describe('the tool registry', () => {
  it('has an implementation for every native tool, and none for the rest', () => {
    expect(nativeToolIdsWithoutRunner()).toEqual([]);
    for (const tool of ASSISTANT_TOOLS) {
      const runner = TOOL_RUNNERS[tool.id];
      if (tool.availability.kind === 'native') expect(runner).toBeTypeOf('function');
      else expect(runner).toBeUndefined();
    }
  });

  it('declares tools for all five studios, and says which ones cannot run yet', () => {
    for (const studio of ['design', 'photo', 'illustration', 'motion', 'video'] as const) {
      const tools = toolsForStudio(studio);
      expect(tools.length).toBeGreaterThan(0);
    }
    const unavailable = ASSISTANT_TOOLS.filter((tool) => !isNative(tool));
    expect(unavailable.map((tool) => tool.id)).toEqual(['motion.add_keyframe', 'video.trim']);
    for (const tool of unavailable) {
      if (tool.availability.kind === 'unavailable') {
        expect(tool.availability.reason.length).toBeGreaterThan(10);
      }
    }
    const summary = capabilitySummary();
    expect(summary).toContain('Photo Studio: photo.adjust');
    expect(summary).toContain('motion.add_keyframe (unavailable)');
  });

  it('rejects arguments a model might plausibly invent', () => {
    const adjust = findTool('photo.adjust');
    if (!adjust) throw new Error('fixture');
    expect(validateToolArgs(adjust, { adjustment: 'contrast', value: 20 }).ok).toBe(true);
    expect(validateToolArgs(adjust, { adjustment: 'contrast', value: '20' }).ok).toBe(false);
    expect(validateToolArgs(adjust, { adjustment: 'contrast', value: 20, amount: 3 }).ok).toBe(
      false,
    );
    expect(validateToolArgs(adjust, { adjustment: 'sharpen', value: 20 }).ok).toBe(false);
    expect(validateToolArgs(adjust, { adjustment: 'contrast', value: 200 }).ok).toBe(false);
    expect(validateToolArgs(adjust, { value: 20 }).ok).toBe(false);
  });

  it('refuses a whole plan that names an unknown or unavailable tool', () => {
    const unknown = checkPlan(plan([{ id: 's1', tool: 'photo.sharpen', args: {} }]));
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.value.issues[0]?.message).toContain('Unknown tool');

    const unavailable = checkPlan(
      plan([{ id: 's1', tool: 'video.trim', args: { start: 1, end: 2 } }]),
    );
    expect(unavailable.ok).toBe(true);
    if (unavailable.ok) expect(unavailable.value.issues[0]?.message).toContain('not available');
  });
});

describe('the native planner', () => {
  it('turns “make this cinematic” into five real photo adjustments', () => {
    const result = planNatively('photo', 'make this look cinematic');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.steps.map((step) => step.tool)).toEqual([
      'photo.adjust',
      'photo.adjust',
      'photo.adjust',
      'photo.adjust',
      'photo.adjust',
    ]);
    expect(result.value.steps.map((step) => step.args.adjustment)).toEqual([
      'contrast',
      'saturation',
      'temperature',
      'shadows',
      'vignette',
    ]);
    expect(result.value.source).toBe('native');
    expect(result.value.unsupported).toEqual([]);
  });

  it('understands a compound sentence, including quoted text with “and” inside it', () => {
    const clauses = splitClauses('make it warmer and put the text "sunset and sea" on the path');
    expect(clauses).toEqual(['make it warmer', 'put the text "sunset and sea" on the path']);

    const result = planNatively(
      'illustration',
      'fill the path #22cc88 and put the text "sunset and sea" on the path',
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.steps).toEqual([
      expect.objectContaining({ tool: 'illustration.set_fill', args: { colour: '#22cc88' } }),
      expect.objectContaining({
        tool: 'illustration.text_on_path',
        args: { content: 'sunset and sea' },
      }),
    ]);
  });

  it('names what it cannot do instead of inventing a step', () => {
    const result = planNatively('photo', 'remove the background and make it cinematic');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.unsupported).toHaveLength(1);
    expect(result.value.unsupported[0]?.request).toMatch(/background/i);
    expect(result.value.unsupported[0]?.why).toMatch(/segmentation model/i);
    expect(result.value.unsupported[0]?.alternatives.length).toBeGreaterThan(0);
    expect(result.value.steps).toHaveLength(5);
  });

  it('does not drop a clause it could not act on just because another clause was understood', () => {
    const result = planNatively('design', 'remove the background and add a rectangle 100x50');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.steps.map((step) => step.tool)).toEqual(['design.add_rectangle']);
    expect(result.value.unsupported).toHaveLength(1);
    expect(result.value.unsupported[0]?.request).toMatch(/remove the background/i);
    expect(result.value.unsupported[0]?.why).toMatch(/no vocabulary/i);
    expect(result.value.unsupported[0]?.alternatives.length).toBeGreaterThan(0);
  });

  it('asks for the encoder the sentence names', () => {
    const result = planNatively('photo', 'export a jpeg');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.steps).toEqual([
      expect.objectContaining({ tool: 'photo.export', args: { format: 'jpeg' } }),
    ]);
  });

  it('refuses a request outside its vocabulary, and a studio it cannot drive', () => {
    const vague = planNatively('design', 'make it pop');
    if (!vague.ok) throw new Error(vague.error.message);
    expect(vague.value.steps).toEqual([]);
    expect(vague.value.unsupported[0]?.alternatives.length).toBeGreaterThan(0);

    const motion = planNatively('motion', 'animate this title');
    if (!motion.ok) throw new Error(motion.error.message);
    expect(motion.value.steps).toEqual([]);
    expect(motion.value.unsupported[0]?.why).toMatch(/not connected/i);
  });

  it('parses a rectangle size and a quoted headline for the design canvas', () => {
    const result = planNatively(
      'design',
      'add a 320x180 rectangle and add a headline that says Spring sale',
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.steps).toEqual([
      expect.objectContaining({
        tool: 'design.add_rectangle',
        args: { width: 320, height: 180 },
      }),
      expect.objectContaining({
        tool: 'design.add_text',
        args: { content: 'Spring sale' },
      }),
    ]);
  });
});

describe('the native tools change the document they are given', () => {
  it('sets a photo adjustment to the exact planned value', () => {
    const document = photoDocument();
    const runner = TOOL_RUNNERS['photo.adjust'];
    if (!runner) throw new Error('fixture');
    const outcome = runner(
      { document, selection: [] },
      { adjustment: 'contrast', value: 18, mode: 'add' },
    );
    if (!outcome.ok) throw new Error(outcome.error.message);
    const after = applyCommands(document, outcome.value.commands);
    const payload = after.studioPayload;
    if (payload?.kind !== 'photo') throw new Error('expected a photo payload');
    expect(payload.adjustments).toHaveLength(1);
    expect(payload.adjustments[0]).toMatchObject({ kind: 'contrast', value: 18 });
    expect(outcome.value.verify(after)).toContain('Contrast is 18');
  });

  it('adds to an existing adjustment rather than duplicating it', () => {
    const document = photoDocument();
    const runner = TOOL_RUNNERS['photo.adjust'];
    if (!runner) throw new Error('fixture');
    const first = runner(
      { document, selection: [] },
      { adjustment: 'exposure', value: 20, mode: 'set' },
    );
    if (!first.ok) throw new Error(first.error.message);
    const afterFirst = applyCommands(document, first.value.commands);
    const second = runner(
      { document: afterFirst, selection: [] },
      { adjustment: 'exposure', value: 15, mode: 'add' },
    );
    if (!second.ok) throw new Error(second.error.message);
    const afterSecond = applyCommands(afterFirst, second.value.commands);
    const payload = afterSecond.studioPayload;
    if (payload?.kind !== 'photo') throw new Error('expected a photo payload');
    expect(payload.adjustments).toHaveLength(1);
    expect(payload.adjustments[0]?.value).toBe(35);
  });

  it('refuses to select a range before a photograph exists', () => {
    const document = photoDocument();
    const runner = TOOL_RUNNERS['photo.range_select'];
    if (!runner) throw new Error('fixture');
    const outcome = runner({ document, selection: [] }, { kind: 'luminance', min: 0, max: 0.3 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toMatch(/import a photograph/i);
  });

  it('fills and strokes the selected paths, and refuses when nothing is selected', () => {
    const path = pathLayer('Card', 'lyr-card');
    const document = vectorDocument([path]);
    const fill = TOOL_RUNNERS['illustration.set_fill'];
    if (!fill) throw new Error('fixture');

    const noSelection = fill({ document, selection: [] }, { colour: '#22cc88' });
    expect(noSelection.ok).toBe(false);

    const outcome = fill({ document, selection: [String(path.id)] }, { colour: '#22cc88' });
    if (!outcome.ok) throw new Error(outcome.error.message);
    const after = applyCommands(document, outcome.value.commands);
    const layer = after.scene.layers[0];
    if (layer?.type !== 'path') throw new Error('expected a path');
    expect(layer.vector.style.fill).toBe('#22cc88');
    expect(outcome.value.verify(after)).toContain('#22cc88');
  });

  it('lays text on exactly one selected path', () => {
    const a = pathLayer('A', 'lyr-a');
    const b = pathLayer('B', 'lyr-b');
    const document = vectorDocument([a, b]);
    const runner = TOOL_RUNNERS['illustration.text_on_path'];
    if (!runner) throw new Error('fixture');

    expect(
      runner({ document, selection: [String(a.id), String(b.id)] }, { content: 'Hi' }).ok,
    ).toBe(false);

    const outcome = runner(
      { document, selection: [String(a.id)] },
      { content: 'Hi', fontSize: 40 },
    );
    if (!outcome.ok) throw new Error(outcome.error.message);
    const after = applyCommands(document, outcome.value.commands);
    const layer = after.scene.layers[0];
    if (layer?.type !== 'path') throw new Error('expected a path');
    expect(layer.vector.text?.content).toBe('Hi');
    expect(layer.vector.text?.fontSize).toBe(40);
    expect(outcome.value.verify(after)).toContain('“Hi”');
  });

  it('adds design layers whose verification reads them back', () => {
    const document = designDocument();
    const text = TOOL_RUNNERS['design.add_text'];
    const rect = TOOL_RUNNERS['design.add_rectangle'];
    if (!text || !rect) throw new Error('fixture');

    const textOutcome = text({ document, selection: [] }, { content: 'Spring sale' });
    if (!textOutcome.ok) throw new Error(textOutcome.error.message);
    const afterText = applyCommands(document, textOutcome.value.commands);
    expect(afterText.scene.layers).toHaveLength(1);
    expect(textOutcome.value.verify(afterText)).toContain('Spring sale');

    const rectOutcome = rect({ document, selection: [] }, { width: 320, height: 180 });
    if (!rectOutcome.ok) throw new Error(rectOutcome.error.message);
    const afterRect = applyCommands(document, rectOutcome.value.commands);
    expect(afterRect.scene.layers[0]).toMatchObject({ type: 'rect' });
  });
});

describe('the executor', () => {
  it('runs a multi-step plan through the document and inspects every result', async () => {
    const document = photoDocument();
    const environment = host(document);
    const compiled = planNatively('photo', 'make this cinematic and export a png');
    if (!compiled.ok) throw new Error(compiled.error.message);
    const result = await executePlan(compiled.value, environment);

    expect(result.status).toBe('completed');
    expect(result.steps.every((step) => step.status === 'succeeded')).toBe(true);
    expect(result.changed).toBe(5);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.bytes).toBe(1024);
    const payload = environment.currentDocument().studioPayload;
    if (payload?.kind !== 'photo') throw new Error('expected a photo payload');
    expect(payload.adjustments.map((adjustment) => adjustment.kind)).toEqual([
      'contrast',
      'saturation',
      'temperature',
      'shadows',
      'vignette',
    ]);
    // Every successful step carries the sentence the tool read back from the document.
    for (const step of result.steps) expect(step.inspection?.length ?? 0).toBeGreaterThan(0);
  });

  it('stops at the first failure and marks the rest skipped', async () => {
    const document = vectorDocument([]);
    const environment = host(document, { studio: 'illustration' });
    const result = await executePlan(
      plan([
        { id: 's1', tool: 'illustration.text_on_path', args: { content: 'No path' } },
        { id: 's2', tool: 'illustration.export_svg', args: {} },
      ]),
      environment,
    );
    expect(result.status).toBe('failed');
    expect(result.steps[0]?.status).toBe('failed');
    expect(result.steps[1]?.status).toBe('skipped');
    expect(result.summary).toMatch(/stopped at step 1/i);
  });

  it('notices when a commit claims success but the document did not change', async () => {
    const document = photoDocument();
    const environment = host(document, { dropCommands: true });
    const result = await executePlan(
      plan([{ id: 's1', tool: 'photo.adjust', args: { adjustment: 'exposure', value: 20 } }]),
      environment,
    );
    expect(result.status).toBe('failed');
    expect(result.steps[0]?.error).toMatch(/missing from the stack|reads 0/i);
  });

  it('cancels between steps and keeps what already ran', async () => {
    const document = photoDocument();
    const environment = host(document);
    let completed = 0;
    const result = await executePlan(
      plan([
        { id: 's1', tool: 'photo.adjust', args: { adjustment: 'contrast', value: 10 } },
        { id: 's2', tool: 'photo.adjust', args: { adjustment: 'saturation', value: 10 } },
      ]),
      environment,
      {
        shouldCancel: () => completed >= 1,
        onStep: (step) => {
          if (step.status === 'succeeded') completed += 1;
        },
      },
    );
    expect(result.status).toBe('cancelled');
    expect(result.steps[0]?.status).toBe('succeeded');
    expect(result.steps[1]?.status).toBe('cancelled');
    const payload = environment.currentDocument().studioPayload;
    if (payload?.kind !== 'photo') throw new Error('expected a photo payload');
    expect(payload.adjustments).toHaveLength(1);
  });

  it('pauses before the first step when asked', async () => {
    const document = photoDocument();
    const result = await executePlan(
      plan([{ id: 's1', tool: 'photo.adjust', args: { adjustment: 'exposure', value: 5 } }]),
      host(document),
      { shouldPause: () => true },
    );
    expect(result.status).toBe('paused');
    expect(result.changed).toBe(0);
  });

  it('fails a step whose file came back empty', async () => {
    const document = photoDocument();
    const environment = host(document, {
      download: async () => ok({ fileName: 'empty.png', bytes: 0 }),
    });
    const result = await executePlan(
      plan([{ id: 's1', tool: 'photo.export', args: { format: 'png' } }]),
      environment,
    );
    expect(result.status).toBe('failed');
    expect(result.steps[0]?.error).toMatch(/empty file/i);
  });

  it('refuses a plan that belongs to another studio, and one that does not validate', async () => {
    const document = photoDocument();
    const wrongStudio = await executePlan(
      plan([{ id: 's1', tool: 'illustration.export_svg', args: {} }]),
      host(document, { studio: 'photo' }),
    );
    expect(wrongStudio.status).toBe('failed');

    const badArgs = await executePlan(
      plan([{ id: 's1', tool: 'photo.adjust', args: { adjustment: 'contrast', value: 500 } }]),
      host(document),
    );
    expect(badArgs.status).toBe('failed');
    expect(badArgs.steps[0]?.error).toMatch(/at most 100/i);
  });
});

describe('the executor never reports success for work it did not do', () => {
  it('returns a failed report when a runner rejects the arguments it was given', async () => {
    const document = vectorDocument([pathLayer('Only', 'lyr-only')]);
    const result: RunReport = await executePlan(
      plan([{ id: 's1', tool: 'illustration.set_fill', args: { colour: '#123456' } }]),
      host(document, { studio: 'illustration', selection: [] }),
    );
    expect(result.status).toBe('failed');
    expect(result.changed).toBe(0);
    expect(result.steps[0]?.error).toMatch(/select at least one/i);
  });

  it('rejects a plan whose only content is a refusal', async () => {
    const refusalPlan = planNatively('photo', 'make it pop');
    if (!refusalPlan.ok) throw new Error(refusalPlan.error.message);
    const result = await executePlan(refusalPlan.value, host(photoDocument()));
    expect(result.status).toBe('failed');
    expect(result.summary).toMatch(/nothing ran/i);
  });

  it('validates a provider-written plan exactly like a native one', async () => {
    // A plan that arrived over the network is still data: tool ids, parameters and ranges are
    // rechecked, so a model cannot widen a range by asking for one.
    const fromProvider: AssistantPlan = {
      intent: 'provider plan',
      steps: [
        { id: 's1', tool: 'photo.adjust', args: { adjustment: 'exposure', value: 10 } },
        { id: 's2', tool: 'photo.adjust', args: { adjustment: 'exposure', value: 900 } },
      ],
      unsupported: [],
      source: 'provider',
    };
    const result = await executePlan(fromProvider, host(photoDocument()));
    expect(result.status).toBe('failed');
    expect(result.steps[0]?.status).toBe('failed');
    expect(result.summary).toMatch(/at most 100/i);
  });
});
