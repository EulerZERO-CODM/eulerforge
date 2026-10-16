import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Canvas, ForgeDocument, GuideSettings } from '../../core/documents/types';
import type { Scene } from '../../core/documents/layer-types';
import { unionRects } from '../../core/documents/geometry';
import { imageLayer, rectLayer, sceneOf, textLayer } from '../../testing/layers';
import {
  dragOnArtboard,
  historyLabels,
  mount,
  panelHistory,
  SQUARE_CANVAS,
  persisted,
  redoButton,
  savedDocument,
  selectRow,
  undoButton,
  type MountedWorkspace,
} from '../../testing/workspace-harness';

/**
 * Undo/redo at the interface level: the action-to-test matrix.
 *
 * Every row is one thing a person can do in the workspace, driven through the control they would
 * use — the toolbar button, the layer list, the inspector field, the artboard handle — and then
 * checked against the same six questions:
 *
 *   1. the action changes exactly the document keys it is supposed to change,
 *   2. it records exactly one history entry, with the label shown in the panel,
 *   3. undo (through the panel's own button) restores the document that was there before, byte for
 *      byte, including attribution and layer order,
 *   4. redo restores the document the action produced,
 *   5. the saved document, the session state and the rendered panel agree at every step,
 *   6. actions that are refused, cancelled or change nothing leave no entry and no misleading label.
 *
 * Rows are grouped by the panel they come from. Selection, zoom, snaps, guides visibility and export
 * are *view* state: the second half of the file proves they record nothing at all, which is the
 * other half of the contract (ADR-0015).
 *
 * The command-level half of the matrix — every label and every transition without the DOM — is in
 * `src/core/editor/undo-redo.test.ts`, and the browser half in `e2e/undo-redo.spec.ts`.
 */

/**
 * One of each editable layer type, so any row can select whatever it needs.
 *
 * The flags exist because a couple of controls only mean something from a particular starting state:
 * "Show" needs a hidden layer, "Unlock" a locked one, "Remove stroke" a shape that has a stroke. Each
 * row overrides only the state it is about, so the rest of the stack stays the same.
 */
function defaultScene(
  options: {
    readonly hidden?: boolean;
    readonly stroked?: boolean;
    readonly tinted?: boolean;
  } = {},
): Scene {
  return sceneOf(
    rectLayer('lyr-a', {
      name: 'Panel',
      x: 40,
      y: 40,
      width: 200,
      height: 120,
      ...(options.hidden ? { visible: false } : {}),
      ...(options.stroked ? { stroke: '#ffd166', strokeWidth: 2 } : {}),
    }),
    textLayer('lyr-b', { name: 'Headline', x: 40, y: 220, width: 300, height: 90 }),
    imageLayer('lyr-c', {
      name: 'Aurora mesh',
      x: 360,
      y: 220,
      assetId: 'sample.gradient-grid',
      ...(options.tinted ? { tint: '#7ee0c0' } : {}),
    }),
    rectLayer('lyr-d', { name: 'Footnote', x: 600, y: 40, width: 120, height: 60 }),
  );
}

/** The default stack with the Panel locked, for the row that unlocks it again. */
function lockedPanelScene(): Scene {
  return sceneOf(
    ...defaultScene().layers.map((layer) =>
      layer.name === 'Panel' ? { ...layer, locked: true } : layer,
    ),
  );
}

/** Layer names in z-order, which is what the ordering rows are about. */
function namesOf(document: ForgeDocument): string[] {
  return document.scene.layers.map((layer) => layer.name);
}

/**
 * A colour field's "None" control, scoped to its own field.
 *
 * Fill, stroke and tint each render a button whose accessible name is just "None", so looking it up
 * by name alone would find three of them; the field's own label is what disambiguates.
 */
function noneButton(label: string): HTMLElement {
  const fieldLabel = screen.getByText(label, { selector: 'label' });
  const header = fieldLabel.closest('div');
  if (!header) throw new Error(`the ${label} field has no header row`);
  return within(header).getByRole('button', { name: 'None' });
}

/** The "Use" button beside a sample palette's name, so the row clicks the palette it means. */
function samplePaletteButton(name: string): HTMLElement {
  const label = screen.getByText(name);
  const row = label.closest('div')?.parentElement;
  if (!row) throw new Error(`the ${name} sample palette has no row`);
  return within(row).getByRole('button', { name: 'Use' });
}

/**
 * The document's content, with the fields a commit always rewrites neutralised.
 *
 * `revision` and `updatedAt` change on every accepted edit — that is exactly what makes them useful
 * as a "did anything happen" signal, but they are not *content*: undo is expected to restore the
 * content of the previous document, which the history stack does by handing back the same frozen
 * document it held.
 */
function contentOf(document: ForgeDocument): string {
  return JSON.stringify({ ...document, revision: 0, updatedAt: '', createdAt: '' });
}

function changedKeys(before: ForgeDocument, after: ForgeDocument): string[] {
  const volatile = new Set(['revision', 'updatedAt', 'createdAt']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !volatile.has(key))
    .filter(
      (key) =>
        JSON.stringify((before as Record<string, unknown>)[key] ?? null) !==
        JSON.stringify((after as Record<string, unknown>)[key] ?? null),
    )
    .sort();
}

/** The frame of a layer in a document, so a row can say what moved. */
function frameOf(document: ForgeDocument, id: string) {
  const layer = document.scene.layers.find((candidate) => String(candidate.id) === id);
  if (!layer) throw new Error(`layer ${id} should be in the document`);
  return layer.frame;
}

