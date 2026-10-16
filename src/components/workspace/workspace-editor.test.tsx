import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createRect } from '../../core/documents/geometry';
import { rectLayer, sceneOf, stackOf, textLayer } from '../../testing/layers';
import {
  clickOnArtboard,
  dragOnArtboard,
  expectSelected,
  historyLabels,
  layer,
  layerFrame,
  layerRows,
  mount,
  persisted,
  PORTRAIT_CANVAS,
  revision,
  selectRow,
} from '../../testing/workspace-harness';

describe('adding layers from the toolbar', () => {
  it('adds a text layer as a single labelled commit', async () => {
    const { services } = await mount();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Text' }));

    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(1);
    });
    expect(historyLabels()).toEqual(['Add text layer']);
    expect(persisted(services).scene.layers[0]?.type).toBe('text');
    // The artboard's accessible name counts what is really in the document.
    expect(screen.getByRole('img', { name: /1 layers/i })).toBeInTheDocument();
  });

  it('adds a rectangle and an ellipse, each with its own history step', async () => {
    const { services } = await mount();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rectangle' }));
    await waitFor(() => {
      expect(historyLabels()).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: 'Ellipse' }));
    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(2);
    });

    expect(historyLabels()).toEqual(['Add rectangle layer', 'Add ellipse layer']);
  });

  it('places a catalogue graphic with a click and records its attribution', async () => {
    const { services } = await mount();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Graphic' }));
    const placeButtons = await screen.findAllByRole('button', { name: /place on canvas/i });
    await user.click(placeButtons[0] as HTMLElement);

    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(1);
    });
    const placed = persisted(services).scene.layers[0];
    expect(placed?.type).toBe('image');
    expect(historyLabels()).toEqual([
      expect.stringMatching(/^Place graphic “/) as unknown as string,
    ]);
    expect(placed?.type === 'image' ? placed.image.assetId : null).not.toBeNull();
  });
});

describe('selecting and editing through the interface', () => {
  it('selects a layer from the list and renames it through the inspector', async () => {
    const { services } = await mount(sceneOf(rectLayer('lyr-a', { name: 'Panel' })));
    const user = userEvent.setup();

    await user.click(selectRow('Panel'));
    expectSelected('lyr-a');

    const nameField = screen.getByLabelText('Layer name');
    await user.clear(nameField);
    await user.type(nameField, 'Hero panel');
    await user.tab();

    await waitFor(() => {
      expect(layer(services, 'lyr-a').name).toBe('Hero panel');
    });
    expect(historyLabels()).toEqual(['Rename layer to “Hero panel”']);
  });

  it('hides, duplicates and deletes from the layer list, one commit each', async () => {
    const { services } = await mount(sceneOf(rectLayer('lyr-a', { name: 'Panel' })));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Hide “Panel”' }));
    await waitFor(() => {
      expect(layer(services, 'lyr-a').visible).toBe(false);
    });

    await user.click(screen.getByRole('button', { name: 'Duplicate “Panel”' }));
    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(2);
    });

    const copy = persisted(services).scene.layers.find((entry) => String(entry.id) !== 'lyr-a');
    expect(copy?.name).toBe('Panel copy');

    await user.click(screen.getByRole('button', { name: 'Delete “Panel copy”' }));
    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(1);
    });

    expect(historyLabels()).toEqual(['Hide “Panel”', 'Duplicate “Panel”', 'Delete “Panel copy”']);
  });

  it('reorders the stack and keeps the top of the list painting on top', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Bottom' }), rectLayer('lyr-b', { name: 'Top' })),
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Send “Top” backward' }));

    await waitFor(() => {
      expect(persisted(services).scene.layers.map((entry) => String(entry.id))).toEqual([
        'lyr-b',
        'lyr-a',
      ]);
    });
    expect(historyLabels()).toEqual(['Send backward: “Top”']);
  });

  it('operates the layer list from the keyboard', async () => {
    await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Bottom' }), rectLayer('lyr-b', { name: 'Top' })),
    );
    // One tab stop for the whole list: the roving button is the top row while nothing is selected.
    const firstButton = screen.getByTestId('layer-name-lyr-b');
    firstButton.focus();

    // The list is top-first, so ArrowDown steps down the stack.
    fireEvent.keyDown(firstButton, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('layer-name-lyr-a'));
    });

    fireEvent.keyDown(document.activeElement ?? firstButton, { key: 'ArrowUp' });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('layer-name-lyr-b'));
    });

    fireEvent.keyDown(document.activeElement ?? firstButton, { key: 'End' });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('layer-name-lyr-a'));
    });

    fireEvent.keyDown(document.activeElement ?? firstButton, { key: 'Home' });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('layer-name-lyr-b'));
    });

    // Every arrow step also selects, which is what makes the list usable from the keyboard alone.
    expectSelected('lyr-b');

    // Enter on a focused row selects it through the button's own native behaviour.
    fireEvent.keyDown(document.activeElement ?? firstButton, { key: 'ArrowDown' });
    await waitFor(() => {
      expectSelected('lyr-a');
    });
    await userEvent.setup().click(screen.getByTestId('layer-name-lyr-a'));
    await waitFor(() => {
      expectSelected('lyr-a');
    });
  });
});

