'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command as CommandIcon, CornerDownLeft, Search } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  COMMAND_GROUP_LABELS,
  CommandRegistry,
  type CommandAvailability,
  type CommandSearchResult,
} from '../../core/commands/registry';
import { cn } from '../../lib/cn';
import { useForgeServices } from '../../state/forge-provider';
import { useDocuments } from '../../state/hooks';
import { Kbd } from '../ui/kbd';
import { createShellCommands } from './commands';

/**
 * Command palette (Cmd/Ctrl + K).
 *
 * The palette is a view over the command registry: it does not know what any command does, only how
 * to search and run it. When a help surface is available (inside the workspace) the palette can also
 * open contextual explanations.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { bus, toasts } = useForgeServices();
  const documents = useDocuments();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  /** The highlighted row, kept in view so the reader can see what Enter will run. */
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  const registry = useMemo(() => {
    const created = new CommandRegistry();
    created.registerAll(createShellCommands());
    return created;
  }, []);

  const documentCount = documents.documents.length;

  const availability: CommandAvailability = useMemo(
    () => ({ hasDocuments: documentCount > 0, documentCount, pathname }),
    [documentCount, pathname],
  );

  const results: readonly CommandSearchResult[] = useMemo(
    () => registry.search(query, availability),
    [registry, query, availability],
  );

  // The list is scrollable and the palette holds more rows than it can show, so the highlighted one
  // has to be brought into view: a highlight below the fold is a highlight the reader cannot see.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results]);

  const runCommand = useCallback(
    (commandId: string) => {
      const command = registry.get(commandId);
      if (!command) return;
      onOpenChange(false);
      setQuery('');
      setActiveIndex(0);
      bus.emit('command:executed', { id: command.id, group: command.group });
      void Promise.resolve(
        command.run({
          navigate: (href) => {
            router.push(href);
          },
          startNewProject: () => {
            router.push('/create');
          },
          ...(pathname.startsWith('/workspace/')
            ? {
                openHelp: (topicId: string) => {
                  const anchor = document.getElementById('contextual-help');
                  anchor?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  window.dispatchEvent(new CustomEvent('forge:open-help', { detail: { topicId } }));
                },
              }
            : {}),
          notify: (message, tone) => {
            if (tone === 'warning') toasts.warning(message);
            else if (tone === 'success') toasts.success(message);
            else toasts.info(message);
          },
        }),
      ).catch((error: unknown) => {
        toasts.error(
          'That command could not run',
          error instanceof Error ? error.message : 'An unexpected error occurred.',
        );
      });
    },
    [bus, onOpenChange, pathname, registry, router, toasts],
  );

  const groups = useMemo(() => {
    const map = new Map<string, CommandSearchResult[]>();
    for (const result of results) {
      const key = result.command.group;
      map.set(key, [...(map.get(key) ?? []), result]);
    }
    return [...map.entries()];
  }, [results]);

  const flatResults = groups.flatMap(([, items]) => items);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in bg-ink-1000/70 fixed inset-0 z-50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="animate-scale-in border-line bg-surface-overlay shadow-overlay fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="border-line-subtle flex items-center gap-3 border-b px-4 py-3">
            <Search aria-hidden className="text-fg-subtle size-4 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIndex((index) => Math.min(index + 1, flatResults.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const target = flatResults[activeIndex];
                  if (target) runCommand(target.command.id);
                }
              }}
              placeholder="Search actions, studios and lessons…"
              aria-label="Search commands"
              className="text-md text-fg placeholder:text-fg-subtle h-6 w-full bg-transparent focus:outline-none"
            />
            <Kbd>Esc</Kbd>
          </div>

          <div className="forge-scroll max-h-[min(60vh,26rem)] overflow-y-auto p-2">
            {flatResults.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-fg text-base">No matching actions</p>
                <p className="text-fg-subtle mt-1 text-sm">
                  Try “canvas”, “palette”, “lesson” — or press Esc and browse a destination
                  directly.
                </p>
              </div>
            ) : (
              groups.map(([group, items]) => (
                <div key={group} className="mb-1">
                  <p className="text-2xs text-fg-subtle px-2 py-1.5 font-medium tracking-wide uppercase">
                    {COMMAND_GROUP_LABELS[group as keyof typeof COMMAND_GROUP_LABELS]}
                  </p>
                  <ul>
                    {items.map((result) => {
                      const index = flatResults.indexOf(result);
                      const active = index === activeIndex;
                      return (
                        <li key={result.command.id}>
                          <button
                            type="button"
                            ref={active ? activeRowRef : undefined}
                            onMouseEnter={() => {
                              setActiveIndex(index);
                            }}
                            onClick={() => {
                              runCommand(result.command.id);
                            }}
                            className={cn(
                              'flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-base transition-colors',
                              active
                                ? 'bg-ink-800 text-fg'
                                : 'text-fg-muted hover:bg-ink-850 hover:text-fg',
                            )}
                          >
                            <span className="truncate">{result.command.title}</span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              {result.command.shortcut ? (
                                <Kbd>{result.command.shortcut}</Kbd>
                              ) : null}
                              {active ? (
                                <CornerDownLeft aria-hidden className="text-fg-subtle size-3.5" />
                              ) : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>

          <div className="border-line-subtle text-2xs text-fg-subtle flex items-center justify-between gap-3 border-t px-4 py-2">
            <span className="inline-flex items-center gap-1.5">
              <CommandIcon aria-hidden className="size-3.5" />
              {registry.size()} actions registered
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              to move
              <Kbd>↵</Kbd>
              to run
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Global keyboard listener: Cmd/Ctrl + K opens the palette, `/` focuses it from anywhere. */
export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      const isSlashShortcut = event.key === '/' && !isTyping;

      if (isPaletteShortcut || isSlashShortcut) {
        event.preventDefault();
        onOpen();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onOpen]);
}