type Row = {
  /** The action, as the workspace describes it. */
  readonly name: string;
  /** The label the history panel must show afterwards. */
  readonly label: string;
  /** Layer to select from the list first, when the control needs a selection. */
  readonly select?: string;
  /** Document keys the action may change. Defaults to `scene`. */
  readonly keys?: readonly string[];
  /** Pointers land on exact document pixels when snapping is off; drags set this. */
  readonly snapping?: boolean;
  /** A different starting stack, for the controls that need a particular state to mean anything. */
  readonly scene?: () => Scene;
  /** Starting palette colours, for the rows about removing or replacing them. */
  readonly palette?: readonly string[];
  /** Starting guide settings, for the rows about switching them off. */
  readonly guides?: Partial<GuideSettings>;
  /** A different starting canvas, for the rows about state that has to be there first. */
  readonly canvas?: Canvas;
  readonly act: (
    user: ReturnType<typeof userEvent.setup>,
    workspace: MountedWorkspace,
  ) => Promise<void>;
  /** What the action did, so a row says more than "something changed". */
  readonly expect?: (before: ForgeDocument, after: ForgeDocument) => void;
};

async function mountWorkspace(row: Row | null = null): Promise<MountedWorkspace> {
  return mount(row?.scene?.() ?? defaultScene(), {
    snapping: row?.snapping ?? true,
    ...(row?.canvas ? { canvas: row.canvas } : {}),
    ...(row?.palette ? { palette: row.palette } : {}),
    ...(row?.guides ? { guides: row.guides } : {}),
  });
}

/** Runs one row of the matrix, including undo and redo through the panel's buttons. */
async function checkRow(row: Row): Promise<void> {
  const workspace = await mountWorkspace(row);
  const { services, session } = workspace;
  const user = userEvent.setup();

  const before = persisted(services);
  expect(historyLabels()).toEqual([]);
  expect(undoButton()).toBeDisabled();

  if (row.select) {
    await user.click(selectRow(row.select));
  }
  await row.act(user, workspace);

  await waitFor(() => {
    expect(historyLabels()).toEqual([row.label]);
  });

  const after = persisted(services);
  expect(changedKeys(before, after)).toEqual([...(row.keys ?? ['scene'])].sort());
  row.expect?.(before, after);

  // (5) One entry in the panel, and the same document in the session, the store and storage.
  expect(panelHistory()).toEqual([{ step: 1, label: row.label }]);
  expect(contentOf(session.getState().document)).toBe(contentOf(after));
  expect(contentOf(savedDocument(services))).toBe(contentOf(after));
  expect(undoButton()).toBeEnabled();
  expect(redoButton()).toBeDisabled();

  // (3) Undo through the panel's own button restores the previous document exactly.
  await user.click(undoButton());
  await waitFor(() => {
    expect(contentOf(persisted(services))).toBe(contentOf(before));
  });
  expect(historyLabels()).toEqual([]);
  expect(undoButton()).toBeDisabled();
  expect(redoButton()).toBeEnabled();
  expect(contentOf(savedDocument(services))).toBe(contentOf(before));

  // (4) Redo restores the document the action produced.
  await user.click(redoButton());
  await waitFor(() => {
    expect(contentOf(persisted(services))).toBe(contentOf(after));
  });
  expect(historyLabels()).toEqual([row.label]);
  expect(redoButton()).toBeDisabled();
  expect(contentOf(savedDocument(services))).toBe(contentOf(after));
}

