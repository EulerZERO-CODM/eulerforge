import { describe, expect, it } from 'vitest';

import {
  addLayerCommand,
  applyPaletteCommand,
  deleteLayersCommand,
  duplicateLayersCommand,
  placeAssetCommand,
  renameLayerCommand,
  reorderLayerCommand,
  reorderLayersCommand,
  setBackgroundCommand,
  setGroupBoundsCommand,
  setImageSettingsCommand,
  setLayerFrameCommand,
  setLayerFramesCommand,
  setLayerLockCommand,
  setLayersLockCommand,
  setLayersOpacityCommand,
  setLayersVisibilityCommand,
  setShapeSettingsCommand,
  setTextSettingsCommand,
  type SceneCommand,
} from './commands';
import { SAMPLE_ASSETS } from '../assets/data';
import { isPlaceable, type AssetRecord } from '../assets/types';
import { applyDocumentPatch } from '../documents/factories';
import { createRect, unionRects } from '../documents/geometry';
import type { ForgeDocument } from '../documents/types';
import { HistoryStack } from '../history/history';
import type { Result } from '../result';
import {
  attributionRecord,
  documentFixture,
  ellipseLayer,
  imageLayer,
  rectLayer,
  sceneOf,
  textLayer,
} from '../../testing/layers';

/**
 * Undo/redo coverage for the editor commands.
 *
 * Every row is one action a person can take in the workspace, expressed as the command the control
 * runs. The table is exercised by one shared runner, so each action is checked against the same six
 * questions:
 *
 *   1. the patch changes exactly the document keys the action is supposed to touch,
 *   2. the command carries one non-empty human label,
 *   3. one commit is one history entry, and undo restores the *identical* previous document,
 *   4. redo restores the *identical* post-edit document,
 *   5. a commit that changes nothing produces no entry at all,
 *   6. a command that refuses (a missing layer, an invalid value) produces no patch and no entry.
 *
 * The workspace-level half of the matrix — one control press, one entry, persisted document and the
 * rendered history list agreeing — lives in `src/components/workspace/undo-redo.test.tsx`, and the
 * browser half in `e2e/undo-redo.spec.ts`. Rows are grouped exactly like the panels they come from,
 * so a reader can check a group against the inspector it describes.
 */

const NOW = new Date('2026-05-01T12:00:00.000Z');

/** Asset id of the placed sample graphic, matching the attribution record in the fixture. */
const GRAPHIC_ASSET_ID = 'sample.gradient-grid';

/**
 * A document with one of every editable layer type, and a graphic whose licence record is attached.
 *
 * Layer order (bottom first) is Panel, Badge, Headline, Aurora mesh, Footnote — the same order the
 * layer list shows top-first, so a row that says "send backward" can be checked against it.
 */
function fixture(
  overrides: { readonly hiddenPanel?: boolean; readonly strokedPanel?: boolean } = {},
): ForgeDocument {
  return documentFixture({
    scene: sceneOf(
      rectLayer('lyr-panel', {
        name: 'Panel',
        x: 40,
        y: 40,
        width: 200,
        height: 120,
        ...(overrides.hiddenPanel === true ? { visible: false } : {}),
        ...(overrides.strokedPanel === true ? { stroke: '#ffd166', strokeWidth: 2 } : {}),
      }),
      ellipseLayer('lyr-badge', { name: 'Badge', x: 300, y: 220, width: 90, height: 90 }),
      textLayer('lyr-headline', { name: 'Headline', x: 40, y: 220, content: 'Launch day' }),
      imageLayer('lyr-graphic', {
        name: 'Aurora mesh',
        x: 40,
        y: 340,
        assetId: GRAPHIC_ASSET_ID,
      }),
      rectLayer('lyr-footnote', { name: 'Footnote', x: 300, y: 40, width: 80, height: 60 }),
    ),
    attribution: [attributionRecord({ assetId: GRAPHIC_ASSET_ID })],
  });
}

/** The same stack with the Panel locked, so the "unlock a layer" row has something to unlock. */
function lockedFixture(): ForgeDocument {
  const base = fixture();
  return documentFixture({
    scene: sceneOf(
      ...base.scene.layers.map((layer) =>
        layer.name === 'Panel' ? { ...layer, locked: true } : layer,
      ),
    ),
    attribution: [attributionRecord({ assetId: GRAPHIC_ASSET_ID })],
  });
}