describe('direct manipulation on the artboard', () => {
  it('moves a layer with a pointer drag and commits exactly once, on release', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 200 })),
      {
        snapping: false,
      },
    );
    const surface = screen.getByTestId('artboard-surface');

    fireEvent.pointerDown(surface, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(surface, { clientX: 240, clientY: 160, pointerId: 1 });
    // Mid-drag: the preview is transient and nothing has been written yet.
    expect(historyLabels()).toEqual([]);
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 200, 200));

    fireEvent.pointerUp(surface, { clientX: 240, clientY: 160, pointerId: 1 });

    await waitFor(() => {
      expect(layerFrame(services, 'lyr-a')).toEqual(createRect(140, 60, 200, 200));
    });
    expect(historyLabels()).toEqual(['Move “Panel”']);
  });

  it('drops a cancelled gesture without leaving a half-commit behind', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 200 })),
      {
        snapping: false,
      },
    );
    const surface = screen.getByTestId('artboard-surface');

    fireEvent.pointerDown(surface, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(surface, { clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.keyDown(surface, { key: 'Escape' });
    fireEvent.pointerUp(surface, { clientX: 400, clientY: 400, pointerId: 1 });

    expect(historyLabels()).toEqual([]);
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 200, 200));
    // The selection survives the cancellation: a dropped gesture leaves a selected layer, not a
    // cleared one, and the pointer-up that follows must not commit the preview either.
    await waitFor(() => {
      expectSelected('lyr-a');
    });
    expect(screen.getByLabelText('Layer name')).toHaveValue('Panel');
  });

  it('cancels an in-flight resize with Escape even when focus is not on the artboard', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 200 })),
      { snapping: false },
    );

    clickOnArtboard({ x: 200, y: 200 });
    await waitFor(() => {
      expectSelected('lyr-a');
    });

    // Grab a handle: focus is on the handle button, not on the capture surface, which is exactly
    // where a keyboard user ends up mid-resize.
    const handle = screen.getByRole('button', { name: 'Resize bottom right' });
    handle.focus();
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 380, clientY: 360, pointerId: 1 });
    // The listener is global, so the key press does not have to reach the artboard surface.
    fireEvent.keyDown(handle, { key: 'Escape' });
    fireEvent.pointerUp(handle, { clientX: 380, clientY: 360, pointerId: 1 });

    expect(historyLabels()).toEqual([]);
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 200, 200));
  });

  it('resizes through a visible handle, which is labelled and focusable', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 200 })),
      {
        snapping: false,
      },
    );

    // Select the layer first: handles only exist for a selection.
    dragOnArtboard({ x: 200, y: 200 }, { x: 200, y: 200 });
    const handle = screen.getByRole('button', { name: 'Resize bottom right' });
    expect(handle).toBeInTheDocument();

    fireEvent.pointerDown(handle, { clientX: 300, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 350, clientY: 330, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 350, clientY: 330, pointerId: 1 });

    await waitFor(() => {
      expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 250, 230));
    });
    expect(historyLabels()).toEqual(['Resize “Panel”']);
  });

  it('selects a single layer with a plain click, and only that layer', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 100, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 300, y: 300, width: 100, height: 100 }),
      ),
      { snapping: false },
    );
    const before = revision(services);

    clickOnArtboard({ x: 150, y: 150 });

    await waitFor(() => {
      expectSelected('lyr-a');
    });
    expectSelected('lyr-b', false);
    // Selecting is transient: no history entry, no document revision, nothing to save.
    expect(historyLabels()).toEqual([]);
    expect(revision(services)).toBe(before);
  });

  it('adds an unselected layer with a modifier click and removes a selected one', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 100, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 300, y: 300, width: 100, height: 100 }),
      ),
      { snapping: false },
    );
    const before = revision(services);

    clickOnArtboard({ x: 150, y: 150 });
    await waitFor(() => {
      expectSelected('lyr-a');
    });

    // Shift-click adds the second layer without moving anything.
    clickOnArtboard({ x: 350, y: 350 }, { modifier: 'shift' });
    await waitFor(() => {
      expectSelected('lyr-b');
    });
    expectSelected('lyr-a');

    // Shift-clicking an already-selected layer removes it again.
    clickOnArtboard({ x: 350, y: 350 }, { modifier: 'shift' });
    await waitFor(() => {
      expectSelected('lyr-b', false);
    });
    expectSelected('lyr-a');

    expect(historyLabels()).toEqual([]);
    expect(revision(services)).toBe(before);
  });

  it('extends the selection with an additive marquee, and replaces it with a plain one', async () => {
    await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 40, y: 40, width: 80, height: 80 }),
        rectLayer('lyr-b', { name: 'B', x: 300, y: 300, width: 80, height: 80 }),
      ),
      { snapping: false },
    );

    clickOnArtboard({ x: 80, y: 80 });
    await waitFor(() => {
      expectSelected('lyr-a');
    });

    // An additive marquee unions the covered layers with what was already selected.
    dragOnArtboard({ x: 250, y: 250 }, { x: 450, y: 450 }, { modifier: 'shift' });
    await waitFor(() => {
      expectSelected('lyr-b');
    });
    expectSelected('lyr-a');

    // A plain marquee replaces the selection outright.
    dragOnArtboard({ x: 250, y: 250 }, { x: 450, y: 450 });
    await waitFor(() => {
      expectSelected('lyr-a', false);
    });
    expectSelected('lyr-b');
  });

  it('clears the selection with a click on empty space, unless a modifier is held', async () => {
    await mount(
      sceneOf(rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 100, height: 100 })),
      { snapping: false },
    );

    clickOnArtboard({ x: 150, y: 150 });
    await waitFor(() => {
      expectSelected('lyr-a');
    });

    // A modified click on empty space leaves the selection alone...
    clickOnArtboard({ x: 800, y: 800 }, { modifier: 'shift' });
    expectSelected('lyr-a');

    // ...and a plain one clears it.
    clickOnArtboard({ x: 800, y: 800 });
    await waitFor(() => {
      expectSelected('lyr-a', false);
    });
  });

  it('moves the whole selected group, not just the layer under the pointer', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 100, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 300, y: 300, width: 100, height: 100 }),
      ),
      { snapping: false },
    );

    dragOnArtboard({ x: 40, y: 40 }, { x: 500, y: 500 });
    await waitFor(() => {
      expectSelected('lyr-b');
    });
    expectSelected('lyr-a');

    // Dragging a member of the selection moves every selected layer by the same delta.
    dragOnArtboard({ x: 150, y: 150 }, { x: 190, y: 170 });

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Move 2 layers']);
    });
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(140, 120, 100, 100));
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(340, 320, 100, 100));

    // Clicking a member without dragging collapses to it instead of moving the group.
    clickOnArtboard({ x: 150, y: 150 });
    await waitFor(() => {
      expectSelected('lyr-b', false);
    });
    expectSelected('lyr-a');
    expect(historyLabels()).toEqual(['Move 2 layers']);
  });

  it('drags an unselected layer alone, without carrying the old selection with it', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 100, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 400, y: 300, width: 100, height: 100 }),
      ),
      { snapping: false },
    );

    // Select A, so the press below replaces a real selection rather than adding to nothing.
    clickOnArtboard({ x: 150, y: 150 });
    await waitFor(() => {
      expectSelected('lyr-a');
    });
    const revisionBefore = revision(services);

    // Drag B, which was not selected: the selection becomes B alone, so only B may move.
    dragOnArtboard({ x: 450, y: 350 }, { x: 490, y: 320 });

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Move “B”']);
    });
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(440, 270, 100, 100));
    // A is untouched - not moved by the same delta, not resized.
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 100, 100));
    expectSelected('lyr-b');
    expectSelected('lyr-a', false);
    // One interaction, one commit, one revision step.
    expect(historyLabels()).toHaveLength(1);
    expect(revision(services)).toBe(revisionBefore + 1);
  });

  it('selects a layer on a plain click without editing the document', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 100, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 400, y: 300, width: 100, height: 100 }),
      ),
      { snapping: false },
    );

    clickOnArtboard({ x: 150, y: 150 });
    await waitFor(() => {
      expectSelected('lyr-a');
    });
    const revisionBefore = revision(services);

    // A press and release on an unselected layer, with no movement: a selection change, not an edit.
    clickOnArtboard({ x: 450, y: 350 });
    await waitFor(() => {
      expectSelected('lyr-b');
    });

    expectSelected('lyr-a', false);
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(400, 300, 100, 100));
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 100, 100));
    expect(revision(services)).toBe(revisionBefore);
    expect(historyLabels()).toEqual([]);
  });

  it('resizes every selected layer from one bounding-box handle, in one commit', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 200, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 400, y: 250, width: 100, height: 50 }),
      ),
      { snapping: false },
    );

    // Select both layers; the union box is 400 x 200 at (100, 100).
    dragOnArtboard({ x: 40, y: 40 }, { x: 600, y: 400 });
    await waitFor(() => {
      expectSelected('lyr-b');
    });

    const handle = screen.getByRole('button', { name: 'Resize bottom right' });
    // Drag the corner by 200 across and 100 down: the box becomes 600 x 300.
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 700, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 700, clientY: 400, pointerId: 1 });

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Resize 2 layers']);
    });
    // Both layers scaled by 1.5 about the box's top-left corner; arrangement preserved.
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 300, 150));
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(550, 325, 150, 75));

    // Undo restores the entire group, not one object.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^undo$/i }));
    await waitFor(() => {
      expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 200, 100));
    });
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(400, 250, 100, 50));
    expect(historyLabels()).toEqual([]);
  });

  it('drops a cancelled group resize without moving either layer', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 200, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 400, y: 250, width: 100, height: 50 }),
      ),
      { snapping: false },
    );

    dragOnArtboard({ x: 40, y: 40 }, { x: 600, y: 400 });
    const handle = screen.getByRole('button', { name: 'Resize bottom right' });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 800, clientY: 500, pointerId: 1 });
    fireEvent.keyDown(screen.getByTestId('artboard-surface'), { key: 'Escape' });
    fireEvent.pointerUp(handle, { clientX: 800, clientY: 500, pointerId: 1 });

    expect(historyLabels()).toEqual([]);
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 200, 100));
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(400, 250, 100, 50));
  });

  it('selects several layers with a marquee over empty space', async () => {
    await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 100, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 300, y: 300, width: 100, height: 100 }),
      ),
      { snapping: false },
    );

    dragOnArtboard({ x: 40, y: 40 }, { x: 500, y: 500 });

    await waitFor(() => {
      expectSelected('lyr-a');
    });
    expectSelected('lyr-b');
  });
});

