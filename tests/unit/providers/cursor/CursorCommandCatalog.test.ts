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
});