function placeable(): AssetRecord {
  const record = SAMPLE_ASSETS.find(
    (candidate) => isPlaceable(candidate) && candidate.kind === 'graphic',
  );
  if (!record) throw new Error('the sample catalogue must ship at least one placeable graphic');
  return record;
}

/**
 * The document's content, with the two fields a patch always rewrites neutralised.
 *
 * `applyDocumentPatch` bumps `revision` and `updatedAt` on every commit; everything else is what a
 * person would call "the document". Two documents with the same string here are the same edit, which
 * is the same rule the session uses to decide whether a commit is worth recording.
 */
function contentOf(document: ForgeDocument): string {
  return JSON.stringify({ ...document, revision: 0, updatedAt: '', createdAt: '' });
}

/** The document keys whose *content* differs between two revisions, ignoring the volatile ones. */
function changedKeys(before: ForgeDocument, after: ForgeDocument): string[] {
  const volatile = new Set(['revision', 'updatedAt', 'createdAt']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !volatile.has(key))
    .filter((key) => {
      const a = JSON.stringify((before as Record<string, unknown>)[key] ?? null);
      const b = JSON.stringify((after as Record<string, unknown>)[key] ?? null);
      return a !== b;
    })
    .sort();
}

type Case = {
  /** The action, described the way it appears in the workspace. */
  readonly name: string;
  /** The label the history panel must show for it. */
  readonly label: string;
  readonly run: (document: ForgeDocument) => Result<SceneCommand>;
  /** Document keys the patch may touch. Anything else changing is a defect. Defaults to `scene`. */
  readonly keys?: readonly string[];
  /** A document with a different precondition (a hidden layer, an existing stroke). */
  readonly fixture?: () => ForgeDocument;
  /** Row-specific assertions on the effect, so the matrix says what each action *did*. */
  readonly after?: (before: ForgeDocument, after: ForgeDocument) => void;
};

/**
 * Runs one row of the matrix and applies the shared undo/redo contract to it.
 *
 * The transition is driven by the same `HistoryStack` and `applyDocumentPatch` the session uses, so
 * a row proves the real path: label → one entry → exact revert → exact replay.
 */
function exercise(testCase: Case): void {
  const before = (testCase.fixture ?? fixture)();
  const command = testCase.run(before);
  expect(command.ok, `“${testCase.name}” should be a valid edit`).toBe(true);
  if (!command.ok) return;

  expect(command.value.label).toBe(testCase.label);
  expect(command.value.label.trim().length).toBeGreaterThan(0);

  const after = applyDocumentPatch(before, command.value.patch, NOW);
  expect(changedKeys(before, after)).toEqual([...(testCase.keys ?? ['scene'])].sort());
  testCase.after?.(before, after);

  const history = new HistoryStack<ForgeDocument>({ initial: before, now: () => NOW });
  const entry = history.commit(command.value.label, after, (a, b) => contentOf(a) === contentOf(b));
  expect(entry?.label).toBe(testCase.label);
  expect(history.snapshot().labels.map((item) => item.label)).toEqual([testCase.label]);
  expect(history.canUndo()).toBe(true);
  expect(history.canRedo()).toBe(false);

  // Undo hands back the identical document that was there before the edit — not an equal copy of
  // the scene, the same frozen document, which is what makes attribution and layer order safe.
  expect(history.undo()).toBe(before);
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(true);

  // Redo hands back the identical post-edit document.
  expect(history.redo()).toBe(after);
  expect(history.canRedo()).toBe(false);
}