describe('a thirty-layer document', () => {
  it('mounts, reports every layer and paints into a single canvas element', async () => {
    const { services } = await mount(stackOf(30));

    expect(screen.getByRole('img', { name: /30 layers/i })).toBeInTheDocument();
    expect(screen.getAllByTestId('document-canvas')).toHaveLength(1);
    expect(layerRows()).toHaveLength(30);
    // Loading a document is not an edit: history starts empty.
    expect(historyLabels()).toEqual([]);
    expect(persisted(services).scene.layers).toHaveLength(30);
  });

  it('selects the whole stack with a marquee and moves it in one commit', async () => {
    const { services } = await mount(stackOf(30), { snapping: false });
    const before = persisted(services).scene.layers.map((entry) => entry.frame.x);

    // Every stack layer sits inside the top-left 320x280 region, so a marquee over it selects all 30.
    dragOnArtboard({ x: 350, y: 350 }, { x: 10, y: 10 });
    await waitFor(() => {
      expectSelected('lyr-stack-0');
    });
    expect(historyLabels()).toEqual([]);

    // Dragging one of the selected layers moves the whole selection.
    dragOnArtboard({ x: 250, y: 200 }, { x: 300, y: 230 });

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Move 30 layers']);
    });

    const after = persisted(services).scene.layers.map((entry) => entry.frame.x);
    const deltas = new Set(after.map((value, index) => value - (before[index] ?? 0)));
    // One snapped delta for the whole selection: the stack keeps its internal spacing.
    expect(deltas.size).toBe(1);
  });
});

