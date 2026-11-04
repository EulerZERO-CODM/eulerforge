/** The pointer tools Photo Studio offers. Tool choice is transient interaction state (ADR-0017). */

export const PHOTO_TOOLS = ['view', 'brush', 'lasso', 'erase', 'clone', 'heal'] as const;

export type PhotoTool = (typeof PHOTO_TOOLS)[number];

export const PHOTO_TOOL_INFO: Readonly<
  Record<
    PhotoTool,
    {
      readonly label: string;
      readonly hint: string;
      readonly group: 'mask' | 'retouch' | 'inspect';
    }
  >
> = {
  view: {
    label: 'Inspect',
    hint: 'Look at the result. Picking a mask tool lets you paint where the stack applies.',
    group: 'inspect',
  },
  brush: {
    label: 'Brush mask',
    hint: 'Drag to paint inside the mask; hardness feathers the edge.',
    group: 'mask',
  },
  lasso: {
    label: 'Lasso mask',
    hint: 'Drag a closed outline to apply the stack inside it.',
    group: 'mask',
  },
  erase: {
    label: 'Erase mask',
    hint: 'Paint mask back out. Strokes are undone in order, like every other edit.',
    group: 'mask',
  },
  clone: {
    label: 'Clone stamp',
    hint: 'Alt-click sets the source point, then paint to copy pixels from it.',
    group: 'retouch',
  },
  heal: {
    label: 'Heal',
    hint: 'Paint over a blemish to blend it towards a locally blurred copy.',
    group: 'retouch',
  },
};

export function isMaskTool(tool: PhotoTool): boolean {
  return tool === 'brush' || tool === 'lasso' || tool === 'erase';
}

export function isRetouchTool(tool: PhotoTool): boolean {
  return tool === 'clone' || tool === 'heal';
}
