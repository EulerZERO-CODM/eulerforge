'use client';

import { Scissors, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { TitlePosition, VideoPayload } from '../../core/documents/payload';
import { MAX_VIDEO_DURATION, MAX_VIDEO_FPS, TITLE_POSITIONS } from '../../core/documents/payload';
import {
  addTitleCommand,
  findClip,
  moveClipCommand,
  removeClipCommand,
  setClipAudioCommand,
  setTimelineCommand,
  splitClipCommand,
  trimClipCommand,
  updateTitleCommand,
} from '../../core/video/commands';
import type { SceneCommand } from '../../core/editor/commands';
import type { Result } from '../../core/result';
import { TITLE_POSITION_LABELS, isTitleClip } from '../../core/video/timeline';
import { Button } from '../ui/button';
import { Field, Input, Select } from '../ui/field';
import { InlineNote } from '../ui/states';
import type { WorkspaceApi } from '../workspace/workspace-api';

/**
 * The inspector for one clip, or for the composition when nothing is selected.
 *
 * Every field is a command: typing a duration and pressing Enter is one labelled history entry, and
 * a refusal (a move onto the wrong kind of track, a split at an edge) is shown as a sentence under
 * the control that caused it rather than as a toast that disappears.
 */
export function ClipInspector({
  api,
  payload,
  selectedClipId,
  time,
}: {
  readonly api: WorkspaceApi;
  readonly payload: VideoPayload;
  readonly selectedClipId: string | null;
  readonly time: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [titleText, setTitleText] = useState('');
  const [titlePosition, setTitlePosition] = useState<TitlePosition>('lower');
  const [titleDuration, setTitleDuration] = useState(3);

  const located = selectedClipId ? findClip(api.doc, selectedClipId) : null;
  const clip = located?.clip ?? null;

  function run(command: Result<SceneCommand>): void {
    if (!command.ok) {
      setError(
        command.error.detail
          ? `${command.error.message} ${command.error.detail}`
          : command.error.message,
      );
      return;
    }
    setError(null);
    void api.run(command);
  }

  return (
    <section aria-labelledby="clip-inspector-heading" className="space-y-3">
      <div>
        <h2 id="clip-inspector-heading" className="text-fg text-sm font-medium">
          {clip ? (isTitleClip(clip) ? 'Title' : 'Clip') : 'Composition'}
        </h2>
        <p className="text-fg-subtle mt-0.5 text-xs">
          {clip
            ? isTitleClip(clip)
              ? 'Text drawn over the picture. It exports with the frames and is recorded in a capture.'
              : `Media clip from “${clip.name}”, ${String(clip.inPoint.toFixed(2))}–${String(
                  (clip.inPoint + clip.duration).toFixed(2),
                )} s of the source.`
            : 'Nothing selected. The timeline length and frame rate are document settings and are saved with it.'}
        </p>
      </div>

      {error ? (
        <InlineNote tone="warning" title="That edit was refused">
          {error}
        </InlineNote>
      ) : null}

      {clip ? (
        <div className="space-y-3">
          <Field label="Start (s)">
            <Input
              type="number"
              step="0.01"
              min={0}
              max={payload.duration}
              defaultValue={clip.start.toFixed(2)}
              key={`start-${clip.id}-${String(clip.start)}`}
              onBlur={(event) => {
                run(
                  moveClipCommand(api.doc, {
                    clipId: clip.id,
                    toStart: Number(event.target.value),
                  }),
                );
              }}
            />
          </Field>

          {isTitleClip(clip) ? (
            <>
              <Field label="Text">
                <Input
                  value={clip.text}
                  maxLength={200}
                  onChange={(event) => {
                    run(updateTitleCommand(api.doc, clip.id, { text: event.target.value }));
                  }}
                />
              </Field>
              <Field label="Position">
                <Select
                  value={clip.position}
                  onChange={(event) => {
                    const position = TITLE_POSITIONS.find(
                      (candidate) => candidate === event.target.value,
                    );
                    if (position) run(updateTitleCommand(api.doc, clip.id, { position }));
                  }}
                  options={TITLE_POSITIONS.map((position) => ({
                    value: position,
                    label: TITLE_POSITION_LABELS[position],
                  }))}
                />
              </Field>
              <Field label="Colour">
                <Input
                  type="color"
                  value={clip.color}
                  aria-label="Title colour"
                  onChange={(event) => {
                    run(updateTitleCommand(api.doc, clip.id, { color: event.target.value }));
                  }}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Duration (s)">
                <Input
                  type="number"
                  step="0.01"
                  min={0.1}
                  key={`duration-${clip.id}-${String(clip.duration)}`}
                  defaultValue={clip.duration.toFixed(2)}
                  onBlur={(event) => {
                    run(
                      trimClipCommand(api.doc, {
                        clipId: clip.id,
                        edge: 'end',
                        to: clip.start + Number(event.target.value),
                      }),
                    );
                  }}
                />
              </Field>
              <Field label="Volume" labelSuffix={`${String(Math.round(clip.volume * 100))}%`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={clip.volume}
                  aria-label="Clip volume"
                  className="accent-accent w-full"
                  onChange={(event) => {
                    run(
                      setClipAudioCommand(api.doc, {
                        clipId: clip.id,
                        volume: Number(event.target.value),
                      }),
                    );
                  }}
                />
              </Field>
              <label className="text-fg-muted flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={clip.muted}
                  aria-label="Mute clip"
                  onChange={(event) => {
                    run(
                      setClipAudioCommand(api.doc, {
                        clipId: clip.id,
                        muted: event.target.checked,
                      }),
                    );
                  }}
                />
                Muted
              </label>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Scissors aria-hidden />}
              onClick={() => {
                run(splitClipCommand(api.doc, clip.id, time));
              }}
            >
              Split at playhead
            </Button>
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Trash2 aria-hidden />}
              onClick={() => {
                run(removeClipCommand(api.doc, clip.id));
              }}
            >
              Remove clip
            </Button>
          </div>
        </div>
      ) : null}

      <div className="border-ink-800 space-y-3 border-t pt-3">
        <h3 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
          Add a title at the playhead
        </h3>
        <Field label="Title text">
          <Input
            value={titleText}
            maxLength={200}
            placeholder="Launch day"
            onChange={(event) => {
              setTitleText(event.target.value);
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Position">
            <Select
              value={titlePosition}
              onChange={(event) => {
                const position = TITLE_POSITIONS.find(
                  (candidate) => candidate === event.target.value,
                );
                if (position) setTitlePosition(position);
              }}
              options={TITLE_POSITIONS.map((position) => ({
                value: position,
                label: TITLE_POSITION_LABELS[position],
              }))}
            />
          </Field>
          <Field label="Length (s)">
            <Input
              type="number"
              min={0.1}
              step="0.1"
              value={titleDuration}
              onChange={(event) => {
                setTitleDuration(Number(event.target.value));
              }}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={titleText.trim().length === 0}
          onClick={() => {
            run(
              addTitleCommand(api.doc, {
                text: titleText,
                start: time,
                duration: titleDuration,
                position: titlePosition,
              }),
            );
            setTitleText('');
          }}
        >
          Add title
        </Button>
      </div>

      <div className="border-ink-800 space-y-3 border-t pt-3">
        <h3 className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase">
          Composition
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Length (s)">
            <Input
              type="number"
              min={1}
              max={MAX_VIDEO_DURATION}
              key={`duration-setting-${String(payload.duration)}`}
              defaultValue={payload.duration}
              onBlur={(event) => {
                run(setTimelineCommand(api.doc, { duration: Number(event.target.value) }));
              }}
            />
          </Field>
          <Field label="Frame rate">
            <Input
              type="number"
              min={1}
              max={MAX_VIDEO_FPS}
              key={`fps-setting-${String(payload.fps)}`}
              defaultValue={payload.fps}
              onBlur={(event) => {
                run(setTimelineCommand(api.doc, { fps: Number(event.target.value) }));
              }}
            />
          </Field>
        </div>
        <p className="text-fg-subtle text-2xs">
          The frame rate decides how many frames a second of the export contains; it does not
          resample the source footage.
        </p>
      </div>
    </section>
  );
}
