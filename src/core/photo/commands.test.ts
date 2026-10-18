/**
 * Photo commands: every photo edit is one labelled, undoable document patch.
 *
 * The tests check the payload that would be saved, the label a person sees in history, and the
 * refusals — not the React components.
 */

import { describe, expect, it } from 'vitest';

import { createDocument, DEFAULT_CANVAS, DEFAULT_GUIDES } from '../documents/factories';
import type { ForgeDocument } from '../documents/types';
import { brand } from '../types/brand';
import {
  addMaskStrokeCommand,
  addPhotoAdjustmentCommand,
  addRetouchStrokeCommand,
  clearMaskCommand,
  clearRetouchCommand,
  movePhotoAdjustmentCommand,
  photoHasEdits,
  removePhotoAdjustmentCommand,
  setMaskInvertedCommand,
  setPhotoAdjustmentEnabledCommand,
  setPhotoAdjustmentValueCommand,
  setPhotoEngineCommand,
  setPhotoSourceCommand,
  undoMaskStrokeCommand,
  undoRetouchCommand,
} from './commands';
import type { PhotoAdjustment, PhotoPayload, PhotoSource } from '../documents/payload';

function photoDocument(): ForgeDocument {
  const created = createDocument(
    {
      title: 'Photo test',
      studioId: 'photo',
      documentTypeId: brand<'DocumentTypeId'>('photo.image'),
      canvas: DEFAULT_CANVAS,
      guides: DEFAULT_GUIDES,
    },
    { generateId: () => 'doc-photo' },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function payloadOf(document: ForgeDocument): PhotoPayload {
  if (!document.studioPayload || document.studioPayload.kind !== 'photo') {
    throw new Error('the fixture should be a photo document');
  }
  return document.studioPayload;
}

function adjusted(document: ForgeDocument, patch: Partial<ForgeDocument>): ForgeDocument {
  return { ...document, ...patch } as ForgeDocument;
}

const SOURCE: PhotoSource = {
  name: 'Test.png',
  href: 'data:image/png;base64,AAAA',
  width: 800,
  height: 600,
  mimeType: 'image/png',
  originalWidth: 2400,
  originalHeight: 1800,
};

function withLogoAdjustment(): { document: ForgeDocument; adjustment: PhotoAdjustment } {
  const document = photoDocument();
  const added = addPhotoAdjustmentCommand(document, 'exposure');
  if (!added.ok) throw new Error(added.error.message);
  const next = adjusted(document, added.value.patch);
  const adjustment = payloadOf(next).adjustments[0];
  if (!adjustment) throw new Error('the adjustment should exist');
  return { document: next, adjustment };
}

describe('photo source', () => {
  it('imports a working copy and labels the action with the file name', () => {
    const command = setPhotoSourceCommand(photoDocument(), SOURCE);
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    expect(command.value.label).toBe('Import “Test.png”');
    const payload = command.value.patch.studioPayload as PhotoPayload;
    expect(payload.source?.href).toBe(SOURCE.href);
    expect(payload.source?.originalWidth).toBe(2400);
    // The canvas follows the working copy, so export size and preview size agree.
    expect(command.value.patch.canvas).toMatchObject({ width: 800, height: 600 });
  });

  it('can replace an image and reset the edits, as re-importing a file does', () => {
    const { document } = withLogoAdjustment();
    const replaced = setPhotoSourceCommand(
      document,
      { ...SOURCE, name: 'Second.png' },
      {
        resetEdits: true,
      },
    );
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    const payload = replaced.value.patch.studioPayload as PhotoPayload;
    expect(payload.source?.name).toBe('Second.png');
    expect(payload.adjustments).toEqual([]);
    expect(payload.mask).toBeNull();
  });

  it('refuses a document that is not a photo document', () => {
    const design = createDocument(
      {
        title: 'Design',
        studioId: 'design',
        documentTypeId: brand<'DocumentTypeId'>('design.canvas'),
        canvas: DEFAULT_CANVAS,
        guides: DEFAULT_GUIDES,
      },
      { generateId: () => 'doc-design' },
    );
    if (!design.ok) throw new Error('fixture');
    const command = addPhotoAdjustmentCommand(design.value, 'exposure');
    expect(command.ok).toBe(false);
    if (!command.ok) expect(command.error.message).toMatch(/not a photo document/i);
  });
});

describe('the adjustment stack', () => {
  it('adds an adjustment at the end with its documented initial value', () => {
    const document = photoDocument();
    const added = addPhotoAdjustmentCommand(document, 'contrast');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.label).toBe('Add contrast');
    const payload = added.value.patch.studioPayload as PhotoPayload;
    expect(payload.adjustments).toHaveLength(1);
    expect(payload.adjustments[0]).toMatchObject({ kind: 'contrast', value: 15, enabled: true });
  });

  it('sets a value and clamps it to the documented range', () => {
    const { document, adjustment } = withLogoAdjustment();
    const set = setPhotoAdjustmentValueCommand(document, adjustment.id, 900);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.value.label).toBe('Exposure +100');
    const payload = set.value.patch.studioPayload as PhotoPayload;
    expect(payload.adjustments[0]?.value).toBe(100);

    const lower = setPhotoAdjustmentValueCommand(document, adjustment.id, -900);
    if (!lower.ok) throw new Error('expected a clamp, not a refusal');
    expect((lower.value.patch.studioPayload as PhotoPayload).adjustments[0]?.value).toBe(-100);
  });

  it('refuses to produce a history entry that changes nothing', () => {
    const { document, adjustment } = withLogoAdjustment();
    const unchanged = setPhotoAdjustmentValueCommand(document, adjustment.id, adjustment.value);
    expect(unchanged.ok).toBe(false);
  });

  it('bypasses and re-enables without losing the value', () => {
    const { document, adjustment } = withLogoAdjustment();
    const bypassed = setPhotoAdjustmentEnabledCommand(document, adjustment.id, false);
    expect(bypassed.ok).toBe(true);
    if (!bypassed.ok) return;
    expect(bypassed.value.label).toBe('Bypass exposure');
    const payload = bypassed.value.patch.studioPayload as PhotoPayload;
    expect(payload.adjustments[0]).toMatchObject({ value: 20, enabled: false });

    const enabled = setPhotoAdjustmentEnabledCommand(
      adjusted(document, bypassed.value.patch),
      adjustment.id,
      true,
    );
    if (!enabled.ok) throw new Error('expected the adjustment to be re-enabled');
    expect(enabled.value.label).toBe('Enable exposure');
  });

  it('reorders the stack, because the order is the edit order', () => {
    const document = photoDocument();
    const exposure = addPhotoAdjustmentCommand(document, 'exposure');
    if (!exposure.ok) throw new Error('fixture');
    const withExposure = adjusted(document, exposure.value.patch);
    const contrast = addPhotoAdjustmentCommand(withExposure, 'contrast');
    if (!contrast.ok) throw new Error('fixture');
    const withBoth = adjusted(withExposure, contrast.value.patch);
    const payload = payloadOf(withBoth);
    const contrastId = payload.adjustments[1]?.id;
    if (!contrastId) throw new Error('fixture');

    const moved = movePhotoAdjustmentCommand(withBoth, contrastId, 'up');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.label).toBe('Move contrast earlier');
    const next = moved.value.patch.studioPayload as PhotoPayload;
    expect(next.adjustments.map((item) => item.kind)).toEqual(['contrast', 'exposure']);

    const already = movePhotoAdjustmentCommand(withBoth, contrastId, 'down');
    expect(already.ok).toBe(false);
  });

  it('removes an adjustment and names it in history', () => {
    const { document, adjustment } = withLogoAdjustment();
    const removed = removePhotoAdjustmentCommand(document, adjustment.id);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.label).toBe('Remove exposure');
    expect((removed.value.patch.studioPayload as PhotoPayload).adjustments).toEqual([]);
  });

  it('reports whether the document has edits worth exporting as adjusted', () => {
    const { document } = withLogoAdjustment();
    expect(photoHasEdits(payloadOf(document))).toBe(true);
    expect(photoHasEdits(payloadOf(photoDocument()))).toBe(false);
  });
});