const ROWS: readonly Row[] = [
  /* ---------------------------------------------------------------- adding layers */
  {
    name: 'adding a text layer from the toolbar',
    label: 'Add text layer',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Text' }));
    },
    expect: (before, after) => {
      expect(after.scene.layers).toHaveLength(before.scene.layers.length + 1);
      expect(after.scene.layers.at(-1)?.type).toBe('text');
    },
  },
  {
    name: 'adding a rectangle layer from the toolbar',
    label: 'Add rectangle layer',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Rectangle' }));
    },
    expect: (_before, after) => {
      expect(after.scene.layers.at(-1)?.type).toBe('rect');
    },
  },
  {
    name: 'adding an ellipse layer from the toolbar',
    label: 'Add ellipse layer',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Ellipse' }));
    },
    expect: (_before, after) => {
      expect(after.scene.layers.at(-1)?.type).toBe('ellipse');
    },
  },
  {
    name: 'placing a catalogue graphic, licence record included',
    label: 'Place graphic “Aurora mesh”',
    keys: ['scene', 'attribution'],
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Graphic' }));
      const place = await screen.findAllByRole('button', { name: /place on canvas/i });
      await user.click(place[0] as HTMLElement);
    },
    expect: (before, after) => {
      expect(after.attribution.length).toBeGreaterThan(before.attribution.length);
    },
  },

  /* ---------------------------------------------------------------- the layer list */
  {
    name: 'renaming a layer in the inspector',
    label: 'Rename layer to “Hero panel”',
    select: 'Panel',
    act: async (user) => {
      const field = screen.getByLabelText('Layer name');
      await user.clear(field);
      await user.type(field, 'Hero panel');
      await user.tab();
    },
    expect: (_before, after) => {
      expect(after.scene.layers[0]?.name).toBe('Hero panel');
    },
  },
  {
    name: 'hiding a layer from its row',
    label: 'Hide “Panel”',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Hide “Panel”' }));
    },
    expect: (_before, after) => {
      expect(after.scene.layers[0]?.visible).toBe(false);
    },
  },
  {
    name: 'locking a layer from its row',
    label: 'Lock “Panel”',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Lock “Panel”' }));
    },
    expect: (_before, after) => {
      expect(after.scene.layers[0]?.locked).toBe(true);
    },
  },
  {
    name: 'duplicating one layer',
    label: 'Duplicate “Panel”',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Duplicate “Panel”' }));
    },
    expect: (before, after) => {
      expect(after.scene.layers).toHaveLength(before.scene.layers.length + 1);
    },
  },
  {
    name: 'deleting one layer',
    label: 'Delete “Panel”',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Delete “Panel”' }));
    },
    expect: (_before, after) => {
      expect(after.scene.layers.some((layer) => layer.name === 'Panel')).toBe(false);
    },
  },
  {
    name: 'reordering one layer',
    label: 'Bring forward: “Panel”',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Bring “Panel” forward' }));
    },
    expect: (before, after) => {
      expect(after.scene.layers.map((layer) => layer.name)).not.toEqual(
        before.scene.layers.map((layer) => layer.name),
      );
    },
  },
  {
    name: 'duplicating a multi-layer selection in one step',
    label: 'Duplicate 2 layers',
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      await user.click(screen.getByRole('button', { name: 'Duplicate selection' }));
    },
    expect: (before, after) => {
      expect(after.scene.layers).toHaveLength(before.scene.layers.length + 2);
    },
  },
  {
    name: 'deleting a multi-layer selection in one step',
    label: 'Delete 2 layers',
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      await user.click(screen.getByRole('button', { name: 'Delete selection' }));
    },
    expect: (_before, after) => {
      expect(after.scene.layers.map((layer) => layer.name)).toEqual(['Headline', 'Aurora mesh']);
    },
  },

  /* ---------------------------------------------------------------- layer inspector */
  {
    name: 'moving a layer with the position fields',
    label: 'Move “Panel” to x 120',
    select: 'Panel',
    act: async (user) => {
      const field = screen.getByLabelText('Layer X');
      await user.clear(field);
      await user.type(field, '120{Enter}');
    },
    expect: (_before, after) => {
      expect(frameOf(after, 'lyr-a').x).toBe(120);
    },
  },
  {
    name: 'resizing a layer with the size fields',
    label: 'Set “Panel” width to 260px',
    select: 'Panel',
    act: async (user) => {
      const field = screen.getByLabelText('Layer width');
      await user.clear(field);
      await user.type(field, '260{Enter}');
    },
    expect: (_before, after) => {
      expect(frameOf(after, 'lyr-a').width).toBe(260);
    },
  },
  {
    name: 'changing the opacity with the slider',
    label: 'Set “Panel” opacity to 40%',
    select: 'Panel',
    act: async () => {
      fireEvent.change(screen.getByLabelText('Layer opacity'), { target: { value: '40' } });
    },
    expect: (_before, after) => {
      expect(after.scene.layers[0]?.opacity).toBeCloseTo(0.4, 5);
    },
  },
  {
    name: 'editing text content',
    label: 'Edit text in “Headline”',
    select: 'Headline',
    act: async (user) => {
      const field = screen.getByRole('textbox', { name: /content/i });
      await user.clear(field);
      await user.type(field, 'Launch day');
      await user.tab();
    },
    expect: (_before, after) => {
      const layer = after.scene.layers[1];
      expect(layer?.type === 'text' ? layer.text.content : null).toBe('Launch day');
    },
  },
  {
    name: 'changing the typeface',
    label: 'Change “Headline” typeface',
    select: 'Headline',
    act: async (user) => {
      await user.selectOptions(screen.getByLabelText('Typeface'), 'mono');
    },
  },
  {
    name: 'changing the font size',
    label: 'Set “Headline” font size to 48px',
    select: 'Headline',
    act: async (user) => {
      const field = screen.getByLabelText(/^size/i);
      await user.clear(field);
      await user.type(field, '48{Enter}');
    },
  },
  {
    name: 'changing the weight',
    label: 'Set “Headline” weight to 700',
    select: 'Headline',
    act: async (user) => {
      await user.selectOptions(screen.getByLabelText('Weight'), '700');
    },
  },
  {
    name: 'changing the line height',
    label: 'Set “Headline” line height to 1.5x',
    select: 'Headline',
    act: async (user) => {
      const field = screen.getByLabelText('Line height');
      await user.clear(field);
      await user.type(field, '1.5{Enter}');
    },
  },
  {
    name: 'changing letter spacing',
    label: 'Set “Headline” letter spacing to 2px',
    select: 'Headline',
    act: async (user) => {
      const field = screen.getByLabelText('Letter spacing');
      await user.clear(field);
      await user.type(field, '2{Enter}');
    },
  },
  {
    name: 'changing the alignment',
    label: 'Align “Headline” text right',
    select: 'Headline',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: /^right$/i }));
    },
  },
  {
    name: 'changing the text colour with the picker',
    label: 'Set “Headline” text colour to #ffd166',
    select: 'Headline',
    act: async () => {
      fireEvent.change(screen.getByLabelText('Text colour colour picker'), {
        target: { value: '#ffd166' },
      });
    },
  },
  {
    name: 'setting a shape fill',
    label: 'Set “Panel” fill to #2b5fd9',
    select: 'Panel',
    act: async () => {
      fireEvent.change(screen.getByLabelText('Fill colour picker'), {
        target: { value: '#2b5fd9' },
      });
    },
  },
  {
    name: 'setting a stroke',
    label: 'Set “Panel” stroke to #ffd166',
    select: 'Panel',
    act: async () => {
      fireEvent.change(screen.getByLabelText('Stroke colour picker'), {
        target: { value: '#ffd166' },
      });
    },
  },
  {
    name: 'changing the stroke width',
    label: 'Set “Panel” stroke width to 4px',
    select: 'Panel',
    act: async (user) => {
      const field = screen.getByLabelText('Stroke width');
      await user.clear(field);
      await user.type(field, '4{Enter}');
    },
  },
  {
    name: 'changing the corner radius',
    label: 'Set “Panel” corner radius to 8px',
    select: 'Panel',
    act: async (user) => {
      const field = screen.getByLabelText('Corner radius');
      await user.clear(field);
      await user.type(field, '8{Enter}');
    },
  },
  {
    name: 'fitting a graphic differently',
    label: 'Fit “Aurora mesh” graphic to cover',
    select: 'Aurora mesh',
    act: async (user) => {
      await user.selectOptions(screen.getByLabelText('Fit'), 'cover');
    },
  },
  {
    name: 'tinting a graphic',
    label: 'Set “Aurora mesh” tint to #7ee0c0',
    select: 'Aurora mesh',
    act: async () => {
      fireEvent.change(screen.getByLabelText('Tint colour picker'), {
        target: { value: '#7ee0c0' },
      });
    },
  },

  /* ---------------------------------------------------------------- group inspector */
  {
    name: 'moving a group through the selection bounds',
    label: 'Move 2 layers',
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      const field = screen.getByLabelText('Selection X');
      await user.clear(field);
      await user.type(field, '100{Enter}');
    },
    expect: (before, after) => {
      const moved = (document: ForgeDocument) =>
        document.scene.layers.filter((layer) => layer.id === 'lyr-a' || layer.id === 'lyr-d');
      expect(moved(after)[0]?.frame.x).not.toBe(moved(before)[0]?.frame.x);
    },
  },
  {
    name: 'resizing a group through the selection bounds',
    label: 'Resize 2 layers',
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      const field = screen.getByLabelText('Selection width');
      await user.clear(field);
      await user.type(field, '300{Enter}');
    },
    expect: (_before, after) => {
      // The union of the two selected layers is the box the new width describes.
      const box = unionRects(
        after.scene.layers
          .filter((layer) => layer.id === 'lyr-a' || layer.id === 'lyr-d')
          .map((layer) => layer.frame),
      );
      expect(box?.width).toBeCloseTo(300, 1);
    },
  },

  /* ---------------------------------------------------------------- artboard gestures */
  {
    name: 'moving a layer with a pointer drag',
    label: 'Move “Panel”',
    select: 'Panel',
    snapping: false,
    act: async () => {
      dragOnArtboard({ x: 100, y: 100 }, { x: 260, y: 180 });
    },
    expect: (_before, after) => {
      expect(frameOf(after, 'lyr-a')).toMatchObject({ x: 200, y: 120 });
    },
  },
  {
    name: 'resizing a layer from its handle',
    label: 'Resize “Panel”',
    select: 'Panel',
    snapping: false,
    act: async (user) => {
      const handle = screen.getByRole('button', { name: 'Resize bottom right' });
      await user.pointer([
        { target: handle, keys: '[MouseLeft>]', coords: { clientX: 240, clientY: 160 } },
        { coords: { clientX: 320, clientY: 220 } },
        { keys: '[/MouseLeft]' },
      ]);
    },
    expect: (before, after) => {
      expect(frameOf(after, 'lyr-a').width).toBeGreaterThan(frameOf(before, 'lyr-a').width);
    },
  },
  {
    name: 'moving a selection with the arrow keys',
    label: 'Move 2 layers',
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      fireEvent.keyDown(screen.getByTestId('artboard-surface'), { key: 'ArrowRight' });
      fireEvent.keyUp(screen.getByTestId('artboard-surface'), { key: 'ArrowRight' });
    },
    expect: (_before, after) => {
      expect(frameOf(after, 'lyr-a').x).toBe(41);
      expect(frameOf(after, 'lyr-d').x).toBe(601);
    },
  },

  /* ---------------------------------------------------------------- document inspector */
  {
    name: 'resizing the canvas',
    label: 'Resize canvas to 1200 × 1080 px',
    keys: ['canvas'],
    act: async (user) => {
      const field = screen.getByLabelText('Width');
      await user.clear(field);
      await user.type(field, '1200{Enter}');
    },
    expect: (_before, after) => {
      expect(after.canvas.width).toBe(1200);
    },
  },
  {
    name: 'changing the canvas background',
    label: 'Change background colour',
    keys: ['canvas'],
    act: async () => {
      fireEvent.change(screen.getByLabelText('Background colour'), {
        target: { value: '#101820' },
      });
    },
    expect: (_before, after) => {
      expect(after.canvas.background).toBe('#101820');
    },
  },
  {
    name: 'making the background transparent',
    label: 'Make background transparent',
    keys: ['canvas'],
    act: async (user) => {
      await user.click(screen.getByRole('switch', { name: 'Transparent background' }));
    },
    expect: (_before, after) => {
      expect(after.canvas.transparent).toBe(true);
    },
  },
  {
    name: 'switching the document unit',
    label: 'Switch units to mm',
    keys: ['canvas'],
    act: async (user) => {
      await user.selectOptions(screen.getByLabelText('Unit'), 'mm');
    },
  },
  {
    name: 'changing the safe margin',
    label: 'Safe margin set to 12 mm',
    keys: ['guides'],
    act: async (user) => {
      const field = screen.getByLabelText('Safe margin');
      await user.clear(field);
      await user.type(field, '12{Enter}');
    },
  },
  {
    name: 'turning the grid on',
    label: 'Show grid',
    keys: ['guides'],
    act: async (user) => {
      await user.click(screen.getByRole('switch', { name: 'Grid' }));
    },
  },
  {
    name: 'applying the print-ready guide defaults',
    label: 'Apply print-ready guide defaults',
    keys: ['guides'],
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: /apply print-ready defaults/i }));
    },
  },
  {
    name: 'adding a colour to the palette',
    label: 'Add #2b5fd9 to palette',
    keys: ['palette'],
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: /^Add$/ }));
    },
    expect: (_before, after) => {
      expect(after.palette).toContain('#2b5fd9');
    },
  },
  {
    name: 'renaming the project',
    label: 'Rename project',
    keys: ['title'],
    act: async (user) => {
      const field = screen.getByLabelText('Name');
      await user.clear(field);
      await user.type(field, 'Launch poster');
      await user.tab();
    },
    expect: (_before, after) => {
      expect(after.title).toBe('Launch poster');
    },
  },
  {
    name: 'changing the project status',
    label: 'Change project status',
    keys: ['status'],
    act: async (user) => {
      await user.selectOptions(screen.getByLabelText('Status'), 'ready');
    },
    expect: (_before, after) => {
      expect(after.status).toBe('ready');
    },
  },

  /* ---------------------------------------------------------------- the other half of a toggle */
  {
    name: 'showing a hidden layer from its row',
    label: 'Show “Panel”',
    scene: () => defaultScene({ hidden: true }),
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Show “Panel”' }));
    },
    expect: (_before, after) => {
      expect(after.scene.layers[0]?.visible).toBe(true);
    },
  },
  {
    name: 'unlocking a locked layer from its row',
    label: 'Unlock “Panel”',
    scene: lockedPanelScene,
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Unlock “Panel”' }));
    },
    expect: (_before, after) => {
      expect(after.scene.layers[0]?.locked).toBe(false);
    },
  },
  {
    name: 'hiding a multi-layer selection from the inspector',
    label: 'Hide 2 layers',
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      await user.click(screen.getByRole('switch', { name: 'Selection visible' }));
    },
    expect: (_before, after) => {
      expect(after.scene.layers.filter((layer) => layer.visible)).toHaveLength(2);
    },
  },
  {
    name: 'locking a multi-layer selection from the inspector',
    label: 'Lock 2 layers',
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      await user.click(screen.getByRole('switch', { name: 'Lock the selection' }));
    },
    expect: (_before, after) => {
      expect(after.scene.layers.filter((layer) => layer.locked)).toHaveLength(2);
    },
  },

  /* ---------------------------------------------------------------- the rest of the ordering controls */
  {
    name: 'sending a layer backward from its row',
    label: 'Send backward: “Footnote”',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Send “Footnote” backward' }));
    },
    expect: (_before, after) => {
      expect(namesOf(after)).toEqual(['Panel', 'Headline', 'Footnote', 'Aurora mesh']);
    },
  },
  {
    name: 'sending a layer to the back from its row',
    label: 'Send to back: “Footnote”',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Send “Footnote” to back' }));
    },
    expect: (_before, after) => {
      expect(namesOf(after)).toEqual(['Footnote', 'Panel', 'Headline', 'Aurora mesh']);
    },
  },
  {
    name: 'bringing a layer to the front from its row',
    label: 'Bring to front: “Panel”',
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Bring “Panel” to front' }));
    },
    expect: (_before, after) => {
      expect(namesOf(after)).toEqual(['Headline', 'Aurora mesh', 'Footnote', 'Panel']);
    },
  },
  {
    name: 'reordering a multi-layer selection from the inspector',
    label: 'Bring to front: 2 layers',
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      await user.click(screen.getByRole('button', { name: 'To front' }));
    },
    expect: (_before, after) => {
      // The group keeps its own order and lands on top of everything else.
      expect(namesOf(after)).toEqual(['Headline', 'Aurora mesh', 'Panel', 'Footnote']);
    },
  },

  /* ---------------------------------------------------------------- the rest of the frame fields */
  {
    name: 'changing a layer height with the size fields',
    label: 'Set “Panel” height to 200px',
    select: 'Panel',
    act: async (user) => {
      const field = screen.getByLabelText('Layer height');
      await user.clear(field);
      await user.type(field, '200{Enter}');
    },
    expect: (_before, after) => {
      expect(frameOf(after, 'lyr-a').height).toBe(200);
    },
  },
  {
    name: 'moving a group with the selection Y field',
    label: 'Move 2 layers',
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      const field = screen.getByLabelText('Selection Y');
      await user.clear(field);
      await user.type(field, '100{Enter}');
    },
    expect: (before, after) => {
      const selected = (document: ForgeDocument) =>
        document.scene.layers.filter((layer) => layer.id === 'lyr-a' || layer.id === 'lyr-d');
      expect(selected(after)[0]?.frame.y).not.toBe(selected(before)[0]?.frame.y);
      expect(selected(after)[0]?.frame.x).toBe(selected(before)[0]?.frame.x);
    },
  },
  {
    name: 'resizing a group with the selection height field',
    label: 'Resize 2 layers',
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      const field = screen.getByLabelText('Selection height');
      await user.clear(field);
      await user.type(field, '300{Enter}');
    },
    expect: (before, after) => {
      const box = (document: ForgeDocument) => {
        const frames = document.scene.layers
          .filter((layer) => layer.id === 'lyr-a' || layer.id === 'lyr-d')
          .map((layer) => layer.frame);
        const union = unionRects(frames);
        if (!union) throw new Error('the selection should have a bounding box');
        return union;
      };
      // A height field sets the height: the selection scales on that axis, exactly as dragging the
      // bottom edge would, and the width the person did not type is left alone.
      expect(box(after).height).toBeCloseTo(300, 1);
      expect(box(after).width).toBeCloseTo(box(before).width, 1);
    },
  },

  /* ---------------------------------------------------------------- removing what was set */
  {
    name: 'removing a shape fill',
    label: 'Remove “Panel” fill',
    select: 'Panel',
    act: async (user) => {
      await user.click(noneButton('Fill'));
    },
    expect: (_before, after) => {
      const panel = after.scene.layers[0];
      expect(panel?.type === 'rect' ? panel.shape.fill : null).toBeNull();
    },
  },
  {
    name: 'removing a stroke',
    label: 'Remove “Panel” stroke',
    scene: () => defaultScene({ stroked: true }),
    select: 'Panel',
    act: async (user) => {
      await user.click(noneButton('Stroke'));
    },
    expect: (_before, after) => {
      const panel = after.scene.layers[0];
      expect(panel?.type === 'rect' ? panel.shape.stroke : null).toBeNull();
    },
  },
  {
    name: 'removing a graphic tint',
    label: 'Remove “Aurora mesh” tint',
    scene: () => defaultScene({ tinted: true }),
    select: 'Aurora mesh',
    act: async (user) => {
      await user.click(noneButton('Tint'));
    },
    expect: (_before, after) => {
      const graphic = after.scene.layers[2];
      expect(graphic?.type === 'image' ? graphic.image.tint : '').toBeNull();
    },
  },

  /* ---------------------------------------------------------------- the artboard, the second way round */
  {
    name: 'dragging a two-layer selection across the canvas',
    label: 'Move 2 layers',
    snapping: false,
    act: async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
      dragOnArtboard({ x: 100, y: 100 }, { x: 220, y: 160 });
    },
    expect: (before, after) => {
      expect(frameOf(after, 'lyr-a').x).toBe(frameOf(before, 'lyr-a').x + 120);
      expect(frameOf(after, 'lyr-d').x).toBe(frameOf(before, 'lyr-d').x + 120);
    },
  },
  {
    name: 'resizing a layer with the keyboard from its handle',
    label: 'Resize “Panel”',
    select: 'Panel',
    snapping: false,
    act: async (user) => {
      const handle = screen.getByRole('button', { name: 'Resize bottom right' });
      await user.click(handle);
      fireEvent.keyDown(handle, { key: 'ArrowRight' });
      fireEvent.keyDown(handle, { key: 'ArrowDown' });
      fireEvent.keyUp(handle, { key: 'ArrowDown' });
    },
    expect: (before, after) => {
      expect(frameOf(after, 'lyr-a').width).toBeGreaterThan(frameOf(before, 'lyr-a').width);
    },
  },

  /* ---------------------------------------------------------------- canvas, guides, palette, details */
  {
    name: 'applying a canvas preset',
    label: 'Apply Portrait post preset',
    keys: ['canvas'],
    act: async (user) => {
      await user.selectOptions(screen.getByLabelText('Preset'), 'social.portrait');
    },
    expect: (_before, after) => {
      expect(after.canvas.height).toBe(1350);
    },
  },
  {
    name: 'changing the canvas height',
    label: 'Resize canvas to 1080 \u00d7 900 px',
    keys: ['canvas'],
    act: async (user) => {
      const field = screen.getByLabelText('Height');
      await user.clear(field);
      await user.type(field, '900{Enter}');
    },
    expect: (_before, after) => {
      expect(after.canvas.height).toBe(900);
    },
  },
  {
    name: 'changing the resolution',
    label: 'Set resolution to 300 dpi',
    keys: ['canvas'],
    act: async (user) => {
      const field = screen.getByLabelText('Resolution');
      await user.clear(field);
      await user.type(field, '300{Enter}');
    },
    expect: (_before, after) => {
      expect(after.canvas.dpi).toBe(300);
    },
  },
  {
    name: 'making the background opaque again',
    label: 'Add background colour',
    keys: ['canvas'],
    // The switch only means anything while the background is transparent, which is why the fixture
    // starts there.
    canvas: { ...SQUARE_CANVAS, transparent: true },
    act: async (user) => {
      await user.click(screen.getByRole('switch', { name: /transparent background/i }));
    },
    expect: (_before, after) => {
      expect(after.canvas.transparent).toBe(false);
    },
  },
  {
    name: 'changing the bleed',
    label: 'Bleed set to 3 mm',
    keys: ['guides'],
    act: async (user) => {
      const field = screen.getByLabelText('Bleed');
      await user.clear(field);
      await user.type(field, '3{Enter}');
    },
    expect: (_before, after) => {
      expect(after.guides.bleedMm).toBe(3);
    },
  },
  {
    name: 'changing the grid spacing',
    label: 'Grid spacing set to 20 mm',
    keys: ['guides'],
    act: async (user) => {
      const field = screen.getByLabelText('Grid spacing');
      await user.clear(field);
      await user.type(field, '20{Enter}');
    },
    expect: (_before, after) => {
      expect(after.guides.gridMm).toBe(20);
    },
  },
  {
    name: 'hiding the grid',
    label: 'Hide grid',
    keys: ['guides'],
    guides: { showGrid: true },
    act: async (user) => {
      await user.click(screen.getByRole('switch', { name: 'Grid' }));
    },
    expect: (_before, after) => {
      expect(after.guides.showGrid).toBe(false);
    },
  },
  {
    name: 'hiding the centre lines',
    label: 'Hide centre lines',
    keys: ['guides'],
    act: async (user) => {
      await user.click(screen.getByRole('switch', { name: 'Centre lines' }));
    },
    expect: (_before, after) => {
      expect(after.guides.showCentreLines).toBe(false);
    },
  },
  {
    name: 'removing a palette colour',
    label: 'Remove palette colour',
    keys: ['palette'],
    palette: ['#2b5fd9', '#ffd166'],
    act: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Remove #2b5fd9 from the palette' }));
    },
    expect: (_before, after) => {
      expect(after.palette).toEqual(['#ffd166']);
    },
  },
  {
    name: 'applying a sample palette',
    label: 'Apply palette “Graphite & Ember”',
    keys: ['palette'],
    palette: ['#123456'],
    act: async (user) => {
      await user.click(samplePaletteButton('Graphite & Ember'));
    },
    expect: (_before, after) => {
      expect(after.palette.length).toBeGreaterThan(1);
      expect(after.palette).not.toContain('#123456');
    },
  },
  {
    name: 'updating the project summary',
    label: 'Update summary',
    keys: ['summary'],
    act: async (user) => {
      const field = screen.getByLabelText('Summary');
      await user.type(field, 'Autumn season poster');
      await user.tab();
    },
    expect: (_before, after) => {
      expect(after.summary).toBe('Autumn season poster');
    },
  },
  {
    name: 'updating the project notes',
    label: 'Update notes',
    keys: ['metadata'],
    act: async (user) => {
      const field = screen.getByLabelText('Notes');
      await user.type(field, 'Print at 300 dpi.');
      await user.tab();
    },
    expect: (_before, after) => {
      expect(after.metadata.notes).toBe('Print at 300 dpi.');
    },
  },
  {
    name: 'updating the project tags',
    label: 'Update tags',
    keys: ['metadata'],
    act: async (user) => {
      const field = screen.getByLabelText('Tags');
      await user.type(field, 'poster, print');
      await user.tab();
    },
    expect: (_before, after) => {
      expect(after.metadata.tags).toEqual(['poster', 'print']);
    },
  },
];

