import { ComposerDraftStorage } from '@/core/bootstrap/ComposerDraftStorage';

it('keeps drafts isolated and clears a sent draft without deleting another conversation', async () => {
  const files = new Map<string, string>();
  const adapter = {
    verifyManagedPath: jest.fn(async (path: string) => files.has(path)),
    ensureManagedFolder: jest.fn(async () => undefined),
    readManagedFile: jest.fn(async (path: string) => files.get(path)!),
    writeManagedFile: jest.fn(async (path: string, text: string) => { files.set(path, text); }),
    removeManagedFile: jest.fn(async (path: string) => { files.delete(path); }),
  };
  const storage = new ComposerDraftStorage(adapter as never);
  await storage.write('conversation', 'one', 'first @Folder/note.md');
  await storage.write('conversation', 'two', 'second');
  await storage.write('conversation', 'one', '');
  expect(await storage.read('conversation', 'one')).toBe('');
  expect(await storage.read('conversation', 'two')).toBe('second');
  expect(await storage.read('tab', 'two')).toBe('');
});

it('serializes writes to the same draft so a late old write cannot restore sent text', async () => {
  const files = new Map<string, string>();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const adapter = {
    verifyManagedPath: jest.fn(async (path: string) => files.has(path)),
    ensureManagedFolder: jest.fn(async () => undefined),
    readManagedFile: jest.fn(async (path: string) => files.get(path)!),
    writeManagedFile: jest.fn(async (path: string, text: string) => { await blocked; files.set(path, text); }),
    removeManagedFile: jest.fn(async (path: string) => { files.delete(path); }),
  };
  const storage = new ComposerDraftStorage(adapter as never);
  const older = storage.write('conversation', 'one', 'unsent');
  const cleared = storage.write('conversation', 'one', '');
  release();
  await Promise.all([older, cleared]);
  expect(await storage.read('conversation', 'one')).toBe('');
});

it('lists only valid blank-tab draft files', async () => {
  const adapter = {
    verifyManagedPath: jest.fn(async () => true),
    listManagedFolder: jest.fn(async () => ({ files: [
      '.claudian/drafts/tab-tab-1.json', '.claudian/drafts/conversation-conv-1.json',
      '.claudian/drafts/tab-..%2fsecret.json', '.claudian/drafts/unrelated.txt',
    ], folders: [] })),
  };
  const storage = new ComposerDraftStorage(adapter as never);
  expect(await storage.listTabDrafts()).toEqual(['tab-1']);
});

it('rejects malformed stored drafts without modifying their contents', async () => {
  const adapter = {
    verifyManagedPath: jest.fn().mockResolvedValue(true),
    readManagedFile: jest.fn().mockResolvedValue('{corrupted'),
    writeManagedFile: jest.fn(),
    removeManagedFile: jest.fn(),
  };
  const storage = new ComposerDraftStorage(adapter as never);
  await expect(storage.read('conversation', 'one')).rejects.toThrow();
  expect(adapter.writeManagedFile).not.toHaveBeenCalled();
  expect(adapter.removeManagedFile).not.toHaveBeenCalled();
});
