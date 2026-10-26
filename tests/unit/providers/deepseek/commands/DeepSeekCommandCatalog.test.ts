import { DeepSeekCommandCatalog } from '@/providers/deepseek/commands/DeepSeekCommandCatalog';

it('declares native compact before any DeepSeek command or skill discovery', () => {
  const catalog = new DeepSeekCommandCatalog();
  expect(catalog.getDropdownConfig().builtInCommands).toEqual([
    expect.objectContaining({
      providerId: 'deepseek', name: 'compact', kind: 'command', source: 'builtin',
      displayPrefix: '/', insertPrefix: '/', isEditable: false, isDeletable: false,
    }),
  ]);
});