describe('every control that changes the document is one labelled undo step', () => {
  it.each(ROWS.map((row) => [row.name, row] as const))('%s', async (_name, row) => {
    await checkRow(row);
  });

  it('covers the controls the workspace offers, not a sample of them', () => {
    // The matrix is the coverage claim: this fails if a row is dropped during a refactor.
    expect(ROWS.length).toBeGreaterThanOrEqual(73);
    expect(new Set(ROWS.map((row) => row.name)).size).toBe(ROWS.length);
    // Every row names the history entry it must produce, and no row may claim an empty one.
    expect(ROWS.filter((row) => row.label.trim().length === 0)).toEqual([]);
  });
});

describe('actions that are not document edits', () => {
  /** Runs an interaction that must leave both the document and the history exactly as they were. */
  async function expectNoEntry(
    name: string,
    act: (user: ReturnType<typeof userEvent.setup>) => Promise<void>,
    settled?: () => void | Promise<void>,
  ): Promise<void> {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    const before = contentOf(persisted(services));
    const revision = persisted(services).revision;

    await act(user);
    if (settled) await waitFor(settled);

    expect(contentOf(persisted(services)), `${name} must not change the document`).toBe(before);
    expect(persisted(services).revision, `${name} must not bump the revision`).toBe(revision);
    expect(historyLabels(), `${name} must not record a history entry`).toEqual([]);
    expect(undoButton()).toBeDisabled();
    expect(contentOf(savedDocument(services))).toBe(before);
  }

  it('selecting a layer, and adding to the selection', async () => {
    await expectNoEntry('selecting a layer', async (user) => {
      await user.click(selectRow('Panel'));
      fireEvent.click(selectRow('Footnote'), { shiftKey: true });
    });
  });

  it('clearing the selection by clicking empty canvas', async () => {
    await expectNoEntry('clicking empty space', async (user) => {
      await user.click(selectRow('Panel'));
      dragOnArtboard({ x: 900, y: 900 }, { x: 900, y: 900 });
    });
  });

  it('drawing a marquee over two layers', async () => {
    await expectNoEntry('drawing a marquee', async () => {
      dragOnArtboard({ x: 20, y: 20 }, { x: 760, y: 300 });
    });
  });

  it('changing the zoom', async () => {
    await expectNoEntry(
      'changing the zoom',
      async (user) => {
        await user.selectOptions(screen.getByLabelText('Zoom level'), '100');
      },
      () => {
        // `data-zoom` is the scale factor the artboard actually paints with.
        expect(screen.getByTestId('artboard')).toHaveAttribute('data-zoom', '1');
      },
    );
  });

  it('toggling snapping', async () => {
    await expectNoEntry(
      'toggling snapping',
      async (user) => {
        await user.click(screen.getByRole('button', { name: /^Snapping (on|off)$/ }));
      },
      () => {
        expect(screen.getByRole('button', { name: /^Snapping (on|off)$/ })).toHaveAttribute(
          'aria-pressed',
          'false',
        );
      },
    );
  });

  it('hiding the guides on the stage', async () => {
    await expectNoEntry(
      'hiding the guides',
      async (user) => {
        await user.click(screen.getByRole('button', { name: 'Hide guides' }));
      },
      () => {
        expect(screen.getByRole('button', { name: 'Show guides' })).toBeInTheDocument();
      },
    );
  });

  it('opening the export panel and changing its settings', async () => {
    await expectNoEntry('changing export settings', async (user) => {
      await user.selectOptions(screen.getByLabelText('Format', { exact: true }), 'jpg');
    });
  });

  it('typing a colour into the palette draft', async () => {
    // The swatch field and its hex box are local state until Add is pressed: choosing a colour is
    // not an edit, adding it to the document is.
    await expectNoEntry('typing a colour to add', async (user) => {
      const hex = screen.getByLabelText('Colour hex value');
      await user.clear(hex);
      await user.type(hex, '#ff00ff');
    });
  });
});

