import { type App,TFile } from 'obsidian';

import { ObsidianCapabilityAdapter } from '@/app/obsidian/ObsidianCapabilityAdapter';
function createApp() {
  const file = Object.assign(new TFile(), { path: 'Notes/Plan.md', extension: 'md' });
  const otherFile = Object.assign(new TFile(), { path: 'Notes/Other.md', extension: 'md' });
  const processFrontMatter = jest.fn(async (_file, update: (frontmatter: Record<string, unknown>) => void) => {
    const frontmatter: Record<string, unknown> = {};
    update(frontmatter);
  });
  const app = {
    vault: {
      getAbstractFileByPath: jest.fn((path: string) => path === file.path ? file : null),
      getMarkdownFiles: jest.fn(() => [file, otherFile]),
      read: jest.fn(async (target: { path: string }) => (
        target.path === file.path ? '# plan\nship it' : '# other\nplan'
      )),
      adapter: { basePath: '/vault' },
    },
    fileManager: {
      processFrontMatter,
      renameFile: jest.fn(async () => undefined),
      trashFile: jest.fn(async () => undefined),
    },
    metadataCache: {
      resolvedLinks: {
        'Notes/Source.md': { 'Notes/Plan.md': 1 },
        'Notes/Unrelated.md': { 'Notes/Other.md': 1 },
      },
    },
  } as unknown as App;

  return { app, file, processFrontMatter };
}

describe('ObsidianCapabilityAdapter', () => {
  it('reads and searches vault-relative markdown files', async () => {
    const { app } = createApp();
    const adapter = new ObsidianCapabilityAdapter(app);

    await expect(adapter.read('Notes/Plan.md')).resolves.toBe('# plan\nship it');
    await expect(adapter.search('plan')).resolves.toEqual([
      {
        path: 'Notes/Plan.md',
        matches: [{ line: 1, text: '# plan' }],
      },
      {
        path: 'Notes/Other.md',
        matches: [{ line: 2, text: 'plan' }],
      },
    ]);
  });

  it('delegates mutations to Obsidian file APIs', async () => {
    const { app, file, processFrontMatter } = createApp();
    const adapter = new ObsidianCapabilityAdapter(app);

    await adapter.setProperty('Notes/Plan.md', 'status', 'active');
    await adapter.move('Notes/Plan.md', 'Archive/Plan.md');
    await adapter.trash('Notes/Plan.md');
    await expect(adapter.backlinks('Notes/Plan.md')).resolves.toEqual(['Notes/Source.md']);

    expect(processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(file, 'Archive/Plan.md');
    expect(app.fileManager.trashFile).toHaveBeenCalledWith(file);
  });

  it('rejects absolute and parent-traversal paths', async () => {
    const { app } = createApp();
    const adapter = new ObsidianCapabilityAdapter(app);

    await expect(adapter.read('/outside.md')).rejects.toThrow('vault-relative');
    await expect(adapter.move('Notes/Plan.md', '../outside.md')).rejects.toThrow('vault-relative');
  });
});
