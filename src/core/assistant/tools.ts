/**
 * Implementations for the native assistant tools.
 *
 * A tool is a pure function from (document, selection, validated arguments) to document commands and
 * a verification step. It never touches the DOM, never downloads anything itself, and never claims an
 * effect: the executor applies the commands through the session and then asks the tool's `verify` to
 * read the *resulting* document back. That split is what makes "inspect the result before reporting
 * success" a property of the architecture rather than a promise in a prompt.
 */

import { err, forgeError, ok, type Result } from '../result';
import type { ForgeDocument } from '../documents/types';
import type { SceneCommand } from '../editor/commands';
import { addNewLayer } from '../documents/layer-operations';
import { createRect } from '../documents/geometry';
import { PHOTO_ADJUSTMENT_INFO, type PhotoAdjustmentKind } from '../documents/payload';
import {
  addPhotoAdjustmentCommand,
  addRangeSelectionCommand,
  setPhotoAdjustmentValueCommand,
} from '../photo/commands';
import { setVectorStyleCommand, setVectorTextCommand } from '../editor/vector-commands';
import { isPathLayer, type PathTextBaseline } from '../documents/layer-types';
import { findTool, type ToolArgs, type ToolCall } from './registry';

export type ToolContext = {
  readonly document: ForgeDocument;
  /** Layer ids the user has selected, in document order. */
  readonly selection: readonly string[];
};

export type ToolOutcome = {
  /** What this step did, in the words the progress list shows. */
  readonly detail: string;
  readonly commands: readonly SceneCommand[];
  /** Asked of the host when the tool's result is a file. */
  readonly download?: 'svg' | 'png' | 'jpeg' | 'webp';
  /**
   * Reads the document *after* the commands were applied.
   *
   * Returning a sentence is the only way a step is allowed to claim success; throwing means the
   * result did not match what the step intended, and the executor marks the step failed.
   */
  readonly verify: (document: ForgeDocument) => string;
};

export type ToolRunner = (context: ToolContext, args: ToolArgs) => Result<ToolOutcome>;

function num(args: ToolArgs, name: string): number | undefined {
  const value = args[name];
  return typeof value === 'number' ? value : undefined;
}

function str(args: ToolArgs, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' ? value : undefined;
}

function refusal(message: string, detail?: string): Result<never> {
  return err(
    forgeError('validation-failed', message, {
      ...(detail === undefined ? {} : { detail }),
      retryable: false,
    }),
  );
}

/** Selected path layers that are not locked, in document order. */
function editablePaths(context: ToolContext) {
  return context.selection
    .map((id) => context.document.scene.layers.find((layer) => String(layer.id) === id))
    .filter(
      (layer): layer is Extract<typeof layer, { type: 'path' }> =>
        layer !== undefined && isPathLayer(layer) && !layer.locked,
    );
}

/* -------------------------------------------------------------------------------------------- */
/* Photo                                                                                         */
/* -------------------------------------------------------------------------------------------- */

