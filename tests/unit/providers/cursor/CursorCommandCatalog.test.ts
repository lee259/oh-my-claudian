import { CursorCommandCatalog } from '@/providers/cursor/commands/CursorCommandCatalog';

describe('CursorCommandCatalog', () => {
  it('projects Cursor runtime commands as read-only slash entries with a provider-owned deadline', async () => {
    const catalog = new CursorCommandCatalog();
    catalog.setCommandSnapshot([
      { content: '', id: 'acp:simplify', name: 'simplify', source: 'sdk' },
    ]);

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([
      expect.objectContaining({
        displayPrefix: '/',
        insertPrefix: '/',
        isDeletable: false,
        isEditable: false,
        kind: 'command',
        name: 'simplify',
        providerId: 'cursor',
        scope: 'runtime',
      }),
    ]);
    expect(catalog.getDropdownConfig()).toMatchObject({
      discoveryTimeoutMs: 'provider-owned',
      providerId: 'cursor',
      triggerChars: ['/'],
    });
  });

  it.each([
    'copy-request-id', 'rename-chat', 'statusline', 'update-cli-config', 'shell',
    'worktree', 'apply-worktree', 'delete-worktree', 'loop', 'origin', 'new-repo', 'share',
  ])('hides the %s command by default', async (name) => {
    const catalog = new CursorCommandCatalog();
    catalog.setCommandSnapshot([{ content: '', id: `acp:${name}`, name, source: 'sdk' }]);

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([]);
  });

  it('keeps useful Cursor commands and user skills', async () => {
    const names = ['simplify', 'multi-model-review', 'goal', 'create-skill', 'tdd'];
    const catalog = new CursorCommandCatalog();
    catalog.setCommandSnapshot(names.map(name => ({ content: '', id: `acp:${name}`, name, source: 'sdk' })));

    const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
    expect(entries.map(entry => entry.name)).toEqual(names);
  });
});