const CASES: readonly Case[] = [
  {
    name: 'adding a text layer from the toolbar',
    label: 'Add text layer',
    run: (document) => addLayerCommand(document, 'text'),
    after: (before, after) => {
      expect(after.scene.layers).toHaveLength(before.scene.layers.length + 1);
      expect(after.scene.layers.at(-1)?.type).toBe('text');
    },
  },
  {
    name: 'adding a rectangle layer from the toolbar',
    label: 'Add rectangle layer',
    run: (document) => addLayerCommand(document, 'rect'),
  },
  {
    name: 'adding an ellipse layer from the toolbar',
    label: 'Add ellipse layer',
    run: (document) => addLayerCommand(document, 'ellipse'),
  },
  {
    name: 'placing a catalogue graphic',
    label: `Place graphic “${placeable().name}”`,
    run: (document) => placeAssetCommand(document, placeable()),
    keys: ['scene', 'attribution'],
    after: (before, after) => {
      // Placing a graphic records where it came from: the document carries the licence record.
      expect(after.attribution).toHaveLength(before.attribution.length + 1);
      expect(after.scene.layers.at(-1)?.name).toBe(placeable().name);
    },
  },
  {
    name: 'renaming a layer in the inspector',
    label: 'Rename layer to “Hero panel”',
    run: (document) => renameLayerCommand(document, 'lyr-panel', 'Hero panel'),
    after: (_before, after) => {
      expect(after.scene.layers[0]?.name).toBe('Hero panel');
    },
  },
  {
    name: 'moving a layer with the pointer or the arrow keys',
    label: 'Move “Panel”',
    run: (document) =>
      setLayerFrameCommand(document, 'lyr-panel', createRect(120, 90, 200, 120), 'Move “Panel”'),
    after: (_before, after) => {
      expect(after.scene.layers[0]?.frame).toMatchObject({ x: 120, y: 90 });
    },
  },
  {
    name: 'resizing one layer from a handle',
    label: 'Resize “Panel”',
    run: (document) =>
      setLayerFramesCommand(
        document,
        [{ id: 'lyr-panel', frame: createRect(40, 40, 260, 180) }],
        'Resize “Panel”',
      ),
    after: (_before, after) => {
      expect(after.scene.layers[0]?.frame).toMatchObject({ width: 260, height: 180 });
    },
  },
  {
    name: 'dragging a multi-layer selection',
    label: 'Move 2 layers',
    run: (document) =>
      setLayerFramesCommand(
        document,
        [
          { id: 'lyr-panel', frame: createRect(140, 140, 200, 120) },
          { id: 'lyr-footnote', frame: createRect(400, 140, 80, 60) },
        ],
        'Move 2 layers',
      ),
    after: (_before, after) => {
      // One patch, both layers: a group drag is one edit, not one per layer.
      expect(after.scene.layers[0]?.frame.x).toBe(140);
      expect(after.scene.layers[4]?.frame.x).toBe(400);
    },
  },
  {
    name: 'resizing a selection to explicit group bounds',
    label: 'Set 2 layers bounds to 400 × 300',
    run: (document) =>
      setGroupBoundsCommand(document, ['lyr-panel', 'lyr-footnote'], createRect(40, 40, 400, 300)),
    after: (_before, after) => {
      const box = unionRects(
        after.scene.layers
          .filter((layer) => layer.id === 'lyr-panel' || layer.id === 'lyr-footnote')
          .map((layer) => layer.frame),
      );
      expect(box?.x).toBeCloseTo(40, 1);
      expect(box?.y).toBeCloseTo(40, 1);
      expect(box?.width).toBeCloseTo(400, 0);
      expect(box?.height).toBeCloseTo(300, 0);
    },
  },
  {
    name: 'duplicating one layer from the layer list',
    label: 'Duplicate “Panel”',
    run: (document) => duplicateLayersCommand(document, ['lyr-panel']),
    after: (before, after) => {
      expect(after.scene.layers).toHaveLength(before.scene.layers.length + 1);
    },
  },
  {
    name: 'duplicating a multi-layer selection',
    label: 'Duplicate 2 layers',
    run: (document) => duplicateLayersCommand(document, ['lyr-panel', 'lyr-footnote']),
  },
  {
    name: 'deleting one layer from the layer list',
    label: 'Delete “Panel”',
    run: (document) => deleteLayersCommand(document, ['lyr-panel']),
    after: (before, after) => {
      expect(after.scene.layers).toHaveLength(before.scene.layers.length - 1);
      expect(after.scene.layers.some((layer) => layer.name === 'Panel')).toBe(false);
    },
  },
  {
    name: 'deleting the placed graphic also drops its attribution',
    label: 'Delete “Aurora mesh”',
    run: (document) => deleteLayersCommand(document, ['lyr-graphic']),
    keys: ['scene', 'attribution'],
    after: (_before, after) => {
      expect(after.attribution).toHaveLength(0);
    },
  },
  {
    name: 'bringing a layer to the front',
    label: 'Bring to front: “Panel”',
    run: (document) => reorderLayersCommand(document, ['lyr-panel'], 'front'),
    after: (_before, after) => {
      expect(after.scene.layers.at(-1)?.name).toBe('Panel');
    },
  },
  {
    name: 'sending a multi-layer selection backward',
    label: 'Send backward: 2 layers',
    run: (document) => reorderLayersCommand(document, ['lyr-headline', 'lyr-graphic'], 'backward'),
    after: (before, after) => {
      const names = (document: ForgeDocument) => document.scene.layers.map((layer) => layer.name);
      expect(names(before)).toEqual(['Panel', 'Badge', 'Headline', 'Aurora mesh', 'Footnote']);
      expect(names(after)).toEqual(['Panel', 'Headline', 'Aurora mesh', 'Badge', 'Footnote']);
    },
  },
  {
    name: 'hiding a layer from the layer list',
    label: 'Hide “Panel”',
    run: (document) => setLayersVisibilityCommand(document, ['lyr-panel'], false),
    after: (_before, after) => {
      expect(after.scene.layers[0]?.visible).toBe(false);
    },
  },
  {
    name: 'showing a hidden layer again',
    label: 'Show “Panel”',
    fixture: () => fixture({ hiddenPanel: true }),
    run: (document) => setLayersVisibilityCommand(document, ['lyr-panel'], true),
    after: (_before, after) => {
      expect(after.scene.layers[0]?.visible).toBe(true);
    },
  },
  {
    name: 'locking a layer',
    label: 'Lock “Panel”',
    run: (document) => setLayersLockCommand(document, ['lyr-panel'], true),
    after: (_before, after) => {
      expect(after.scene.layers[0]?.locked).toBe(true);
    },
  },
  {
    name: 'setting opacity across a selection',
    label: 'Set opacity of 2 layers to 40%',
    run: (document) => setLayersOpacityCommand(document, ['lyr-panel', 'lyr-footnote'], 0.4),
    after: (_before, after) => {
      expect(after.scene.layers[0]?.opacity).toBeCloseTo(0.4, 5);
      expect(after.scene.layers[4]?.opacity).toBeCloseTo(0.4, 5);
    },
  },
  {
    name: 'editing text content',
    label: 'Edit text in “Headline”',
    run: (document) => setTextSettingsCommand(document, 'lyr-headline', { content: 'Launch now' }),
    after: (_before, after) => {
      const layer = after.scene.layers[2];
      expect(layer?.type === 'text' ? layer.text.content : null).toBe('Launch now');
    },
  },
  {
    name: 'changing the typeface',
    label: 'Change “Headline” typeface',
    run: (document) => setTextSettingsCommand(document, 'lyr-headline', { fontStackId: 'mono' }),
  },
  {
    name: 'changing the font size',
    label: 'Set “Headline” font size to 48px',
    run: (document) => setTextSettingsCommand(document, 'lyr-headline', { fontSize: 48 }),
    after: (_before, after) => {
      const layer = after.scene.layers[2];
      expect(layer?.type === 'text' ? layer.text.fontSize : null).toBe(48);
    },
  },
  {
    name: 'changing the weight',
    label: 'Set “Headline” weight to 700',
    run: (document) => setTextSettingsCommand(document, 'lyr-headline', { fontWeight: 700 }),
  },
  {
    name: 'changing the line height',
    label: 'Set “Headline” line height to 1.6x',
    run: (document) => setTextSettingsCommand(document, 'lyr-headline', { lineHeight: 1.6 }),
  },
  {
    name: 'changing letter spacing',
    label: 'Set “Headline” letter spacing to 2px',
    run: (document) => setTextSettingsCommand(document, 'lyr-headline', { letterSpacing: 2 }),
  },
  {
    name: 'changing text alignment',
    label: 'Align “Headline” text center',
    run: (document) => setTextSettingsCommand(document, 'lyr-headline', { align: 'center' }),
  },
  {
    name: 'changing the text colour',
    label: 'Set “Headline” text colour to #ffd166',
    run: (document) => setTextSettingsCommand(document, 'lyr-headline', { color: '#ffd166' }),
  },
  {
    name: 'setting a shape fill',
    label: 'Set “Panel” fill to #2b5fd9',
    run: (document) => setShapeSettingsCommand(document, 'lyr-panel', { fill: '#2b5fd9' }),
    after: (_before, after) => {
      const layer = after.scene.layers[0];
      expect(layer?.type === 'rect' ? layer.shape.fill : null).toBe('#2b5fd9');
    },
  },
  {
    name: 'removing a shape fill',
    label: 'Remove “Panel” fill',
    run: (document) => setShapeSettingsCommand(document, 'lyr-panel', { fill: null }),
  },
  {
    name: 'setting a stroke',
    label: 'Set “Panel” stroke to #ffd166',
    run: (document) => setShapeSettingsCommand(document, 'lyr-panel', { stroke: '#ffd166' }),
  },
  {
    name: 'removing a stroke',
    label: 'Remove “Panel” stroke',
    fixture: () => fixture({ strokedPanel: true }),
    run: (document) => setShapeSettingsCommand(document, 'lyr-panel', { stroke: null }),
    after: (_before, after) => {
      const layer = after.scene.layers[0];
      expect(layer?.type === 'rect' ? layer.shape.stroke : 'missing').toBeNull();
    },
  },
  {
    name: 'changing the stroke width',
    label: 'Set “Panel” stroke width to 6px',
    run: (document) => setShapeSettingsCommand(document, 'lyr-panel', { strokeWidth: 6 }),
  },
  {
    name: 'changing the corner radius',
    label: 'Set “Panel” corner radius to 12px',
    run: (document) => setShapeSettingsCommand(document, 'lyr-panel', { cornerRadius: 12 }),
  },
  {
    name: 'changing how a graphic is fitted',
    label: 'Fit “Aurora mesh” graphic to cover',
    run: (document) => setImageSettingsCommand(document, 'lyr-graphic', { fit: 'cover' }),
  },
  {
    name: 'tinting a graphic',
    label: 'Set “Aurora mesh” tint to #7ee0c0',
    run: (document) => setImageSettingsCommand(document, 'lyr-graphic', { tint: '#7ee0c0' }),
    after: (_before, after) => {
      const layer = after.scene.layers[3];
      expect(layer?.type === 'image' ? layer.image.tint : null).toBe('#7ee0c0');
    },
  },
  {
    name: 'changing the canvas background colour',
    label: 'Set canvas background to #101820',
    run: (document) => setBackgroundCommand(document, { color: '#101820' }),
    keys: ['canvas'],
  },
  {
    name: 'making the background transparent',
    label: 'Make the canvas background transparent',
    run: (document) => setBackgroundCommand(document, { transparent: true }),
    keys: ['canvas'],
  },
  {
    name: 'applying a palette',
    label: 'Apply palette',
    run: () => applyPaletteCommand(['#2b5fd9', '#ffd166']),
    keys: ['palette'],
  },
  {
    name: 'unlocking a locked layer',
    label: 'Unlock “Panel”',
    fixture: lockedFixture,
    run: (document) => setLayerLockCommand(document, 'lyr-panel', false),
    after: (_before, after) => {
      expect(after.scene.layers[0]?.locked).toBe(false);
    },
  },
  {
    name: 'hiding a multi-layer selection',
    label: 'Hide 2 layers',
    run: (document) => setLayersVisibilityCommand(document, ['lyr-panel', 'lyr-footnote'], false),
    after: (_before, after) => {
      expect(after.scene.layers.filter((layer) => !layer.visible)).toHaveLength(2);
    },
  },
  {
    name: 'locking a multi-layer selection',
    label: 'Lock 2 layers',
    run: (document) => setLayersLockCommand(document, ['lyr-panel', 'lyr-footnote'], true),
    after: (_before, after) => {
      expect(after.scene.layers.filter((layer) => layer.locked)).toHaveLength(2);
    },
  },
  {
    name: 'sending one layer backward',
    label: 'Send backward: “Headline”',
    run: (document) => reorderLayerCommand(document, 'lyr-headline', 'backward'),
    after: (_before, after) => {
      expect(after.scene.layers.map((layer) => layer.name)).toEqual([
        'Panel',
        'Headline',
        'Badge',
        'Aurora mesh',
        'Footnote',
      ]);
    },
  },
  {
    name: 'sending one layer to the back',
    label: 'Send to back: “Headline”',
    run: (document) => reorderLayerCommand(document, 'lyr-headline', 'back'),
    after: (_before, after) => {
      expect(after.scene.layers[0]?.name).toBe('Headline');
    },
  },
  {
    name: 'bringing a multi-layer selection forward',
    label: 'Bring forward: 2 layers',
    run: (document) => reorderLayersCommand(document, ['lyr-panel', 'lyr-badge'], 'forward'),
    after: (_before, after) => {
      // The two layers move up together and keep their order relative to each other.
      expect(after.scene.layers.map((layer) => layer.name)).toEqual([
        'Headline',
        'Panel',
        'Badge',
        'Aurora mesh',
        'Footnote',
      ]);
    },
  },
  {
    name: 'moving a multi-layer selection to explicit bounds',
    label: 'Move 2 layers',
    run: (document) =>
      setGroupBoundsCommand(document, ['lyr-panel', 'lyr-footnote'], { x: 100, y: 120 }),
    after: (before, after) => {
      const box = (document: ForgeDocument) =>
        unionRects(
          document.scene.layers
            .filter((layer) => layer.id === 'lyr-panel' || layer.id === 'lyr-footnote')
            .map((layer) => layer.frame),
        );
      expect(box(after)?.x).toBe(100);
      expect(box(after)?.y).toBe(120);
      expect(box(after)?.width).toBe(box(before)?.width);
    },
  },
];