describe('mask commands', () => {
  const stroke = {
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.4 },
    ],
    radius: 0.08,
    hardness: 0.7,
    erase: false,
    fill: false,
  };

  it('adds a brush pass as one labelled action', () => {
    const command = addMaskStrokeCommand(photoDocument(), stroke);
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    expect(command.value.label).toBe('Paint mask');
    const payload = command.value.patch.studioPayload as PhotoPayload;
    expect(payload.mask?.strokes).toHaveLength(1);
    expect(payload.mask?.inverted).toBe(false);
  });

  it('names a lasso differently from a brush and records the fill flag', () => {
    const command = addMaskStrokeCommand(photoDocument(), { ...stroke, fill: true });
    if (!command.ok) throw new Error('expected the lasso to be accepted');
    expect(command.value.label).toBe('Lasso mask');
    const payload = command.value.patch.studioPayload as PhotoPayload;
    expect(payload.mask?.strokes[0]?.fill).toBe(true);
  });

  it('removes only the last stroke, then clears the mask', () => {
    const first = addMaskStrokeCommand(photoDocument(), stroke);
    if (!first.ok) throw new Error('fixture');
    const one = adjusted(photoDocument(), first.value.patch);
    const second = addMaskStrokeCommand(one, { ...stroke, fill: true });
    if (!second.ok) throw new Error('fixture');
    const two = adjusted(one, second.value.patch);

    const undone = undoMaskStrokeCommand(two);
    if (!undone.ok) throw new Error('expected a stroke to be removed');
    expect((undone.value.patch.studioPayload as PhotoPayload).mask?.strokes).toHaveLength(1);

    const cleared = clearMaskCommand(two);
    if (!cleared.ok) throw new Error('expected the mask to be cleared');
    expect((cleared.value.patch.studioPayload as PhotoPayload).mask?.strokes).toEqual([]);
    expect(clearMaskCommand(photoDocument()).ok).toBe(false);
  });

  it('inverts the mask without touching its strokes', () => {
    const first = addMaskStrokeCommand(photoDocument(), stroke);
    if (!first.ok) throw new Error('fixture');
    const one = adjusted(photoDocument(), first.value.patch);
    const inverted = setMaskInvertedCommand(one, true);
    if (!inverted.ok) throw new Error('expected inversion to be accepted');
    expect(inverted.value.label).toBe('Invert mask');
    const payload = inverted.value.patch.studioPayload as PhotoPayload;
    expect(payload.mask?.inverted).toBe(true);
    expect(payload.mask?.strokes).toHaveLength(1);
  });
});