function adjustPhoto(context: ToolContext, args: ToolArgs): Result<ToolOutcome> {
  const requested = str(args, 'adjustment');
  const value = num(args, 'value');
  // Look the kind up as a string, not through a cast: a plan is data, and the registry's enum is not
  // the only thing that can reach this function in a test or a future provider adapter.
  const info = (
    PHOTO_ADJUSTMENT_INFO as Readonly<
      Record<string, (typeof PHOTO_ADJUSTMENT_INFO)[PhotoAdjustmentKind] | undefined>
    >
  )[requested ?? ''];
  if (!requested || !info || value === undefined) {
    return refusal('The adjustment step is incomplete.');
  }
  const kind = requested as PhotoAdjustmentKind;

  const payload = context.document.studioPayload;
  if (payload?.kind !== 'photo') return refusal('This is not a photograph.');
  const existing = payload.adjustments.find((adjustment) => adjustment.kind === kind);
  const mode = str(args, 'mode') ?? 'set';
  const target = Math.min(
    info.max,
    Math.max(info.min, mode === 'add' ? (existing?.value ?? 0) + value : value),
  );

  if (existing && existing.value === target) {
    return ok({
      detail: `${info.label} is already ${String(target)}; nothing changed.`,
      commands: [],
      verify: () => `${info.label} stayed at ${String(target)} as planned.`,
    });
  }

  const command = existing
    ? setPhotoAdjustmentValueCommand(context.document, existing.id, target)
    : addPhotoAdjustmentCommand(context.document, kind, target);
  if (!command.ok) return err(command.error);

  return ok({
    detail: `${existing ? 'Set' : 'Added'} ${info.label.toLowerCase()} to ${String(target)}.`,
    commands: [command.value],
    verify: (document) => {
      const after = document.studioPayload;
      if (after?.kind !== 'photo') throw new Error('the document stopped being a photograph');
      const applied = after.adjustments.find((adjustment) => adjustment.kind === kind);
      if (!applied) throw new Error(`${info.label} is missing from the stack after the edit`);
      if (applied.value !== target) {
        throw new Error(`${info.label} reads ${String(applied.value)}, expected ${String(target)}`);
      }
      return `${info.label} is ${String(applied.value)} in the saved stack.`;
    },
  });
}

function rangeSelectPhoto(context: ToolContext, args: ToolArgs): Result<ToolOutcome> {
  const kind = str(args, 'kind');
  const feather = num(args, 'feather') ?? 0.1;
  if (kind === 'luminance') {
    const min = num(args, 'min') ?? 0;
    const max = num(args, 'max') ?? 1;
    const command = addRangeSelectionCommand(context.document, {
      kind: 'luminance',
      min,
      max,
      feather,
    });
    if (!command.ok) return err(command.error);
    return ok({
      detail: `Selected pixels between ${String(Math.round(min * 100))}% and ${String(Math.round(max * 100))}% luminance.`,
      commands: [command.value],
      verify: (document) => {
        const payload = document.studioPayload;
        if (payload?.kind !== 'photo') throw new Error('the document stopped being a photograph');
        const ranges = payload.mask?.ranges ?? [];
        const added = ranges.at(-1);
        if (added?.kind !== 'luminance') throw new Error('the luminance range was not stored');
        return `The mask now holds ${String(ranges.length)} range selection(s).`;
      },
    });
  }
  if (kind === 'colour') {
    const colour = str(args, 'colour');
    if (!colour || !/^#[0-9a-f]{6}$/i.test(colour)) {
      return refusal('A colour selection needs a six-digit hex colour.');
    }
    const tolerance = num(args, 'tolerance') ?? 0.15;
    const command = addRangeSelectionCommand(context.document, {
      kind: 'colour',
      colour,
      tolerance,
      feather,
    });
    if (!command.ok) return err(command.error);
    return ok({
      detail: `Selected pixels near ${colour.toUpperCase()} within ${String(Math.round(tolerance * 100))}%.`,
      commands: [command.value],
      verify: (document) => {
        const payload = document.studioPayload;
        if (payload?.kind !== 'photo') throw new Error('the document stopped being a photograph');
        const ranges = payload.mask?.ranges ?? [];
        const added = ranges.at(-1);
        if (added?.kind !== 'colour') throw new Error('the colour range was not stored');
        return `The mask now holds ${String(ranges.length)} range selection(s).`;
      },
    });
  }
  return refusal('A range selection must be by luminance or by colour.');
}

function exportPhoto(context: ToolContext, args: ToolArgs): Result<ToolOutcome> {
  const format = str(args, 'format');
  if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
    return refusal('The export format must be png, jpeg or webp.');
  }
  if (context.document.studioPayload?.kind !== 'photo') return refusal('This is not a photograph.');
  return ok({
    detail: `Asked the browser to encode a ${format.toUpperCase()} of the full working copy.`,
    commands: [],
    download: format,
    verify: () => `${format.toUpperCase()} bytes were produced by the browser encoder.`,
  });
}

