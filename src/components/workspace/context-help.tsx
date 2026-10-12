'use client';

import { BookOpen, ChevronDown, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { getConcepts, listToolExplanations } from '../../core/learning/query';
import { cn } from '../../lib/cn';
import { Kbd } from '../ui/kbd';

/**
 * Contextual learning panel.
 *
 * The learning layer's claim is that explanations live *inside* editing, not only in a separate
 * course. This panel renders the typed tool explanations for the Design Studio alongside the
 * inspector, and the command palette can jump straight to it. Content is curated — there is no
 * generated or adaptive explanation here.
 */
export function ContextHelp({ studioId = 'design' }: { readonly studioId?: string }) {
  const tools = listToolExplanations(studioId);
  const firstTool = tools[0];
  const [openToolId, setOpenToolId] = useState<string | null>(
    firstTool ? String(firstTool.id) : null,
  );

  // The palette can request a specific topic: `forge:open-help` carries the tool id.
  useEffect(() => {
    function handle(event: Event) {
      // The event is dispatched from the command palette; treat the payload as untrusted.
      const detail = (event as CustomEvent<{ topicId?: string } | undefined>).detail;
      if (detail?.topicId) setOpenToolId(detail.topicId);
    }
    window.addEventListener('forge:open-help', handle);
    return () => {
      window.removeEventListener('forge:open-help', handle);
    };
  }, []);

  return (
    <section id="contextual-help" aria-labelledby="context-help-heading" className="space-y-3">
      <div>
        <h2
          id="context-help-heading"
          className="text-fg inline-flex items-center gap-2 text-base font-semibold"
        >
          <GraduationCap aria-hidden className="text-accent size-4" />
          Learn while you work
        </h2>
        <p className="text-fg-muted mt-0.5 text-sm">
          Short explanations of the controls on this screen, written by hand — no generated text and
          no claim that these are interactive lessons.
        </p>
      </div>

      <div className="space-y-2">
        {tools.map((tool) => {
          const open = openToolId === (tool.id as string);
          const concepts = getConcepts(tool.relatedConceptIds);
          return (
            <div
              key={tool.id}
              className="border-line bg-surface-raised/50 overflow-hidden rounded-md border"
            >
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`tool-${String(tool.id)}`}
                onClick={() => {
                  setOpenToolId(open ? null : tool.id);
                }}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="text-fg block text-base font-medium">{tool.toolLabel}</span>
                  <span className="text-fg-muted mt-0.5 block text-sm">{tool.summary}</span>
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'text-fg-subtle size-4 shrink-0 transition-transform',
                    open && 'rotate-180',
                  )}
                />
              </button>

              {open ? (
                <div
                  id={`tool-${String(tool.id)}`}
                  className="border-line-subtle space-y-3 border-t px-3.5 py-3"
                >
                  <div className="space-y-1">
                    <p className="text-fg-muted text-sm">{tool.whatItDoes}</p>
                    <p className="text-fg-muted text-sm">
                      <span className="text-fg font-medium">Why it matters: </span>
                      {tool.whyUseIt}
                    </p>
                  </div>

                  <dl className="space-y-2.5">
                    {tool.settings.map((setting) => (
                      <div
                        key={setting.name}
                        className="border-line-subtle bg-ink-950/50 rounded-sm border p-2.5"
                      >
                        <dt className="text-fg text-sm font-medium">{setting.name}</dt>
                        <dd className="text-fg-muted mt-1 space-y-1 text-xs">
                          <p>{setting.whatItDoes}</p>
                          <p>
                            <span className="text-fg-subtle">Typical values: </span>
                            {setting.typicalValues}
                          </p>
                          {setting.advancedAlternative ? (
                            <p>
                              <span className="text-fg-subtle">Going further: </span>
                              {setting.advancedAlternative}
                            </p>
                          ) : null}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {tool.whenAdvancedIsAppropriate.length > 0 ? (
                    <div>
                      <p className="text-2xs text-fg-subtle font-medium tracking-wide uppercase">
                        When advanced controls are worth it
                      </p>
                      <ul className="mt-1 space-y-1">
                        {tool.whenAdvancedIsAppropriate.map((item) => (
                          <li key={item} className="text-fg-muted flex gap-2 text-xs">
                            <span aria-hidden className="text-fg-subtle">
                              •
                            </span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {concepts.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {concepts.map((concept) => (
                        <span
                          key={concept.id}
                          title={concept.longDefinition}
                          className="border-line bg-ink-950 text-2xs text-fg-subtle rounded-xs border px-1.5 py-0.5"
                        >
                          {concept.term}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="border-line-subtle flex flex-wrap gap-x-3 gap-y-1 border-t pt-2.5">
                    {tool.relatedLessonSlugs.map((slug) => (
                      <Link
                        key={slug}
                        href={`/learn/${slug}`}
                        className="text-arc-300 hover:text-arc-400 inline-flex items-center gap-1.5 text-xs underline decoration-1 underline-offset-4"
                      >
                        <BookOpen aria-hidden className="size-3.5" />
                        {slug.replace(/-/g, ' ')}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-2xs text-fg-subtle">
        Tip: press <Kbd>⌘K</Kbd> and run “Explain the current tool” to jump back here.
      </p>
    </section>
  );
}