describe('retouch commands', () => {
  it('adds a clone stroke with its sampled offset and undoes it', () => {
    const command = addRetouchStrokeCommand(photoDocument(), {
      mode: 'clone',
      points: [{ x: 0.5, y: 0.5 }],
      radius: 0.05,
      hardness: 0.5,
      offsetX: -0.1,
      offsetY: 0.05,
    });
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    expect(command.value.label).toBe('Clone stamp');
    const payload = command.value.patch.studioPayload as PhotoPayload;
    expect(payload.retouch[0]).toMatchObject({ mode: 'clone', offsetX: -0.1, offsetY: 0.05 });

    const document = adjusted(photoDocument(), command.value.patch);
    const undone = undoRetouchCommand(document);
    if (!undone.ok) throw new Error('expected the retouch to be removed');
    expect((undone.value.patch.studioPayload as PhotoPayload).retouch).toEqual([]);
    expect(undoRetouchCommand(photoDocument()).ok).toBe(false);
    expect(clearRetouchCommand(photoDocument()).ok).toBe(false);
  });
});

describe('renderer choice', () => {
  it('records the chosen engine and refuses a no-op change', () => {
    const document = photoDocument();
    const gpu = setPhotoEngineCommand(document, 'webgl2');
    expect(gpu.ok).toBe(true);
    if (!gpu.ok) return;
    expect(gpu.value.label).toBe('Use the GPU renderer');
    expect((gpu.value.patch.studioPayload as PhotoPayload).engine).toBe('webgl2');

    const same = setPhotoEngineCommand(adjusted(document, gpu.value.patch), 'webgl2');
    expect(same.ok).toBe(false);
  });
});