describe('text layers', () => {
  it('edits content and typography through the inspector', async () => {
    const { services } = await mount(sceneOf(textLayer('lyr-t', { name: 'Headline' })));
    const user = userEvent.setup();

    await user.click(selectRow('Headline'));
    const content = screen.getByRole('textbox', { name: /content/i });
    await user.clear(content);
    await user.type(content, 'Launch night');
    await user.tab();

    await waitFor(() => {
      const stored = layer(services, 'lyr-t');
      expect(stored.type === 'text' ? stored.text.content : '').toBe('Launch night');
    });

    const size = screen.getByLabelText(/^size/i);
    await user.clear(size);
    await user.type(size, '96');
    await user.tab();

    await waitFor(() => {
      const stored = layer(services, 'lyr-t');
      expect(stored.type === 'text' ? stored.text.fontSize : 0).toBe(96);
    });

    expect(historyLabels()).toEqual([
      'Edit text in “Headline”',
      'Set “Headline” font size to 96px',
    ]);
  });

  it('refuses an out-of-range size and says so instead of saving it', async () => {
    await mount(sceneOf(textLayer('lyr-t', { name: 'Headline' })));
    const user = userEvent.setup();

    await user.click(selectRow('Headline'));
    const size = screen.getByLabelText(/^size/i);
    await user.clear(size);
    await user.type(size, '9000');
    await user.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(/4 and 800/i);
    expect(historyLabels()).toEqual([]);
  });
});