describe('refused, cancelled and unchanged actions leave no entry behind', () => {
  it('leaves nothing behind when an inspector value is rejected', async () => {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    await user.click(selectRow('Panel'));
    const before = contentOf(persisted(services));

    const field = screen.getByLabelText('Layer width');
    await user.clear(field);
    await user.type(field, '0{Enter}');

    // The field reports why, and nothing at all was committed: no entry, no revision bump.
    expect(await screen.findByRole('alert')).toHaveTextContent(/width/i);
    expect(contentOf(persisted(services))).toBe(before);
    expect(historyLabels()).toEqual([]);
    expect(undoButton()).toBeDisabled();
  });

  it('leaves nothing behind when a rename is left empty', async () => {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    await user.click(selectRow('Panel'));
    const before = contentOf(persisted(services));

    const field = screen.getByLabelText('Layer name');
    await user.clear(field);
    await user.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(/name/i);
    expect(contentOf(persisted(services))).toBe(before);
    expect(historyLabels()).toEqual([]);
  });

  it('leaves nothing behind when the value is typed but never changed', async () => {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    await user.click(selectRow('Panel'));
    const before = contentOf(persisted(services));

    const name = screen.getByLabelText('Layer name');
    await user.type(name, '{Enter}');
    const width = screen.getByLabelText('Layer width');
    await user.clear(width);
    await user.type(width, '200{Enter}');

    expect(contentOf(persisted(services))).toBe(before);
    expect(historyLabels()).toEqual([]);
    expect(undoButton()).toBeDisabled();
  });

  it('leaves nothing behind when a drag is cancelled with Escape', async () => {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    await user.click(selectRow('Panel'));
    const before = contentOf(persisted(services));

    const surface = screen.getByTestId('artboard-surface');
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(surface, { clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.keyDown(surface, { key: 'Escape' });
    fireEvent.pointerUp(surface, { clientX: 400, clientY: 400, pointerId: 1 });

    expect(contentOf(persisted(services))).toBe(before);
    expect(historyLabels()).toEqual([]);
    expect(undoButton()).toBeDisabled();
  });

  it('leaves nothing behind when the pointer never moves', async () => {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    await user.click(selectRow('Panel'));
    const before = contentOf(persisted(services));

    // A press and release in one place is a click: it selects, and records nothing.
    dragOnArtboard({ x: 100, y: 100 }, { x: 100, y: 100 });

    expect(contentOf(persisted(services))).toBe(before);
    expect(historyLabels()).toEqual([]);
    expect(undoButton()).toBeDisabled();

    // A drag with a sub-pixel delta is not an edit either.
    dragOnArtboard({ x: 100, y: 100 }, { x: 100.4, y: 100.4 });
    expect(contentOf(persisted(services))).toBe(before);
    expect(historyLabels()).toEqual([]);
  });
});

/**
 * Continuous interactions: one gesture is one step.
 *
 * A slider drag and a visit to a colour picker each fire a stream of changes, but a person made one
 * decision. These tests drive the same events the browser does — pointer press, several changes,
 * release; focus, several changes, blur — and check that the history records the decision once, with
 * the value it ended on, and that undo returns to where the gesture started rather than to the
 * middle of it. The pointer half of the same contract is in `e2e/workspace.spec.ts`, where a real
 * drag is delivered through the browser's own event pipeline.
 */
describe('a continuous interaction is one undoable step', () => {
  /** The events a slider drag produces: press, a stream of changes, release. */
  function dragSlider(values: readonly string[]): void {
    const slider = screen.getByLabelText('Layer opacity');
    fireEvent.pointerDown(slider);
    for (const value of values) fireEvent.change(slider, { target: { value } });
    fireEvent.pointerUp(slider);
  }

  /** A visit to a colour picker: focus, a stream of colours, blur. */
  function visitPicker(label: string, colors: readonly string[]): void {
    const picker = screen.getByLabelText(label);
    fireEvent.focus(picker);
    for (const color of colors) fireEvent.change(picker, { target: { value: color } });
    fireEvent.blur(picker);
  }

  it('records one entry for a whole slider drag, labelled with the value it ended on', async () => {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    await user.click(selectRow('Panel'));
    const before = contentOf(persisted(services));

    dragSlider(['80', '60', '40']);

    expect(historyLabels()).toEqual(['Set “Panel” opacity to 40%']);
    await waitFor(() => {
      expect(persisted(services).scene.layers[0]?.opacity).toBeCloseTo(0.4, 5);
    });
    // Every step of the drag was persisted, so nothing was lost while the entry was being rewritten.
    expect(contentOf(savedDocument(services))).toBe(contentOf(persisted(services)));

    await user.click(undoButton());
    await waitFor(() => {
      expect(contentOf(persisted(services))).toBe(before);
    });
    expect(historyLabels()).toEqual([]);
    expect(persisted(services).scene.layers[0]?.opacity).toBe(1);
  });

  it('keeps two separate drags as two steps', async () => {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    await user.click(selectRow('Panel'));
    const start = contentOf(persisted(services));

    dragSlider(['70']);
    await waitFor(() => {
      expect(persisted(services).scene.layers[0]?.opacity).toBeCloseTo(0.7, 5);
    });
    const afterFirst = contentOf(persisted(services));
    dragSlider(['30']);

    // Oldest first: the two drags are two steps, each named by the value it ended on.
    expect(historyLabels()).toEqual(['Set “Panel” opacity to 70%', 'Set “Panel” opacity to 30%']);

    // Undo steps back through the drags one at a time, not through every change either made.
    await user.click(undoButton());
    await waitFor(() => {
      expect(contentOf(persisted(services))).toBe(afterFirst);
    });
    await user.click(undoButton());
    await waitFor(() => {
      expect(contentOf(persisted(services))).toBe(start);
    });
    expect(undoButton()).toBeDisabled();
  });

  it('treats a keyboard step on the slider as its own step', async () => {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    await user.click(selectRow('Panel'));

    // Arrow keys fire a change without a pointer press: each press is a separate decision.
    const slider = screen.getByLabelText('Layer opacity');
    fireEvent.change(slider, { target: { value: '90' } });
    fireEvent.change(slider, { target: { value: '80' } });

    expect(historyLabels()).toEqual(['Set “Panel” opacity to 90%', 'Set “Panel” opacity to 80%']);
    await waitFor(() => {
      expect(contentOf(savedDocument(services))).toBe(contentOf(persisted(services)));
    });
  });

  it('records one entry for a whole visit to the colour picker', async () => {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    await user.click(selectRow('Headline'));
    const before = contentOf(persisted(services));

    visitPicker('Text colour colour picker', ['#ff0000', '#00ff00']);
    expect(historyLabels()).toEqual(['Set “Headline” text colour to #00ff00']);

    // A second visit is a second decision.
    visitPicker('Text colour colour picker', ['#0000ff']);
    expect(historyLabels()).toEqual([
      'Set “Headline” text colour to #00ff00',
      'Set “Headline” text colour to #0000ff',
    ]);

    await user.click(undoButton());
    await waitFor(() => {
      expect(historyLabels()).toEqual(['Set “Headline” text colour to #00ff00']);
    });
    await user.click(undoButton());
    await waitFor(() => {
      expect(contentOf(persisted(services))).toBe(before);
    });
  });

  it('records one entry for a whole visit to the canvas background picker', async () => {
    const { services } = await mountWorkspace();
    const user = userEvent.setup();
    const before = contentOf(persisted(services));

    visitPicker('Background colour', ['#101820', '#1d2433']);

    expect(historyLabels()).toEqual(['Change background colour']);
    await waitFor(() => {
      expect(persisted(services).canvas.background).toBe('#1d2433');
    });

    await user.click(undoButton());
    await waitFor(() => {
      expect(contentOf(persisted(services))).toBe(before);
    });
    expect(persisted(services).canvas.background).toBe(SQUARE_CANVAS.background);
  });
});
