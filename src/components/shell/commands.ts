import { studioRegistry } from '../../core/studios';
import { listLessons } from '../../core/learning/query';
import type { CommandAvailability, CommandDefinition } from '../../core/commands/registry';
import { NAV_GROUPS } from './nav-items';

/**
 * Shell commands.
 *
 * Built from the same data the navigation and registries use, so a studio, lesson or destination
 * added to its registry immediately becomes a palette entry. Commands are pure data plus a
 * `run(context)` function; nothing here touches the DOM or the router directly.
 *
 * Several commands deliberately point at the same destination (the navigation item and the project
 * action both open `/create`). They are merged by target so the palette lists a destination once,
 * with every keyword from each contributor — a palette that shows "New project" twice is a defect,
 * not a feature.
 */

type PlannedCommand = {
  /** Destination the command opens, used only to merge duplicates. `null` means "no destination". */
  readonly target: string | null;
  readonly command: CommandDefinition;
};

function mergeByTarget(planned: readonly PlannedCommand[]): readonly CommandDefinition[] {
  const merged: PlannedCommand[] = [];

  for (const entry of planned) {
    const existingIndex =
      entry.target === null
        ? -1
        : merged.findIndex((candidate) => candidate.target === entry.target);
    if (existingIndex === -1) {
      merged.push(entry);
      continue;
    }

    const existing = merged[existingIndex];
    if (!existing) continue;

    const contributors = [existing.command.isAvailable, entry.command.isAvailable];
    // If any contributor is unconditional, the merged command is available whenever the user is:
    // "Browse projects" must not inherit the "only when projects exist" guard of the shortcut that
    // shares its destination.
    const unconditional = contributors.some((predicate) => predicate === undefined);
    const predicates = contributors.filter(
      (predicate): predicate is (availability: CommandAvailability) => boolean =>
        predicate !== undefined,
    );

    merged[existingIndex] = {
      target: entry.target,
      command: {
        ...existing.command,
        // The first contributor keeps its title (explicit actions are declared first), while all
        // keywords and both titles stay searchable.
        keywords: [
          ...new Set([
            ...existing.command.keywords,
            ...entry.command.keywords,
            existing.command.title,
            entry.command.title,
          ]),
        ],
        ...(unconditional || predicates.length === 0
          ? {}
          : { isAvailable: (state) => predicates.some((predicate) => predicate(state)) }),
      },
    };
  }

  return merged.map((entry) => entry.command);
}

export function createShellCommands(): readonly CommandDefinition[] {
  const projectActions: PlannedCommand[] = [
    {
      target: '/create',
      command: {
        id: 'project.new',
        title: 'New project',
        keywords: ['create', 'document', 'canvas', 'start', 'blank', 'template'],
        group: 'project',
        run: (context) => {
          context.startNewProject();
        },
      },
    },
    {
      target: '/projects',
      command: {
        id: 'project.open-library',
        title: 'Browse projects',
        keywords: ['library', 'recent', 'documents', 'open', 'saved'],
        group: 'project',
        run: (context) => {
          context.navigate('/projects');
        },
      },
    },
    {
      target: '/projects',
      command: {
        id: 'project.open-most-recent',
        title: 'Open most recent project',
        keywords: ['continue', 'last', 'resume'],
        group: 'project',
        isAvailable: (availability) => availability.hasDocuments,
        run: (context) => {
          context.navigate('/projects');
        },
      },
    },
  ];

  const navigation: PlannedCommand[] = NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => ({
      target: item.href,
      command: {
        id: `nav.${item.href.replace(/\W+/g, '-')}`,
        title: item.label,
        keywords: [item.description, group.label, item.href],
        group: 'navigation' as const,
        run: (context) => {
          context.navigate(item.href);
        },
      },
    })),
  );

  const studios: PlannedCommand[] = studioRegistry.list().map((studio) => {
    const openable = studio.entry.route !== null;
    const target = studio.entry.route ?? `/studios/${studio.slug}`;
    return {
      target,
      command: {
        id: `studio.${studio.id}`,
        title: openable ? `Open ${studio.name}` : `${studio.name} — status`,
        keywords: [studio.name, studio.tagline, ...studio.produces, studio.availability],
        group: 'navigation' as const,
        run: (context) => {
          context.navigate(target);
        },
      },
    };
  });

  const lessons: PlannedCommand[] = listLessons().map((lesson) => ({
    target: `/learn/${lesson.slug}`,
    command: {
      id: `lesson.${lesson.slug}`,
      title: lesson.title,
      keywords: [lesson.summary, lesson.kind, lesson.difficulty, ...lesson.tags],
      group: 'learning' as const,
      run: (context) => {
        context.navigate(`/learn/${lesson.slug}`);
      },
    },
  }));

  const help: PlannedCommand[] = [
    {
      target: '/platform-status',
      command: {
        id: 'help.platform-status',
        title: 'What works today',
        keywords: ['status', 'implemented', 'honesty', 'capabilities', 'partial'],
        group: 'help',
        run: (context) => {
          context.navigate('/platform-status');
        },
      },
    },
    {
      target: '/roadmap',
      command: {
        id: 'help.roadmap',
        title: 'Read the roadmap',
        keywords: ['plan', 'next', 'phases', 'future', 'exploratory'],
        group: 'help',
        run: (context) => {
          context.navigate('/roadmap');
        },
      },
    },
    {
      target: null,
      command: {
        id: 'help.help-panel',
        title: 'Explain the current tool',
        keywords: ['learn', 'explain', 'help', 'contextual'],
        group: 'help',
        isAvailable: (availability) => availability.pathname.startsWith('/workspace/'),
        run: (context) => {
          context.openHelp?.('tool.canvas-settings');
        },
      },
    },
  ];

  return mergeByTarget([...projectActions, ...navigation, ...studios, ...lessons, ...help]);
}