describe('portrait and landscape documents', () => {
  /**
   * The same two objects on an upright 9:16 canvas. Nothing in a transform may depend on the canvas
   * being square, and a resize must never re-shape the document itself.
   */
  const portraitScene = () =>
    sceneOf(
      rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 200, height: 100 }),
      rectLayer('lyr-b', { name: 'B', x: 400, y: 250, width: 100, height: 50 }),
    );

  it('resizes a group on a portrait canvas and leaves the canvas alone', async () => {
    const { services } = await mount(portraitScene(), {
      snapping: false,
      canvas: PORTRAIT_CANVAS,
    });

    const artboard = screen.getByTestId('artboard');
    expect(artboard).toHaveAttribute('data-canvas-width', '900');
    expect(artboard).toHaveAttribute('data-canvas-height', '1600');
    expect(artboard.style.width).toBe('900px');
    expect(artboard.style.height).toBe('1600px');

    // Select both layers: the union box is 400 x 200 at (100, 100).
    dragOnArtboard({ x: 40, y: 40 }, { x: 600, y: 400 });
    await waitFor(() => {
      expectSelected('lyr-b');
    });

    const handle = screen.getByRole('button', { name: 'Resize bottom right' });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 700, clientY: 340, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 700, clientY: 340, pointerId: 1 });

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Resize 2 layers']);
    });
    // 400 x 200 grew to 600 x 240: both layers scaled by 1.5 across and 1.2 down about (100, 100).
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 300, 120));
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(550, 280, 150, 60));
    // The document is still the portrait canvas: the gesture touched layers, not the artboard.
    expect(persisted(services).canvas).toEqual(PORTRAIT_CANVAS);
    expect(artboard.style.height).toBe('1600px');
  });

  it('snaps a group resize to the canvas centre line, in one commit', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 200, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 400, y: 250, width: 100, height: 50 }),
      ),
      { snapping: true },
    );

    dragOnArtboard({ x: 40, y: 40 }, { x: 600, y: 400 });
    await waitFor(() => {
      expectSelected('lyr-b');
    });

    const handle = screen.getByRole('button', { name: 'Resize bottom right' });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 300, pointerId: 1, button: 0 });
    // Two pixels past the 1080px canvas's 540px centre line, and clear of every grid line on the
    // other axis, so only the horizontal snap can fire.
    fireEvent.pointerMove(handle, { clientX: 542, clientY: 320, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 542, clientY: 320, pointerId: 1 });

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Resize 2 layers']);
    });
    // The right edge landed on 540, so the box is 440 x 220: both layers grew by the same 1.1 factor
    // about (100, 100), which is what keeps their arrangement intact.
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 220, 110));
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(430, 265, 110, 55));
  });

  it('moves a layer by a short drag instead of snapping it back where it started', async () => {
    // The layer sits where none of its own edges - moved or not - is within the six-pixel snap
    // threshold of a guide, a grid line or the other layer, so the drag below could only change the
    // frame by exactly the pointer delta.
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 22, y: 914, width: 60, height: 40 }),
        rectLayer('lyr-b', { name: 'B', x: 400, y: 250, width: 100, height: 50 }),
      ),
      { snapping: true },
    );

    clickOnArtboard({ x: 52, y: 934 });
    await waitFor(() => {
      expectSelected('lyr-a');
    });
    expect(historyLabels()).toEqual([]);

    dragOnArtboard({ x: 52, y: 934 }, { x: 55, y: 936 });

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Move \u201cA\u201d']);
    });
    // Three pixels across and two down: the frame the gesture is leaving is not a snap target, so a
    // short drag is not pulled back onto it.
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(25, 916, 60, 40));
  });
});

