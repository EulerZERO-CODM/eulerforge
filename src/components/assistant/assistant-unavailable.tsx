'use client';

import { STUDIO_LABELS, toolsForStudio } from '../../core/assistant/registry';
import { InlineNote } from '../ui/states';

/**
 * The assistant's honest face in a studio it cannot edit.
 *
 * Motion and Video have timeline controls that work, and the assistant has no native tool for
 * either of them yet. Rendering the full request field here would offer a textarea whose plans could
 * only fail, so this panel states the boundary, names the specific operations that are missing, and
 * points at the controls that do work. It is a refusal surface, not a disabled one: nothing is
 * hidden and nothing pretends.
 */
export function AssistantUnavailable({ studio }: { readonly studio: 'motion' | 'video' }) {
  const missing = toolsForStudio(studio).filter((tool) => tool.availability.kind !== 'native');
  const alternatives =
    studio === 'motion'
      ? [
          'Add keyframes and edit easing on the timeline, layer by layer.',
          'Use the transport and the verified frame-sequence export to check the result.',
        ]
      : [
          'Trim and place clips on the timeline, and adjust volume in the clip inspector.',
          'Export a PNG sequence for an exact render, or record a real-time WebM capture.',
        ];

  return (
    <section aria-labelledby={`assistant-${studio}-heading`} className="space-y-2">
      <div>
        <h3
          id={`assistant-${studio}-heading`}
          className="text-2xs text-fg-subtle font-semibold tracking-wider uppercase"
        >
          Assistant
        </h3>
        <p className="text-fg-subtle mt-0.5 text-xs" data-testid="assistant-unavailable">
          The assistant cannot edit {STUDIO_LABELS[studio]} in this build. It does not guess at
          steps it cannot run, so there is no request field here — the studio’s own controls remain
          the editing surface.
        </p>
      </div>
      <InlineNote tone="neutral" title="What is missing, specifically">
        <ul className="space-y-1" data-testid="assistant-unavailable-tools">
          {missing.map((tool) => (
            <li key={tool.id}>
              <span className="forge-numeric">{tool.id}</span>
              {tool.availability.kind === 'native' ? null : ` — ${tool.availability.reason}`}
            </li>
          ))}
        </ul>
      </InlineNote>
      <div className="text-fg-subtle text-xs">
        <p>What still works:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {alternatives.map((alternative) => (
            <li key={alternative}>{alternative}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
