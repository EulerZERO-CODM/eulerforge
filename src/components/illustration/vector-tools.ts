/**
 * The Illustration Studio's tools, as data.
 *
 * Every tool the toolbar shows is described here — its label, its key, what it does and what it
 * cannot do. Keeping this in one place means the toolbar, the keyboard shortcuts, the status line and
 * the help text cannot drift apart, and it means a tool that is genuinely unavailable can say so
 * instead of silently doing nothing.
 */

export const VECTOR_TOOLS = ['select', 'node', 'pen', 'rectangle', 'ellipse', 'star'] as const;

export type VectorTool = (typeof VECTOR_TOOLS)[number];

export type VectorToolInfo = {
  readonly id: VectorTool;
  readonly label: string;
  /** One letter, shown on the button and accepted as a shortcut. */
  readonly key: string;
  readonly hint: string;
  /** What the tool needs the user to do, in order. */
  readonly steps: readonly string[];
  /** True when the tool draws new artwork rather than editing what exists. */
  readonly draws: boolean;
};

export const VECTOR_TOOL_INFO: Readonly<Record<VectorTool, VectorToolInfo>> = {
  select: {
    id: 'select',
    label: 'Select',
    key: 'V',
    hint: 'Pick layers, drag to move them, and drag a corner to scale the geometry.',
    steps: [
      'Click a shape to select it. Shift-click adds to the selection.',
      'Drag to move the selected shapes.',
      'Drag a corner handle to scale them.',
    ],
    draws: false,
  },
  node: {
    id: 'node',
    label: 'Node',
    key: 'A',
    hint: 'Edit the nodes and Bezier handles of the selected path.',
    steps: [
      'Select a shape, then click a node to select it.',
      'Drag a node to move it, or a handle to shape the curve.',
      'Click on the outline to add a node where you click.',
    ],
    draws: false,
  },
  pen: {
    id: 'pen',
    label: 'Pen',
    key: 'P',
    hint: 'Draw a path node by node. Drag while placing to pull a curve handle.',
    steps: [
      'Click to place a corner node.',
      'Click and drag to place a node with a curve handle.',
      'Click the first node to close the shape, or press Enter to finish it open.',
    ],
    draws: true,
  },
  rectangle: {
    id: 'rectangle',
    label: 'Rectangle',
    key: 'R',
    hint: 'Drag out a rectangle. Hold Shift for a square.',
    steps: [
      'Press and drag on the artboard.',
      'Release to create the rectangle as an editable path.',
    ],
    draws: true,
  },
  ellipse: {
    id: 'ellipse',
    label: 'Ellipse',
    key: 'E',
    hint: 'Drag out an ellipse. Hold Shift for a circle.',
    steps: [
      'Press and drag on the artboard.',
      'Release to create the ellipse as a path of four curves.',
    ],
    draws: true,
  },
  star: {
    id: 'star',
    label: 'Star',
    key: 'S',
    hint: 'Drag out a five-pointed star, fitted to the box you draw.',
    steps: ['Press and drag on the artboard.', 'Release to create the star as an editable path.'],
    draws: true,
  },
};

/** Tools that only make sense with a vector layer selected. */
export const TOOLS_NEEDING_PATH: readonly VectorTool[] = ['node'];

/** The tool a key press selects, or null when the key is not a tool shortcut. */
export function toolForKey(key: string): VectorTool | null {
  const upper = key.toUpperCase();
  for (const tool of VECTOR_TOOLS) {
    if (VECTOR_TOOL_INFO[tool].key === upper) return tool;
  }
  return null;
}

/** A short line describing what the tool does with the current selection. */
export function toolStatus(tool: VectorTool, selectedPath: boolean): string {
  if (TOOLS_NEEDING_PATH.includes(tool) && !selectedPath) {
    return 'Select a vector shape first: the node tool edits the nodes of the shape you have selected.';
  }
  return VECTOR_TOOL_INFO[tool].hint;
}