describe('locked layers on the artboard', () => {
  const lockedScene = () =>
    sceneOf(
      rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 200, height: 100 }),
      rectLayer('lyr-b', { name: 'B', x: 400, y: 250, width: 100, height: 50 }),
    );

  it('does not move a locked layer when a gesture starts on it', async () => {
    const { services } = await mount(lockedScene(), { snapping: false });
    const user = userEvent.setup();

    // Lock through the interface, exactly as a user would.
    await user.click(selectRow('B'));
    await user.click(screen.getByRole('switch', { name: /lock this layer/i }));
    await waitFor(() => {
      expect(layer(services, 'lyr-b').locked).toBe(true);
    });
    expect(historyLabels()).toEqual(['Lock “B”']);

    // A drag that starts on the locked layer picks nothing, moves nothing and clears nothing.
    dragOnArtboard({ x: 450, y: 275 }, { x: 520, y: 300 });

    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(400, 250, 100, 50));
    expect(historyLabels()).toEqual(['Lock “B”']);
    // The selection is undisturbed rather than being replaced by something untransformable.
    expectSelected('lyr-b');
    // And the surface explains itself instead of silently doing nothing.
    clickOnArtboard({ x: 450, y: 275 });
    expect(screen.getByTestId('artboard-surface')).toHaveAttribute(
      'title',
      expect.stringMatching(/locked/i),
    );
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(400, 250, 100, 50));
  });

  it('excludes a locked layer from a group move and from the resize box', async () => {
    const { services } = await mount(lockedScene(), { snapping: false });
    const user = userEvent.setup();

    await user.click(selectRow('B'));
    await user.click(screen.getByRole('switch', { name: /lock this layer/i }));
    await waitFor(() => {
      expect(layer(services, 'lyr-b').locked).toBe(true);
    });

    // Select both: the locked layer is selected, but a marquee cannot pick it up, so add it from
    // the list instead — which is exactly the case the review asked about.
    clickOnArtboard({ x: 200, y: 150 });
    await user.click(screen.getByTestId('layer-name-lyr-b'));
    await waitFor(() => {
      expectSelected('lyr-b');
    });
    expectSelected('lyr-a', false);

    // Shift-clicking A in the list adds it, giving a selection that mixes locked and unlocked.
    fireEvent.click(screen.getByTestId('layer-name-lyr-a'), { shiftKey: true });
    await waitFor(() => {
      expectSelected('lyr-a');
    });

    // Moving the group must move only the unlocked layer.
    dragOnArtboard({ x: 200, y: 150 }, { x: 260, y: 200 });
    await waitFor(() => {
      expect(historyLabels()).toContain('Move “A”');
    });
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(160, 150, 200, 100));
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(400, 250, 100, 50));

    // The handles describe only the transformable part, so there is no handle that promises more.
    const before = layerFrame(services, 'lyr-b');
    const handle = screen.getByRole('button', { name: 'Resize bottom right' });
    fireEvent.pointerDown(handle, { clientX: 360, clientY: 250, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 460, clientY: 350, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 460, clientY: 350, pointerId: 1 });
    await waitFor(() => {
      expect(layerFrame(services, 'lyr-a')).not.toEqual(createRect(160, 150, 200, 100));
    });
    expect(layerFrame(services, 'lyr-b')).toEqual(before);
  });

  it('draws the handles around what can actually be transformed, not the whole selection', async () => {
    const { services } = await mount(lockedScene(), { snapping: false });
    const user = userEvent.setup();

    // Lock B, then select both layers from the list: the selection is two layers, but only A can move.
    await user.click(selectRow('B'));
    await user.click(screen.getByRole('switch', { name: /lock this layer/i }));
    await waitFor(() => {
      expect(layer(services, 'lyr-b').locked).toBe(true);
    });
    await user.click(selectRow('A'));
    await waitFor(() => {
      expectSelected('lyr-a');
    });
    fireEvent.click(selectRow('B'), { shiftKey: true });
    await waitFor(() => {
      expectSelected('lyr-b');
    });

    // The handle box is A's own frame (100,100 200x100), not the union with the locked layer.
    expect(screen.getByTestId('selection-bounds-label')).toHaveTextContent(
      'Selection bounds 100, 100, 200 by 100 document pixels at 100 percent zoom.',
    );
    // The locked layer is still visibly selected, and the rail says it is being left out.
    expect(screen.getByTestId('selection-overlay')).toBeInTheDocument();
    expect(screen.getByText(/1 selected layer is locked and left untouched/i)).toBeInTheDocument();
  });

  it('offers no resize handles when every selected layer is locked', async () => {
    const { services } = await mount(lockedScene(), { snapping: false });
    const user = userEvent.setup();

    // Lock both, selecting the pair from the layer list, as the review's case describes.
    await user.click(selectRow('A'));
    await user.click(screen.getByRole('switch', { name: /lock this layer/i }));
    await user.click(selectRow('B'));
    await user.click(screen.getByRole('switch', { name: /lock this layer/i }));
    await waitFor(() => {
      expect(layer(services, 'lyr-a').locked).toBe(true);
    });
    expect(layer(services, 'lyr-b').locked).toBe(true);

    expect(screen.queryByRole('button', { name: 'Resize bottom right' })).not.toBeInTheDocument();
    expect(screen.getByTestId('selection-locked-note')).toHaveTextContent(
      /every selected layer is locked/i,
    );
    // The locked layers are still visibly selected, and the inspector says why they cannot move.
    expect(screen.getByTestId('selection-overlay')).toBeInTheDocument();
    expect(screen.getByText(/Every selected layer is locked/i)).toBeInTheDocument();
  });
});

