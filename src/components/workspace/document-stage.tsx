'use client';

import {
  Circle,
  Grid2X2,
  ImagePlus,
  Magnet,
  Maximize2,
  PenTool,
  Ruler,
  Square,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { Rect } from '../../core/documents/geometry';
import { aspectRatioLabel, megapixelLabel, orientationOf } from '../../core/documents/geometry';
import type { LayerId, LayerType } from '../../core/documents/layer-types';
import { formatLength } from '../../core/documents/units';
import {
  ZOOM_PERCENT_LEVELS,
  computeZoom,
  parseZoomSetting,
  stepZoom,
  type ViewportBox,
  type ZoomSetting,
} from '../../core/documents/zoom';
import {
  addLayerCommand,
  placeAssetCommand,
  setLayerFramesCommand,
} from '../../core/editor/commands';
import type { Selection } from '../../core/editor/selection';
import type { AssetRecord } from '../../core/assets/types';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { InlineNote } from '../ui/states';
import { Artboard, describeImageState } from './artboard';
import { GraphicPicker } from './graphic-picker';
import type { SceneImages } from './use-scene-images';
import type { WorkspaceApi } from './workspace-api';

/** Padding around the canvas inside the scroll area, in pixels (`p-4`); measured space excludes it. */
const STAGE_PADDING_PX = 16 * 2;
/** Smallest sensible scroll area; below this the stage still renders rather than collapsing. */
const MIN_STAGE_HEIGHT_PX = 22 * 16;

export type DocumentStageProps = {
  readonly api: WorkspaceApi;
  readonly selection: Selection;
  readonly onSelectionChange: (selection: Selection) => void;
  readonly images: SceneImages;
  readonly snapping: boolean;
  readonly onSnappingChange: (snapping: boolean) => void;
  readonly showGuides: boolean;
  readonly onGuidesChange: (show: boolean) => void;
};

/**
 * Document stage.
 *
 * The workspace's main surface: a toolbar that creates layers, the interactive artboard, and the
 * zoom and snapping controls that govern it. Zoom is geometry, not styling — `fit` measures the
 * scroll area and an explicit percentage renders the document at exactly that multiple of its
 * declared pixel size, so a canvas larger than the pane genuinely scrolls (ADR-0015).
 */
export function DocumentStage({
  api,
  selection,
  onSelectionChange,
  images,
  snapping,
  onSnappingChange,
  showGuides,
  onGuidesChange,
}: DocumentStageProps) {
  const [zoom, setZoom] = useState<ZoomSetting>('fit');
  const [viewport, setViewport] = useState<ViewportBox>({ width: 0, height: 0 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const doc = api.doc;
  const { canvas, guides } = doc;

  // Measure the scroll area so `fit` has something real to fit against, and keep it current when the
  // window, the sidebar or the pane divider changes size.
  useEffect(() => {
    const element = scrollAreaRef.current;
    if (!element) return;

    const measure = () => {
      setViewport({
        width: Math.max(0, element.clientWidth - STAGE_PADDING_PX),
        height: Math.max(0, element.clientHeight - STAGE_PADDING_PX),
      });
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => {
        window.removeEventListener('resize', measure);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const scale = computeZoom(canvas, zoom, viewport);
  const unmeasured = scale.setting === 'fit' && scale.unmeasured;
  const graphics = describeImageState(doc.scene.layers, images.status);

  return (
    <section
      aria-label="Document stage"
      className="border-line bg-surface-raised/50 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border"
    >
      <div className="border-line-subtle flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-fg-subtle mr-1 font-semibold tracking-wider uppercase">
            Add
          </span>
          {(['text', 'rect', 'ellipse'] as const satisfies readonly LayerType[]).map((type) => (
            <Button
              key={type}
              variant="outline"
              size="sm"
              iconLeft={iconFor(type)}
              onClick={() => {
                void api.run(addLayerCommand(doc, type));
              }}
            >
              {type === 'text' ? 'Text' : type === 'rect' ? 'Rectangle' : 'Ellipse'}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            iconLeft={<ImagePlus aria-hidden />}
            onClick={() => {
              setPickerOpen(true);
            }}
          >
            Graphic
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant={snapping ? 'primary' : 'outline'}
            size="sm"
            aria-pressed={snapping}
            iconLeft={<Magnet aria-hidden />}
            title="Snap to guides, grid lines and other layers while moving or resizing"
            onClick={() => {
              onSnappingChange(!snapping);
            }}
          >
            Snapping {snapping ? 'on' : 'off'}
          </Button>
          <IconButton
            label={showGuides ? 'Hide guides' : 'Show guides'}
            size="sm"
            onClick={() => {
              onGuidesChange(!showGuides);
            }}
            aria-pressed={showGuides}
            variant="quiet"
          >
            {guides.showGrid ? <Grid2X2 aria-hidden /> : <Ruler aria-hidden />}
          </IconButton>
          <IconButton
            label="Zoom out"
            size="sm"
            onClick={() => {
              setZoom(stepZoom(zoom, -1, scale.percent));
            }}
          >
            <ZoomOut aria-hidden />
          </IconButton>
          <select
            aria-label="Zoom level"
            value={String(zoom)}
            title="Percentages map document pixels to CSS pixels. On a high-density display one CSS pixel is drawn with more than one device pixel."
            onChange={(event) => {
              setZoom(parseZoomSetting(event.target.value));
            }}
            className="forge-numeric border-line bg-ink-950 text-2xs text-fg-muted h-7 cursor-pointer rounded-sm border px-1.5"
          >
            <option value="fit">Fit</option>
            {ZOOM_PERCENT_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}%
              </option>
            ))}
          </select>
          <span
            data-testid="zoom-readout"
            className="forge-numeric text-2xs text-fg-muted w-[5.5rem] text-right"
          >
            {unmeasured
              ? 'declared size'
              : `${scale.setting === 'fit' ? 'Fit · ' : ''}${String(scale.percent)}%`}
          </span>
          <IconButton
            label="Zoom in"
            size="sm"
            onClick={() => {
              setZoom(stepZoom(zoom, 1, scale.percent));
            }}
          >
            <ZoomIn aria-hidden />
          </IconButton>
        </div>
      </div>

      <div
        ref={scrollAreaRef}
        data-testid="stage-scroll-area"
        className="forge-scroll flex flex-1 overflow-auto p-4"
        style={{ minHeight: `${String(MIN_STAGE_HEIGHT_PX)}px` }}
      >
        <div className="m-auto">
          <Artboard
            doc={doc}
            zoom={scale.scale}
            selection={selection}
            onSelectionChange={onSelectionChange}
            onCommitFrames={(
              label: string,
              frames: readonly { readonly id: LayerId; readonly frame: Rect }[],
            ) => {
              void api.run(setLayerFramesCommand(doc, frames, label));
            }}
            images={images}
            showGuides={showGuides}
            snapping={snapping}
          />
        </div>
      </div>

      {graphics.length > 0 ? (
        <div className="px-3 pt-3">
          <InlineNote
            tone={images.errors.length > 0 ? 'danger' : 'info'}
            title={
              images.errors.length > 0
                ? 'A graphic could not be loaded'
                : 'Graphics are still loading'
            }
          >
            <ul className="space-y-1">
              {graphics.map((note) => (
                <li key={note} className="text-xs">
                  {note}
                </li>
              ))}
            </ul>
            {images.errors.length > 0 ? (
              <>
                <p className="text-xs">
                  Export is refused while a graphic is missing, so a file can never silently omit
                  it.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    images.retry();
                  }}
                >
                  Reload graphics
                </Button>
              </>
            ) : null}
          </InlineNote>
        </div>
      ) : null}

      <dl className="border-line-subtle text-2xs grid grid-cols-2 gap-x-4 gap-y-1.5 border-t px-3 py-2.5 sm:grid-cols-4">
        <Spec label="Canvas" value={`${String(canvas.width)} × ${String(canvas.height)} px`} />
        <Spec label="Ratio" value={`${aspectRatioLabel(canvas)} · ${orientationOf(canvas)}`} />
        <Spec label="Density" value={megapixelLabel(canvas)} />
        <Spec
          label="Physical"
          value={
            canvas.unit === 'px'
              ? `screen (${String(canvas.dpi)} dpi ref)`
              : formatLength(canvas.width, canvas.unit, canvas.dpi)
          }
        />
      </dl>

      <div className="border-line-subtle flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
        <p className="text-2xs text-fg-subtle">
          {scale.clipped ? (
            <span data-testid="zoom-clipped-note">
              The canvas is larger than this pane — scroll to reach it all.{' '}
            </span>
          ) : null}
          <span>
            Drag to move, drag a handle to resize, Shift keeps the aspect ratio, Alt resizes from
            the centre, and arrow keys nudge the selection.{' '}
          </span>
          <span>
            Zoom maps document pixels to CSS pixels; on a high-density display one CSS pixel is
            drawn with more than one device pixel.
          </span>
        </p>
        <Button
          variant="link"
          size="sm"
          className="text-2xs"
          onClick={() => {
            globalThis.document
              .getElementById('contextual-help')
              ?.scrollIntoView({ block: 'start' });
          }}
          iconLeft={<Maximize2 aria-hidden />}
        >
          Explain these settings
        </Button>
      </div>

      <GraphicPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPlace={(record: AssetRecord) => {
          setPickerOpen(false);
          void api.run(placeAssetCommand(doc, record));
        }}
      />
    </section>
  );
}

function iconFor(type: LayerType): React.ReactNode {
  switch (type) {
    case 'text':
      return <Type aria-hidden />;
    case 'rect':
      return <Square aria-hidden />;
    case 'ellipse':
      return <Circle aria-hidden />;
    case 'image':
      return <ImagePlus aria-hidden />;
    case 'path':
      // A vector layer has no "add" button — it is created by drawing — but the layer tree, the
      // inspector and this switch all name the same type, so the glyph is here for them to share.
      return <PenTool aria-hidden />;
  }
}

function Spec({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-subtle uppercase">{label}</dt>
      <dd className="forge-numeric text-fg-muted truncate">{value}</dd>
    </div>
  );
}