describe('every document-changing action is one labelled, reversible step', () => {
  it.each(CASES.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    exercise(testCase);
  });

  it('covers the actions the workspace offers, not a sample of them', () => {
    // A guard against a row being dropped during a refactor: the matrix is the coverage claim.
    expect(CASES.length).toBeGreaterThanOrEqual(44);
    const labels = CASES.map((testCase) => testCase.label);
    expect(new Set(labels).size).toBeGreaterThanOrEqual(30);
  });
});

describe('actions that must not leave a history entry', () => {
  it('records nothing for a command that refuses, because there is no patch to apply', () => {
    const document = fixture();
    const missing = deleteLayersCommand(document, ['lyr-not-here']);
    expect(missing.ok).toBe(false);

    const invalid = setShapeSettingsCommand(document, 'lyr-panel', { cornerRadius: -5 });
    expect(invalid.ok).toBe(false);

    const blankName = renameLayerCommand(document, 'lyr-panel', '   ');
    expect(blankName.ok).toBe(false);
  });

  it('records nothing when the action leaves the document exactly as it was', () => {
    const before = fixture();
    // Re-typing the same name, pressing the same alignment, dragging a slider back to its value:
    // each of these reaches the history layer as a patch that changes nothing.
    const unchanged = [
      renameLayerCommand(before, 'lyr-panel', 'Panel'),
      setTextSettingsCommand(before, 'lyr-headline', { align: 'left' }),
      setLayersOpacityCommand(before, ['lyr-panel'], 1),
      setLayersVisibilityCommand(before, ['lyr-panel'], true),
      setLayersLockCommand(before, ['lyr-panel'], false),
    ];

    const history = new HistoryStack<ForgeDocument>({ initial: before, now: () => NOW });
    for (const command of unchanged) {
      expect(command.ok).toBe(true);
      if (!command.ok) continue;
      const after = applyDocumentPatch(before, command.value.patch, NOW);
      expect(contentOf(after)).toBe(contentOf(before));
      expect(
        history.commit(command.value.label, after, (a, b) => contentOf(a) === contentOf(b)),
      ).toBeNull();
    }

    expect(history.snapshot().depth).toBe(0);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it('keeps the previous entry intact when an unchanged action follows a real edit', () => {
    const before = fixture();
    const renamed = renameLayerCommand(before, 'lyr-panel', 'Hero panel');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const after = applyDocumentPatch(before, renamed.value.patch, NOW);

    const history = new HistoryStack<ForgeDocument>({ initial: before, now: () => NOW });
    history.commit(renamed.value.label, after, (a, b) => contentOf(a) === contentOf(b));

    const sameAgain = renameLayerCommand(after, 'lyr-panel', 'Hero panel');
    expect(sameAgain.ok).toBe(true);
    if (!sameAgain.ok) return;
    const noChange = applyDocumentPatch(after, sameAgain.value.patch, NOW);
    expect(
      history.commit(sameAgain.value.label, noChange, (a, b) => contentOf(a) === contentOf(b)),
    ).toBeNull();

    expect(history.snapshot().labels.map((item) => item.label)).toEqual([
      'Rename layer to “Hero panel”',
    ]);
    expect(history.undo()).toBe(before);
  });
});
