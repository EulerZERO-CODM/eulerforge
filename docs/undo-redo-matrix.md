# Undo/redo coverage: the action-to-test matrix

Every action in the workspace that changes the **document** is one labelled, reversible step. This
document enumerates those actions from the controls and commands the application actually has, names
the history label each one produces, and says where each is checked. It is generated from the source,
not from a list written in advance: the audit started at every `api.commit(...)` and `api.run(...)`
call site in `src/components/**`, which are the only ways the interface can change a document.

Three levels of test, because they answer different questions:

| Level         | File                                            | What it proves                                                                                                                    |
| ------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Core**      | `src/core/editor/undo-redo.test.ts` (45 command rows, 49 tests) | The command's patch changes exactly the right keys, carries the right label, and the history stack reverts and replays byte-for-byte |
| **Component** | `src/components/workspace/undo-redo.test.tsx` (73 control rows, 92 tests, plus the non-edit, refused and continuous-interaction blocks) | The control a person presses produces that one entry, the panel shows it, the session, the store and `localStorage` agree |
| **Browser**   | `e2e/undo-redo.spec.ts` (6 tests) and the specs it names | Keyboard shortcuts, real pointer gestures and what is really persisted across a reload                                   |

The component rows all run through one shared runner, so every row is checked against the same six
questions rather than the ones whoever wrote the row remembered:

1. **The document changed by exactly the expected edit.** Rows assert the resulting document keys
   (`scene`, `attribution`, `canvas`, `guides`, `palette`, `metadata`) *and* the value itself — a
   frame moved by the amount dragged, a fill set to the colour chosen.
2. **One action, one label.** The row names the exact label and the runner requires the rendered
   history list to contain exactly that, once.
3. **Undo restores the previous document exactly** — compared as content, with only `revision` and
   `updatedAt` neutralised, so layer order, attribution records, guides and metadata all have to
   come back identically.
4. **Redo restores the post-edit document exactly**, the same way.
5. **Saved document, history state and interface agree.** After the edit and after each undo/redo:
   the session state, the store and the bytes in `localStorage` hold the same document, the panel
   shows the label, and Undo/Redo are enabled exactly when they should be.
6. **Refused, unchanged, cancelled and transient actions leave nothing behind.**

## Actions that change the document

"Levels" lists where the action is checked: `C` = core command tests, `U` = component rows in
`undo-redo.test.tsx`, `B` = browser. Every row carries a label — the text a person reads in the
history panel.

### Creating and placing layers

| Action (control)                                        | History label                             | Levels |
| ------------------------------------------------------- | ----------------------------------------- | ------ |
| Text tool button (`Text`)                               | `Add text layer`                          | C U B  |
| Rectangle tool button (`Rectangle`)                     | `Add rectangle layer`                     | C U B  |
| Ellipse tool button (`Ellipse`)                         | `Add ellipse layer`                       | C U B  |
| Place a catalogue graphic (`Place on canvas`)           | `Place graphic “<asset>”`                 | C U B  |
| Place a palette from the catalogue                      | `Apply palette “<name>”`                  | U      |

Placing a graphic is the one action that changes two keys at once: the scene gains an image layer and
`attribution` gains the licence record. Both the core row and the browser row (`e2e/undo-redo.spec.ts`,
"undoes and redoes a placed graphic with its licence record") assert that the record comes back with
the layer — including the timestamp on the record, which is why those assertions compare saved bytes
rather than a summary.

### The layer list (single selection)

| Action (control)                                | History label                          | Levels |
| ----------------------------------------------- | -------------------------------------- | ------ |
| Rename in the inspector (`Layer name`)          | `Rename layer to “<name>”`              | C U    |
| Row `Hide` / `Show`                             | `Hide “<name>”` / `Show “<name>”`       | C U    |
| Row `Lock` / `Unlock`                           | `Lock “<name>”` / `Unlock “<name>”`     | C U    |
| Row `Duplicate`                                 | `Duplicate “<name>”`                    | C U    |
| Row `Delete`                                    | `Delete “<name>”`                       | C U B  |
| Row `Bring` / `Send` / `To front` / `To back`   | `Bring forward: “<name>”` …             | C U    |
| Delete the placed graphic                       | `Delete “<name>”` (drops its licence too) | C U  |
| Opacity slider (`Layer opacity`)                | `Set “<name>” opacity to <n>%`          | C U    |

### Transform: pointer, keyboard and fields