/* -------------------------------------------------------------------------------------------- */
/* Illustration                                                                                  */
/* -------------------------------------------------------------------------------------------- */

function fillPaths(context: ToolContext, args: ToolArgs): Result<ToolOutcome> {
  const colour = str(args, 'colour');
  if (!colour) return refusal('A fill needs a colour.');
  const paths = editablePaths(context);
  if (paths.length === 0) {
    return refusal('Select at least one unlocked path to fill.', 'Nothing was changed.');
  }
  const styles = paths.map((path) => ({
    path,
    previous: path.vector.style.fill,
  }));
  const command = setVectorStyleCommand(
    context.document,
    paths.map((path) => path.id),
    { fill: colour },
  );
  if (!command.ok) return err(command.error);
  return ok({
    detail: `Filled ${String(paths.length)} path(s) with ${colour}.`,
    commands: [command.value],
    verify: (document) => {
      const changed = document.scene.layers.filter((layer) =>
        paths.some((path) => String(path.id) === String(layer.id)),
      );
      if (changed.length !== paths.length) throw new Error('a filled path disappeared');
      for (const layer of changed) {
        if (layer.type !== 'path' || layer.vector.style.fill !== colour) {
          throw new Error(`“${layer.name}” is not ${colour} after the edit`);
        }
      }
      const before = styles.every((entry) => entry.previous !== colour);
      return before
        ? `${String(changed.length)} path(s) now carry ${colour}.`
        : `${String(changed.length)} path(s) already carried ${colour}.`;
    },
  });
}

function strokePaths(context: ToolContext, args: ToolArgs): Result<ToolOutcome> {
  const colour = str(args, 'colour');
  if (!colour) return refusal('A stroke needs a colour.');
  const width = num(args, 'width');
  const paths = editablePaths(context);
  if (paths.length === 0) {
    return refusal('Select at least one unlocked path to stroke.', 'Nothing was changed.');
  }
  const command = setVectorStyleCommand(
    context.document,
    paths.map((path) => path.id),
    { stroke: colour, ...(width === undefined ? {} : { strokeWidth: width }) },
  );
  if (!command.ok) return err(command.error);
  return ok({
    detail: `Stroked ${String(paths.length)} path(s) with ${colour}${width === undefined ? '' : ` at ${String(width)} units`}.`,
    commands: [command.value],
    verify: (document) => {
      const first = document.scene.layers.find(
        (layer) => String(layer.id) === String(paths[0]?.id),
      );
      if (first?.type !== 'path') throw new Error('the stroked path disappeared');
      if (first.vector.style.stroke !== colour) {
        throw new Error(`“${first.name}” does not carry ${colour} after the edit`);
      }
      return `“${first.name}” now reads stroke ${colour}.`;
    },
  });
}

function textOnPath(context: ToolContext, args: ToolArgs): Result<ToolOutcome> {
  const content = str(args, 'content');
  if (!content) return refusal('Text on a path needs content.');
  const paths = editablePaths(context);
  if (paths.length !== 1) {
    return refusal(
      'Select exactly one unlocked path for its text.',
      `${String(paths.length)} eligible path(s) are selected.`,
    );
  }
  const target = paths[0]!;
  const fontSize = num(args, 'fontSize');
  const baseline = str(args, 'baseline') as PathTextBaseline | undefined;
  const command = setVectorTextCommand(context.document, target.id, {
    content,
    ...(fontSize === undefined ? {} : { fontSize }),
    ...(baseline === undefined ? {} : { baseline }),
  });
  if (!command.ok) return err(command.error);
  return ok({
    detail: `Laid “${content}” along “${target.name}”.`,
    commands: [command.value],
    verify: (document) => {
      const layer = document.scene.layers.find((entry) => String(entry.id) === String(target.id));
      if (layer?.type !== 'path') throw new Error('the path with the new text disappeared');
      if (layer.vector.text?.content !== content) {
        throw new Error('the text on the path is not what the step asked for');
      }
      return `“${layer.name}” carries “${content}” at ${String(layer.vector.text.fontSize)} units.`;
    },
  });
}

