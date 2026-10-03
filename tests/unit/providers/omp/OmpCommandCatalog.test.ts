import { OmpCommandCatalog } from '@/providers/omp/commands/OmpCommandCatalog';

describe('OmpCommandCatalog', () => {
  it('projects OMP runtime commands as read-only slash entries', async () => {
    const catalog = new OmpCommandCatalog();
    catalog.setCommandSnapshot([
      { content: '', id: 'acp:model', kind: 'command', name: 'model', source: 'sdk' },
      { content: '', id: 'acp:skill:tdd', kind: 'skill', name: 'skill:tdd', source: 'sdk' },
    ]);

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([
      expect.objectContaining({
        displayPrefix: '/',
        insertPrefix: '/',
        isDeletable: false,
        isEditable: false,
        kind: 'command',
        name: 'model',
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
});