describe('bulk operations from the inspector', () => {
  const twoLayers = () =>
    sceneOf(
      rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 100, height: 100 }),
      rectLayer('lyr-b', { name: 'B', x: 300, y: 300, width: 100, height: 100 }),
    );

  async function selectBoth(): Promise<void> {
    dragOnArtboard({ x: 40, y: 40 }, { x: 500, y: 500 });
    await waitFor(() => {
      expectSelected('lyr-b');
    });
    expectSelected('lyr-a');
  }

  it('duplicates the whole selection in one commit', async () => {
    const { services } = await mount(twoLayers(), { snapping: false });
    const user = userEvent.setup();
    await selectBoth();

    await user.click(screen.getByRole('button', { name: 'Duplicate selection' }));

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Duplicate 2 layers']);
    });
    expect(persisted(services).scene.layers.map((entry) => entry.name)).toEqual([
      'A',
      'A copy',
      'B',
      'B copy',
    ]);

    await user.click(screen.getByRole('button', { name: /^undo$/i }));
    await waitFor(() => {
      expect(persisted(services).scene.layers).toHaveLength(2);
    });
    expect(historyLabels()).toEqual([]);
  });

  it('brings a multi-layer selection forward without losing a layer', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A' }),
        rectLayer('lyr-b', { name: 'B' }),
        rectLayer('lyr-c', { name: 'C' }),
      ),
      { snapping: false },
    );
    const user = userEvent.setup();

    await user.click(selectRow('A'));
    await waitFor(() => {
      expectSelected('lyr-a');
    });
    fireEvent.click(selectRow('B'), { shiftKey: true });
    await waitFor(() => {
      expectSelected('lyr-b');
    });

    await user.click(screen.getByRole('button', { name: 'Bring forward' }));

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Bring forward: 2 layers']);
    });
    // Both layers moved up one slot and kept their relative order; C was untouched.
    expect(persisted(services).scene.layers.map((entry) => entry.name)).toEqual(['C', 'A', 'B']);
  });

  it('sets opacity for the whole selection in one step', async () => {
    const { services } = await mount(twoLayers(), { snapping: false });
    await selectBoth();

    fireEvent.change(screen.getByLabelText('Layer opacity'), { target: { value: '40' } });

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Set opacity of 2 layers to 40%']);
    });
    expect(persisted(services).scene.layers.map((entry) => entry.opacity)).toEqual([0.4, 0.4]);
  });

  it('hides the whole selection in one step and shows it again', async () => {
    const { services } = await mount(twoLayers(), { snapping: false });
    const user = userEvent.setup();
    await selectBoth();

    await user.click(screen.getByRole('switch', { name: /selection visible/i }));

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Hide 2 layers']);
    });
    expect(persisted(services).scene.layers.every((entry) => !entry.visible)).toBe(true);
  });

  it('moves the selection with the inspector bounds fields, without a pointer', async () => {
    const { services } = await mount(twoLayers(), { snapping: false });
    const user = userEvent.setup();
    await selectBoth();

    const x = screen.getByLabelText('Selection X');
    await user.clear(x);
    await user.type(x, '0');
    await user.tab();

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Move 2 layers']);
    });
    // Relative arrangement preserved: A moved 100 left, B moved 100 left as well.
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(0, 100, 100, 100));
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(200, 300, 100, 100));
  });

  it('resizes the whole selection by typing group bounds, without a pointer', async () => {
    const { services } = await mount(twoLayers(), { snapping: false });
    const user = userEvent.setup();
    await selectBoth();

    // The union box is 300 x 300 at (100, 100): a typed width scales both layers about its corner.
    const width = screen.getByLabelText('Selection width');
    await user.clear(width);
    await user.type(width, '600');
    await user.tab();

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Resize 2 layers']);
    });
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 200, 100));
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(500, 300, 200, 100));

    // And a typed height is its own single commit, not a second write into the same patch.
    const height = screen.getByLabelText('Selection height');
    await user.clear(height);
    await user.type(height, '450');
    await user.tab();

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Resize 2 layers', 'Resize 2 layers']);
    });
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 200, 150));
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(500, 400, 200, 150));
  });
});