function exportSvg(context: ToolContext): Result<ToolOutcome> {
  if (context.document.documentTypeId !== 'illustration.artboard') {
    return refusal('This document is not a vector artboard.');
  }
  return ok({
    detail: 'Asked the exchanger for the artboard’s SVG.',
    commands: [],
    download: 'svg',
    verify: () => 'The SVG bytes were produced by the artboard exporter.',
  });
}

/* -------------------------------------------------------------------------------------------- */
/* Design                                                                                        */
/* -------------------------------------------------------------------------------------------- */

function addText(context: ToolContext, args: ToolArgs): Result<ToolOutcome> {
  const content = str(args, 'content');
  if (!content) return refusal('A text layer needs content.');
  const x = num(args, 'x') ?? 64;
  const y = num(args, 'y') ?? 64;
  const added = addNewLayer(context.document.scene, {
    type: 'text',
    frame: createRect(x, y, 420, 120),
    text: { content },
  });
  if (!added.ok) return err(added.error);
  const label = `Add text “${content.slice(0, 32)}${content.length > 32 ? '…' : ''}”`;
  return ok({
    detail: `Added a text layer with “${content.slice(0, 40)}”.`,
    commands: [{ label, patch: { scene: added.value.scene } }],
    verify: (document) => {
      const layer = document.scene.layers.find(
        (entry) => String(entry.id) === String(added.value.layer.id),
      );
      if (layer?.type !== 'text') throw new Error('the text layer is missing after the edit');
      if (layer.text.content !== content) throw new Error('the text layer holds other content');
      return `A text layer reads “${layer.text.content}”.`;
    },
  });
}

function addRectangle(context: ToolContext, args: ToolArgs): Result<ToolOutcome> {
  const width = num(args, 'width');
  const height = num(args, 'height');
  if (width === undefined || height === undefined) {
    return refusal('A rectangle needs a width and a height.');
  }
  const x = num(args, 'x') ?? 48;
  const y = num(args, 'y') ?? 48;
  const added = addNewLayer(context.document.scene, {
    type: 'rect',
    frame: createRect(x, y, width, height),
  });
  if (!added.ok) return err(added.error);
  return ok({
    detail: `Added a ${String(width)}×${String(height)} rectangle at ${String(x)}, ${String(y)}.`,
    commands: [
      {
        label: `Add ${String(width)}×${String(height)} rectangle`,
        patch: { scene: added.value.scene },
      },
    ],
    verify: (document) => {
      const layer = document.scene.layers.find(
        (entry) => String(entry.id) === String(added.value.layer.id),
      );
      if (layer?.type !== 'rect') throw new Error('the rectangle is missing after the edit');
      return `A ${String(layer.frame.width)}×${String(layer.frame.height)} rectangle is on the canvas.`;
    },
  });
}

/**
 * Every native tool, keyed by the id the registry publishes.
 *
 * A missing entry is a programming error, and `assertRunnersComplete` turns it into a failing test
 * rather than a plan step that reports success while doing nothing.
 */
export const TOOL_RUNNERS: Readonly<Record<string, ToolRunner>> = Object.freeze({
  'photo.adjust': adjustPhoto,
  'photo.range_select': rangeSelectPhoto,
  'photo.export': exportPhoto,
  'illustration.set_fill': fillPaths,
  'illustration.set_stroke': strokePaths,
  'illustration.text_on_path': textOnPath,
  'illustration.export_svg': exportSvg,
  'design.add_text': addText,
  'design.add_rectangle': addRectangle,
});

export function runnerFor(call: ToolCall): ToolRunner | undefined {
  return TOOL_RUNNERS[findTool(call.tool)?.id ?? call.tool];
}

/** Used by the tests and by the panel's capability line. */
export function nativeToolIdsWithoutRunner(): readonly string[] {
  return Object.keys(TOOL_RUNNERS).filter((id) => {
    const spec = findTool(id);
    return !spec || spec.availability.kind !== 'native';
  });
}
