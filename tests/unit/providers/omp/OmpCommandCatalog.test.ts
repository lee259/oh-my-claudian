import { OmpCommandCatalog } from '@/providers/omp/commands/OmpCommandCatalog';

describe('OmpCommandCatalog', () => {
  it('projects OMP runtime commands as read-only slash entries', async () => {
    const catalog = new OmpCommandCatalog();
    catalog.setCommandSnapshot([
      { content: '', id: 'acp:compact', kind: 'command', name: 'compact', source: 'sdk' },
      { content: '', id: 'acp:skill:tdd', kind: 'skill', name: 'skill:tdd', source: 'sdk' },
    ]);

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([
      expect.objectContaining({
        displayPrefix: '/',
        insertPrefix: '/',
        isDeletable: false,
        isEditable: false,
        kind: 'command',
        name: 'compact',
        providerId: 'omp',
        scope: 'runtime',
      }),
      expect.objectContaining({ kind: 'skill', name: 'skill:tdd', providerId: 'omp' }),
    ]);
    expect(catalog.getDropdownConfig()).toMatchObject({
      providerId: 'omp',
      triggerChars: ['/'],
    });
  });

  it.each([
    // Conflict with Claudian's per-turn model and reasoning controls.
    'model', 'switch', 'effort', 'fast', 'slow', 'modelpreset',
    // Mutate OMP-native session identity or location Claudian resumes from.
    'session', 'move', 'wt', 'rename', 'pin', 'fresh',
    // Terminal, dashboard, or CLI-management surfaces.
    'stats', 'trace', 'browser', 'ssh', 'marketplace', 'plugins', 'reload-plugins', 'share', 'export', 'dump', 'changelog',
    // Shadowed by Claudian built-ins.
    'add-dir', 'remove-dir', 'dirs',
  ])('hides the %s command by default', async (name) => {
    const catalog = new OmpCommandCatalog();
    catalog.setCommandSnapshot([{ content: '', id: `acp:${name}`, name, source: 'sdk' }]);

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([]);
  });

  it('keeps useful native commands and every skill', async () => {
    const names = ['compact', 'context', 'usage', 'review', 'init', 'handoff', 'todo', 'memory', 'mcp', 'skill:model'];
    const catalog = new OmpCommandCatalog();
    catalog.setCommandSnapshot(names.map(name => ({
      content: '', id: `acp:${name}`, kind: name.startsWith('skill:') ? 'skill' : 'command', name, source: 'sdk',
    })));

    const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
    expect(entries.map(entry => entry.name)).toEqual(names);
  });
});