| Action (control)                                        | History label                        | Levels |
| ------------------------------------------------------- | ------------------------------------ | ------ |
| Drag a layer on the artboard                            | `Move “<name>”`                      | C U B  |
| Arrow keys on the artboard (one step per press)         | `Move “<name>”` / `Move 2 layers`    | U B    |
| Drag a handle                                           | `Resize “<name>”`                    | C U B  |
| Arrow keys on a focused handle (`Resize bottom right`)   | `Resize “<name>”` / `Resize 2 layers` | U     |
| Position fields (`Layer X`, `Layer Y`)                  | `Move “<name>” to x <n>` / `… to y <n>` | U  |
| Size fields (`Layer width`, `Layer height`)             | `Set “<name>” width to <n>px` …      | U      |
| Drag a multi-layer selection                            | `Move 2 layers`                      | C U B  |
| Group bounds fields (`Selection X/Y/width/height`)      | `Move 2 layers` / `Resize 2 layers` / `Set 2 layers bounds to <w> × <h>` | C U |
| Group reorder (inspector)                               | `Bring forward: 2 layers`, `Send backward: 2 layers`, … | C U |
| Group duplicate / delete                                | `Duplicate 2 layers` / `Delete 2 layers` | C U |
| Group hide / lock (inspector)                           | `Hide 2 layers` / `Lock 2 layers`    | C U    |

Group rows are deliberately separate from single-layer rows: the label names a count rather than a
layer, the transform is a rigid transform of the union of the frames, and the two have different
failure modes (a gesture that would have to transform a locked member, for example).

### Typography (`Text` layers)

| Action (control)                            | History label                                  | Levels |
| ------------------------------------------- | ---------------------------------------------- | ------ |
| Text content                                | `Edit text in “<name>”`                        | C U    |
| Typeface (font stack)                       | `Change “<name>” typeface`                     | C U    |
| Font size                                   | `Set “<name>” font size to <n>px`              | C U    |
| Weight                                      | `Set “<name>” weight to <n>`                   | C U    |
| Line height                                 | `Set “<name>” line height to <n>x`             | C U    |
| Letter spacing                              | `Set “<name>” letter spacing to <n>px`         | C U    |
| Alignment (the `Text alignment` group)       | `Align “<name>” text <align>`                  | C U    |
| Text colour                                 | `Set “<name>” text colour to <hex>`            | C U    |

### Shape appearance (`Rectangle`, `Ellipse` layers)

| Action (control)      | History label                              | Levels |
| --------------------- | ------------------------------------------ | ------ |
| Fill colour           | `Set “<name>” fill to <hex>`                | C U    |
| Remove fill (`None`)  | `Remove “<name>” fill`                      | C U    |
| Stroke colour         | `Set “<name>” stroke to <hex>`              | C U    |
| Remove stroke         | `Remove “<name>” stroke`                    | C U    |
| Stroke width          | `Set “<name>” stroke width to <n>px`        | C U    |
| Corner radius         | `Set “<name>” corner radius to <n>px`       | C U    |

### Graphic settings (placed catalogue graphics)

| Action (control)   | History label                             | Levels |
| ------------------ | ----------------------------------------- | ------ |
| Fit                | `Fit “<name>” graphic to <fit>`           | C U    |
| Tint               | `Set “<name>” tint to <hex>`              | C U    |
| Remove tint        | `Remove “<name>” tint`                    | C U    |

Fit and tint used to share one `Update “…”` label, which told a person nothing about which setting
moved. They now each name their own edit; the remaining `Update “…”` sites are the frame, text and
shape paths, which are also covered above.

### Canvas, guides and palette

| Action (control)                       | History label                                 | Levels |
| -------------------------------------- | --------------------------------------------- | ------ |
| Canvas preset                          | `Apply <preset> preset`                        | U      |
| Canvas width / height fields           | `Resize canvas to <w> × <h> px`                | U      |
| Resolution field                       | `Set resolution to <n> dpi`                    | U      |
| Unit select                            | `Switch units to <unit>`                       | U      |
| Background colour picker               | `Change background colour`                     | C U    |
| `Transparent background` switch, on    | `Make the background transparent`              | C U    |
| `Transparent background` switch, off   | `Add background colour`                        | U      |
| Safe margin / bleed / grid spacing     | `Safe margin set to <n> mm`, `Bleed set to <n> mm`, `Grid spacing set to <n> mm` | U |
| `Grid` switch                          | `Show grid` / `Hide grid`                      | U      |
| `Centre lines` switch                  | `Show centre lines` / `Hide centre lines`      | U      |
| Print-ready guide defaults button      | `Apply print-ready guide defaults`             | U      |
| Add a colour to the palette            | `Add <hex> to palette`                         | U      |
| Remove a colour from the palette       | `Remove palette colour`                        | U      |
| Apply a sample palette                 | `Apply palette “<name>”`                       | U      |

`Grid`, `Centre lines`, `Safe margin`, `Bleed` and grid spacing live in the *document*, so they are
document edits and history steps. The `Hide/Show guides` control on the stage is a view setting and
appears in the "no step" list below — the two are different things and are labelled differently.

### Project details

