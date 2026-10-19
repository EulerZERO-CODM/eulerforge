import { describe, expect, it } from 'vitest';

import {
  createCheckpoint,
  markStepCompleted,
  parseCheckpoint,
  remainingSteps,
  resumePlan,
} from './checkpoint';
import type { AssistantPlan } from './registry';

const NOW = '2026-10-19T12:00:00.000Z';

const PLAN: AssistantPlan = {
  intent: 'Adjust the shadows and export a PNG.',
  steps: [
    { id: 'step-1', tool: 'photo.adjust', args: { adjustment: 'shadows', value: 20 } },
    { id: 'step-2', tool: 'photo.export', args: { format: 'png' } },
  ],
  unsupported: [],
  source: 'native',
};

describe('an assistant checkpoint', () => {
  it('starts with nothing completed and keeps the goal trimmed', () => {
    const checkpoint = createCheckpoint({
      studio: 'photo',
      goal: '  lift the shadows  ',
      plan: PLAN,
      now: NOW,
    });
    expect(checkpoint.goal).toBe('lift the shadows');
    expect(checkpoint.completed).toEqual([]);
    expect(checkpoint.version).toBe(1);
  });

  it('records a finished step once and ignores ids the plan does not contain', () => {
    const checkpoint = createCheckpoint({ studio: 'photo', goal: 'x', plan: PLAN, now: NOW });
    const first = markStepCompleted(checkpoint, 'step-1', NOW);
    const twice = markStepCompleted(first, 'step-1', NOW);
    const unknown = markStepCompleted(first, 'not-a-step', NOW);
    expect(first.completed).toEqual(['step-1']);
    expect(twice).toBe(first);
    expect(unknown).toBe(first);
  });

  it('resumes only the unfinished steps, keeping the refusals', () => {
    const withRefusal: AssistantPlan = {
      ...PLAN,
      unsupported: [
        { request: 'cut out the subject', why: 'No model.', alternatives: ['select by colour'] },
      ],
    };
    const checkpoint = createCheckpoint({
      studio: 'photo',
      goal: 'x',
      plan: withRefusal,
      now: NOW,
    });
    const resumed = resumePlan(markStepCompleted(checkpoint, 'step-1', NOW));
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.steps.map((step) => step.id)).toEqual(['step-2']);
    expect(resumed.value.unsupported).toHaveLength(1);
    expect(resumed.value.intent).toBe(withRefusal.intent);
    expect(remainingSteps(checkpoint)).toHaveLength(2);
  });

  it('says a finished run has nothing left instead of returning an empty plan', () => {
    const checkpoint = createCheckpoint({ studio: 'photo', goal: 'x', plan: PLAN, now: NOW });
    const done = markStepCompleted(markStepCompleted(checkpoint, 'step-1', NOW), 'step-2', NOW);
    const resumed = resumePlan(done);
    expect(resumed.ok).toBe(false);
    if (!resumed.ok) expect(resumed.error.message).toMatch(/no steps left/i);
  });

  it('round-trips through JSON, which is how it is stored', () => {
    const checkpoint = markStepCompleted(
      createCheckpoint({ studio: 'photo', goal: 'x', plan: PLAN, now: NOW }),
      'step-1',
      NOW,
    );
    const parsed = parseCheckpoint(JSON.parse(JSON.stringify(checkpoint)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.completed).toEqual(['step-1']);
    expect(parsed.value.plan.steps).toHaveLength(2);
  });

  it('drops a stale completed id so a step cannot look finished when it is not', () => {
    const checkpoint = markStepCompleted(
      createCheckpoint({ studio: 'photo', goal: 'x', plan: PLAN, now: NOW }),
      'step-1',
      NOW,
    );
    const parsed = parseCheckpoint({
      ...JSON.parse(JSON.stringify(checkpoint)),
      completed: ['step-1', 'from-another-plan'],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.completed).toEqual(['step-1']);
  });

  it('refuses a record from another version, studio or shape', () => {
    const base = createCheckpoint({ studio: 'photo', goal: 'x', plan: PLAN, now: NOW });
    expect(parseCheckpoint({ ...base, version: 2 }).ok).toBe(false);
    expect(parseCheckpoint({ ...base, studio: 'audio' }).ok).toBe(false);
    expect(parseCheckpoint({ ...base, updatedAt: 'yesterday-ish' }).ok).toBe(false);
    expect(parseCheckpoint({ ...base, goal: '   ' }).ok).toBe(false);
    expect(parseCheckpoint('checkpoint').ok).toBe(false);
    expect(
      parseCheckpoint({
        ...base,
        plan: { ...base.plan, steps: [{ id: 'a', tool: 'photo.adjust', args: { value: {} } }] },
      }).ok,
    ).toBe(false);
  });

  it('drops unreadable refusals rather than failing the whole record', () => {
    const base = createCheckpoint({ studio: 'photo', goal: 'x', plan: PLAN, now: NOW });
    const parsed = parseCheckpoint({
      ...JSON.parse(JSON.stringify(base)),
      plan: {
        ...base.plan,
        unsupported: [
          { request: 'cut it out', why: 'No model.', alternatives: ['select by colour'] },
          { request: 42 },
        ],
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.plan.unsupported).toHaveLength(1);
  });
});
