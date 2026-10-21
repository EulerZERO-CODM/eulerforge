import { beforeEach, describe, expect, it } from 'vitest';

import { createCheckpoint, markStepCompleted } from '../../core/assistant/checkpoint';
import type { AssistantPlan } from '../../core/assistant/registry';
import {
  ASSISTANT_RUNS_KEY,
  forgetAssistantRun,
  readAssistantRun,
  writeAssistantRun,
} from './assistant-runs';

const PLAN: AssistantPlan = {
  intent: 'Fill and export.',
  steps: [
    { id: 'step-1', tool: 'illustration.set_fill', args: { colour: '#ef4444' } },
    { id: 'step-2', tool: 'illustration.export_svg', args: {} },
  ],
  unsupported: [],
  source: 'native',
};

const NOW = '2026-10-19T12:00:00.000Z';

function checkpoint(documentId = 'doc-1') {
  void documentId;
  return markStepCompleted(
    createCheckpoint({ studio: 'illustration', goal: 'fill and export', plan: PLAN, now: NOW }),
    'step-1',
    NOW,
  );
}

describe('assistant run storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips one record per document and forgets it on request', () => {
    writeAssistantRun('doc-1', checkpoint());
    const read = readAssistantRun('doc-1');
    expect(read?.completed).toEqual(['step-1']);
    expect(read?.plan.steps).toHaveLength(2);
    expect(window.localStorage.getItem(ASSISTANT_RUNS_KEY)).not.toContain('secret');

    writeAssistantRun(
      'doc-2',
      createCheckpoint({ studio: 'photo', goal: 'x', plan: PLAN, now: NOW }),
    );
    expect(readAssistantRun('doc-1')?.goal).toBe('fill and export');
    expect(readAssistantRun('doc-2')?.completed).toEqual([]);

    forgetAssistantRun('doc-1');
    expect(readAssistantRun('doc-1')).toBeNull();
    expect(readAssistantRun('doc-2')).not.toBeNull();
  });

  it('drops a corrupt record instead of throwing or blocking later runs', () => {
    window.localStorage.setItem(ASSISTANT_RUNS_KEY, '{not json');
    expect(readAssistantRun('doc-1')).toBeNull();
    writeAssistantRun('doc-1', checkpoint());
    expect(readAssistantRun('doc-1')?.goal).toBe('fill and export');
  });

  it('drops a record whose version this build cannot read', () => {
    const record = JSON.parse(JSON.stringify(checkpoint())) as Record<string, unknown>;
    window.localStorage.setItem(
      ASSISTANT_RUNS_KEY,
      JSON.stringify({ 'doc-1': { ...record, version: 99 } }),
    );
    expect(readAssistantRun('doc-1')).toBeNull();
    // The bad entry is removed, not left to be retried on every mount.
    expect(window.localStorage.getItem(ASSISTANT_RUNS_KEY)).not.toContain('doc-1');
  });
});