| Action (control)   | History label           | Levels |
| ------------------ | ----------------------- | ------ |
| Project name       | `Rename project`        | U      |
| Status select      | `Change project status` | U      |
| Summary            | `Update summary`        | U      |
| Notes              | `Update notes`          | U      |
| Tags               | `Update tags`           | U      |

## Continuous interactions are one step

A slider drag and a visit to a colour picker each produce a stream of changes, but they are one
decision by the person making them. `DocumentSession.commit` takes an optional `coalesceKey`; while
the same key is active, `HistoryStack.replaceLatest` rewrites the newest entry — keeping the state the
interaction started from, updating the label to the value the interaction ended on, and clearing the
redo branch. `undo`, `redo` and loading a document all end the interaction.

| Interaction                                  | Label after the gesture                    | Levels |
| -------------------------------------------- | ------------------------------------------ | ------ |
| Press, drag and release the opacity slider    | `Set “<name>” opacity to <final>%`         | U B    |
| Arrow keys on the opacity slider (no press)   | one step per key press                     | U      |
| Focus, several colours, blur — layer colour   | `Set “<name>” text colour to <final>`      | U      |
| Focus, several colours, blur — canvas colour  | `Change background colour`                 | U      |

Each of these is asserted together with the thing that would go wrong without it: undo after one drag
returns to where the drag *started*, not to the second-to-last value, and two separate drags are two
separate steps. The pointer half of the same contract — a real drag delivered through the browser's
event pipeline, undone with one click — is in `e2e/workspace.spec.ts` ("resizes a group as one
transform, and undo restores every layer").

## Actions that must not create a step

Selection and other view state are transient: they are not saved in the document and are not history
steps. The component suite has a `not document edits` block and the browser spec repeats the same
walk with real events.

| Action                                             | Why it is not a history step                     | Levels |
| -------------------------------------------------- | ------------------------------------------------ | ------ |
| Selecting a layer, adding to the selection          | Selection is not part of the document            | U B    |
| Clearing the selection (empty canvas click)         | Same                                             | U B    |
| Drawing a marquee                                   | Same                                             | U B    |
| Changing the zoom                                   | View state                                       | U B    |
| Toggling snapping on the stage                      | Interaction preference, not a document field     | U B    |
| `Hide guides` / `Show guides` on the stage          | View state (unlike the document's guide settings) | U B   |
| Opening the export panel, changing format or quality | Export preferences for a file that does not exist yet | U B |
| Choosing a colour in the palette's "Add colour" box, without pressing Add | A draft, not a document value | U |

## Editing paths that need no history step because they cannot change anything

| Action                                                       | What happens                                     | Levels |
| ------------------------------------------------------------ | ------------------------------------------------ | ------ |
| A field commit that is refused (`Layer width` of 0, a name left empty) | The field shows the reason; no entry | C U B  |
| A field commit that changes nothing (the same value retyped) | No entry, no revision bump                       | C U B  |
| Escape while typing in a field, or during a gesture          | The draft or the gesture is discarded            | U B    |
| A drag with no movement (a press and release in place)       | It is a click, so it selects and records nothing  | U      |

## Where the enumeration comes from

The rows are grouped exactly like the panels that produce them, and each was written against the
call site rather than from memory:

- `src/components/workspace/document-stage.tsx` — the toolbar's add buttons and the graphic placer.
- `src/components/workspace/document-aside.tsx` — the layer list's row actions.
- `src/components/workspace/selection-inspector.tsx` — transform, typography, shape, graphic and
  group controls.
- `src/components/workspace/inspector-panel.tsx` — canvas, guides, palette, project details.
- `src/components/workspace/artboard.tsx` — pointer gestures and their keyboard equivalents, which
  reach the session through the stage's `onCommitFrames`; one commit per gesture.

## Known gaps

- **No Chromium in this development sandbox.** `e2e/undo-redo.spec.ts` is written and listed by
  `npx playwright test --list`, and runs in the `Browser (Chromium)` CI job; nothing here was executed
  on the machine that wrote it. Its first run was that CI job, and it found two real defects in the
  spec rather than in the product: the walk back to the document a test starts from is *not* the floor
  of the history — the fixture creates both layers through the workspace, so those are undoable steps
  too — and an unqualified `getByRole('alert')` matched Next's route announcer as well as the field's
  error. Both are fixed and asserted more precisely: the spec now walks past the fixture's own steps
  to an empty canvas and back, and names the field's message.
- **Chromium only.** Firefox and WebKit are not in the job, so keyboard and pointer behaviour there is
  unverified.
- **Group semantics that are not transforms.** Alignment, distribution and grouping (as opposed to
  selection) do not exist in Phase 2; when they do, each will need its own row here.
- **Undo/redo of a gesture that failed halfway.** A gesture either commits once or not at all, which
  the cancellation rows cover; there is no partial-commit path to test.
- **Text editing happens in the inspector.** There is no direct-on-canvas text editing, so no row for
  it — when inline editing arrives it will need its own row and its own label.
