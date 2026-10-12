import { describe, expect, it, vi } from 'vitest';

import { CommandRegistry, type CommandAvailability, type CommandDefinition } from './registry';

const availability: CommandAvailability = {
  hasDocuments: true,
  documentCount: 2,
  pathname: '/',
};

function command(
  overrides: Partial<CommandDefinition> & Pick<CommandDefinition, 'id' | 'title'>,
): CommandDefinition {
  return {
    group: 'navigation',
    keywords: [],
    run: () => undefined,
    ...overrides,
  };
}

function createRegistry(commands: readonly CommandDefinition[] = []) {
  const registry = new CommandRegistry();
  registry.registerAll(commands);
  return registry;
}

describe('CommandRegistry', () => {
  it('rejects duplicate ids so the palette cannot show the same command twice', () => {
    const registry = createRegistry([command({ id: 'nav.home', title: 'Home' })]);
    expect(() => {
      registry.register(command({ id: 'nav.home', title: 'Home again' }));
    }).toThrow(/already registered/i);
    expect(registry.size()).toBe(1);
  });

  it('returns every available command for an empty query', () => {
    const registry = createRegistry([
      command({ id: 'nav.home', title: 'Home' }),
      command({ id: 'nav.studios', title: 'Studios' }),
    ]);
    expect(registry.search('   ', availability)).toHaveLength(2);
  });

  it('ranks exact titles above prefixes, substrings and keyword matches', () => {
    const registry = createRegistry([
      command({ id: 'c.exact', title: 'Export' }),
      command({ id: 'c.prefix', title: 'Export project file' }),
      command({ id: 'c.includes', title: 'Re-export everything' }),
      command({ id: 'c.keyword', title: 'Save', keywords: ['export'] }),
    ]);

    const ranked = registry.search('export', availability).map((result) => result.command.id);
    expect(ranked).toEqual(['c.exact', 'c.prefix', 'c.includes', 'c.keyword']);
  });

  it('matches on keywords and groups, and ignores non-matches', () => {
    const registry = createRegistry([
      command({ id: 'c.keyword', title: 'Open settings', keywords: ['preferences'] }),
      command({ id: 'c.group', title: 'Learn basics', group: 'learning' }),
      command({ id: 'c.other', title: 'Delete project', group: 'project' }),
    ]);

    expect(registry.search('preferences', availability).map((r) => r.command.id)).toEqual([
      'c.keyword',
    ]);
    expect(registry.search('learning', availability).map((r) => r.command.id)).toEqual(['c.group']);
    expect(registry.search('zzz', availability)).toHaveLength(0);
  });

  it('hides commands whose availability predicate fails', () => {
    const emptyLibrary: CommandAvailability = {
      hasDocuments: false,
      documentCount: 0,
      pathname: '/',
    };
    const registry = createRegistry([
      command({ id: 'c.always', title: 'New project' }),
      command({
        id: 'c.needs-docs',
        title: 'Open recent project',
        isAvailable: (state) => state.hasDocuments,
      }),
    ]);

    // Both titles contain "project" at the same score, so they fall back to alphabetical order.
    expect(registry.search('project', availability).map((r) => r.command.id)).toEqual([
      'c.always',
      'c.needs-docs',
    ]);
    expect(registry.search('project', emptyLibrary).map((r) => r.command.id)).toEqual(['c.always']);
  });

  it('keeps the declared order for an empty query and can run a command', () => {
    const run = vi.fn();
    const registry = createRegistry([
      command({ id: 'c.first', title: 'First', run }),
      command({ id: 'c.second', title: 'Second' }),
    ]);

    expect(registry.search('', availability).map((r) => r.command.id)).toEqual([
      'c.first',
      'c.second',
    ]);

    const found = registry.get('c.first');
    expect(found).toBeDefined();
    if (found) void found.run({} as never);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