describe('keyboard-only editing', () => {
  it('walks the layer list, then edits the selected layer through the inspector', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 100 })),
      { snapping: false },
    );
    const user = userEvent.setup();

    // Reach the list with the keyboard: the roving tab stop is the only way in.
    const name = screen.getByTestId('layer-name-lyr-a');
    expect(name).toHaveAttribute('tabindex', '0');
    name.focus();
    expect(document.activeElement).toBe(name);

    // Enter activates the focused row through the button's native behaviour.
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expectSelected('lyr-a');
    });

    // Then resize it by typing, which needs no pointer at all.
    const width = screen.getByLabelText('Layer width');
    await user.clear(width);
    await user.type(width, '260');
    await user.tab();

    await waitFor(() => {
      expect(layerFrame(services, 'lyr-a').width).toBe(260);
    });
    expect(historyLabels()).toEqual(['Set “Panel” width to 260px']);
  });

  it('reaches every enabled layer operation by Tab, and skips the disabled ones', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'Bottom' }),
        rectLayer('lyr-b', { name: 'Middle' }),
        rectLayer('lyr-c', { name: 'Top' }),
      ),
      { snapping: false },
    );
    const user = userEvent.setup();

    // The middle layer can move in either direction, so every operation is live.
    await user.click(selectRow('Middle'));
    screen.getByTestId('layer-name-lyr-b').focus();

    const reachable: string[] = [];
    for (let step = 0; step < 7; step += 1) {
      await user.tab();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) {
        reachable.push(focused.getAttribute('aria-label') ?? focused.textContent?.trim() ?? '?');
      }
    }
    expect(reachable).toEqual([
      'Rename \u201cMiddle\u201d',
      'Bring \u201cMiddle\u201d forward',
      'Send \u201cMiddle\u201d backward',
      'Bring \u201cMiddle\u201d to front',
      'Send \u201cMiddle\u201d to back',
      'Duplicate \u201cMiddle\u201d',
      'Delete \u201cMiddle\u201d',
    ]);

    // Tab backwards to "Send to back" and press Enter: the focused control performs it, exactly as
    // a click would.
    for (let step = 0; step < 2; step += 1) await user.tab({ shift: true });
    expect(document.activeElement).toHaveAccessibleName('Send \u201cMiddle\u201d to back');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(persisted(services).scene.layers.map((layer) => layer.name)).toEqual([
        'Middle',
        'Bottom',
        'Top',
      ]);
    });
    expect(historyLabels()).toEqual(['Send to back: \u201cMiddle\u201d']);
  });

  it('leaves a control that cannot act unfocusable rather than silently inert', async () => {
    await mount(sceneOf(rectLayer('lyr-a', { name: 'Only' })), { snapping: false });
    const user = userEvent.setup();
    await user.click(selectRow('Only'));

    // A single layer can neither move up nor down, so those buttons are disabled and Tab skips
    // them: a keyboard user cannot land on a control that would do nothing.
    for (const label of [
      'Bring \u201cOnly\u201d forward',
      'Send \u201cOnly\u201d backward',
      'Bring \u201cOnly\u201d to front',
      'Send \u201cOnly\u201d to back',
    ]) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      button.focus();
      expect(document.activeElement).not.toBe(button);
    }

    // Duplicate and delete still work, so they stay reachable.
    expect(screen.getByRole('button', { name: 'Duplicate \u201cOnly\u201d' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete \u201cOnly\u201d' })).toBeEnabled();
  });

  it('nudges the selection with the arrow keys on the artboard surface', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 100 })),
      { snapping: false },
    );
    const surface = screen.getByTestId('artboard-surface');

    clickOnArtboard({ x: 200, y: 150 });
    await waitFor(() => {
      expectSelected('lyr-a');
    });

    surface.focus();
    fireEvent.keyDown(surface, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(layerFrame(services, 'lyr-a').x).toBe(101);
    });
    fireEvent.keyDown(surface, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => {
      expect(layerFrame(services, 'lyr-a').y).toBe(110);
    });

    expect(historyLabels()).toEqual(['Move “Panel”', 'Move “Panel”']);
  });

  it('clears the selection with Escape when nothing is in progress', async () => {
    await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 100 })),
      { snapping: false },
    );
    const surface = screen.getByTestId('artboard-surface');

    clickOnArtboard({ x: 200, y: 150 });
    await waitFor(() => {
      expectSelected('lyr-a');
    });

    fireEvent.keyDown(surface, { key: 'Escape' });
    await waitFor(() => {
      expectSelected('lyr-a', false);
    });
    expect(historyLabels()).toEqual([]);
  });

  it('resizes from a focused handle with the arrow keys, one commit on release', async () => {
    const { services } = await mount(
      sceneOf(rectLayer('lyr-a', { name: 'Panel', x: 100, y: 100, width: 200, height: 200 })),
      { snapping: false },
    );

    clickOnArtboard({ x: 200, y: 200 });
    await waitFor(() => {
      expectSelected('lyr-a');
    });

    // The handle is a real button in the tab order, so a keyboard user can land on it.
    const handle = screen.getByRole('button', { name: 'Resize bottom right' });
    handle.focus();
    expect(document.activeElement).toBe(handle);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    // Mid-resize: a preview only, and the surface's own arrow-key nudge did not also fire.
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 200, 200));
    expect(historyLabels()).toEqual([]);

    fireEvent.keyUp(handle, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 202, 200));
    });
    expect(historyLabels()).toEqual(['Resize “Panel”']);

    // Shift steps ten pixels at a time, and Escape abandons the resize without a commit.
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(handle, { key: 'Escape' });
    fireEvent.keyUp(handle, { key: 'ArrowDown', shiftKey: true });

    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 202, 200));
    expect(historyLabels()).toEqual(['Resize “Panel”']);
  });

  it('resizes a whole selection from the keyboard and keeps the arrangement', async () => {
    const { services } = await mount(
      sceneOf(
        rectLayer('lyr-a', { name: 'A', x: 100, y: 100, width: 200, height: 100 }),
        rectLayer('lyr-b', { name: 'B', x: 400, y: 250, width: 100, height: 50 }),
      ),
      { snapping: false },
    );

    dragOnArtboard({ x: 40, y: 40 }, { x: 600, y: 400 });
    await waitFor(() => {
      expectSelected('lyr-b');
    });

    const handle = screen.getByRole('button', { name: 'Resize bottom right' });
    handle.focus();
    // Ten ten-pixel presses of ArrowRight: the 400px box grows by 100, so both layers scale by 1.25.
    for (let press = 0; press < 10; press += 1) {
      fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    }
    fireEvent.keyUp(handle, { key: 'ArrowRight', shiftKey: true });

    await waitFor(() => {
      expect(historyLabels()).toEqual(['Resize 2 layers']);
    });
    expect(layerFrame(services, 'lyr-a')).toEqual(createRect(100, 100, 250, 100));
    expect(layerFrame(services, 'lyr-b')).toEqual(createRect(475, 250, 125, 50));
  });
});
