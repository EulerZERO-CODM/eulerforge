/**
 * Command registry.
 *
 * Every user-triggerable action in the shell is a command: the command palette, the keyboard shortcut
 * layer and future menus all read from here. Commands are declared with metadata (group, keywords,
 * shortcut) and a `run` function that receives an explicit context — no component reaches into
 * another component's state to trigger an action.
 */

export type CommandGroup = 'navigation' | 'project' | 'document' | 'learning' | 'help';

export const COMMAND_GROUP_LABELS: Readonly<Record<CommandGroup, string>> = {
  navigation: 'Navigate',
  project: 'Projects',
  document: 'Document',
  learning: 'Learn',
  help: 'Help',
};

/** Everything a command is allowed to do. Provided by the shell, never imported directly. */
export interface CommandContext {
  navigate(href: string): void;
  /** Opens the project creation flow. */
  startNewProject(): void;
  /** Opens the contextual help panel for a topic id, if a surface is available. */
  openHelp?(topicId: string): void;
  /** Announces an outcome to the user (toast). */
  notify?(message: string, tone?: 'info' | 'success' | 'warning'): void;
}

export type CommandDefinition = {
  readonly id: string;
  readonly title: string;
  /** Extra words that should match this command, e.g. "artboard" for canvas settings. */
  readonly keywords: readonly string[];
  readonly group: CommandGroup;
  /** Displayed as a keyboard hint. Availability is reported by `isAvailable`. */
  readonly shortcut?: string;
  readonly run: (context: CommandContext) => void | Promise<void>;
  /** Commands that only make sense in some contexts can opt out at query time. */
  readonly isAvailable?: (availability: CommandAvailability) => boolean;
};

/** Runtime facts a command may depend on. Kept small and explicit rather than a global store. */
export type CommandAvailability = {
  readonly hasDocuments: boolean;
  readonly documentCount: number;
  readonly pathname: string;
};

export type CommandSearchResult = {
  readonly command: CommandDefinition;
  readonly score: number;
};

function scoreCommand(command: CommandDefinition, needle: string): number {
  const title = command.title.toLowerCase();
  if (title === needle) return 100;
  if (title.startsWith(needle)) return 80;
  if (title.includes(needle)) return 60;
  if (command.keywords.some((keyword) => keyword.toLowerCase() === needle)) return 50;
  if (command.keywords.some((keyword) => keyword.toLowerCase().startsWith(needle))) return 40;
  if (command.keywords.some((keyword) => keyword.toLowerCase().includes(needle))) return 30;
  if (command.group.includes(needle)) return 20;
  return 0;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  public register(command: CommandDefinition): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered.`);
    }
    this.commands.set(command.id, command);
  }

  public registerAll(commands: readonly CommandDefinition[]): void {
    for (const command of commands) this.register(command);
  }

  public get(id: string): CommandDefinition | undefined {
    return this.commands.get(id);
  }

  public list(): readonly CommandDefinition[] {
    return [...this.commands.values()];
  }

  public listAvailable(availability: CommandAvailability): readonly CommandDefinition[] {
    return this.list().filter((command) => command.isAvailable?.(availability) ?? true);
  }

  /**
   * Ranked, filtered search over the registered commands.
   * With an empty query, commands are returned grouped by their declared order.
   */
  public search(query: string, availability: CommandAvailability): readonly CommandSearchResult[] {
    const needle = query.trim().toLowerCase();
    const available = this.listAvailable(availability);
    if (!needle) return available.map((command) => ({ command, score: 0 }));

    return available
      .map((command) => ({ command, score: scoreCommand(command, needle) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title));
  }

  /** Test helper: number of registered commands. */
  public size(): number {
    return this.commands.size;
  }
}
