import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ConversationPersistenceStore } from '@/core/bootstrap/ConversationPersistenceStore';
import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual<typeof fs>('node:fs/promises');
  return { ...actual, rename: jest.fn(actual.rename), writeFile: jest.fn(actual.writeFile) };
});

const actualFs = jest.requireActual<typeof fs>('node:fs/promises');
let root: string;
let vault: VaultFileAdapter;

beforeEach(async () => {
  root = await actualFs.mkdtemp(path.join(os.tmpdir(), 'claudian-json-'));
  const resolve = (p: string) => path.join(root, p);
  const adapter = {
    getBasePath: () => root,
    exists: async (p: string) => actualFs.access(resolve(p)).then(() => true, () => false),
    mkdir: async (p: string) => { await actualFs.mkdir(resolve(p), { recursive: true }); },
    read: async (p: string) => actualFs.readFile(resolve(p), 'utf8'),
    write: async (p: string, data: string) => fs.writeFile(resolve(p), data, 'utf8'),
    remove: async (p: string) => actualFs.unlink(resolve(p)),
  };
  vault = new VaultFileAdapter({ vault: { adapter } } as never);
});

afterEach(async () => {
  jest.mocked(fs.writeFile).mockReset().mockImplementation(actualFs.writeFile);
  jest.mocked(fs.rename).mockReset().mockImplementation(actualFs.rename);
  await actualFs.rm(root, { recursive: true, force: true });
});

function failPartialWrite(): void {
  jest.mocked(fs.writeFile).mockImplementationOnce(async file => {
    await actualFs.writeFile(file, '{"trunca');
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  });
}

it('retains committed metadata when a replacement write fails partway', async () => {
  const store = new ConversationPersistenceStore(vault);
  const metadata = { id: 'sample', providerId: 'claude' as const, title: 'Committed', createdAt: 1, lastActivityAt: 2 };
  await store.saveMetadata(metadata);
  failPartialWrite();
  await expect(store.saveMetadata({ ...metadata, title: 'Changed' })).rejects.toThrow('disk full');
  await expect(store.metadataReader.loadMetadata('sample')).resolves.toEqual(metadata);
});

it('retains committed settings when a transaction write fails partway', async () => {
  const { ClaudianSettingsStorage } = await import('@/app/settings/ClaudianSettingsStorage');
  const { SettingsCoordinator } = await import('@/app/settings/SettingsCoordinator');
  const { DEFAULT_SETTINGS } = await import('@/providers/claude/types/settings');
  const settings = structuredClone(DEFAULT_SETTINGS);
  const storage = new ClaudianSettingsStorage(vault);
  await storage.save(settings);
  const coordinator = new SettingsCoordinator(settings, value => storage.save(value));
  failPartialWrite();
  await expect(coordinator.mutate(value => { value.userName = 'Changed'; })).rejects.toThrow('disk full');
  expect(settings.userName).not.toBe('Changed');
  await expect(storage.load()).resolves.toMatchObject({ userName: settings.userName });
});

it('retains the input ledger when replacement fails partway', async () => {
  const { ConversationInputLedgerStorage } = await import('@/core/bootstrap/ConversationInputLedgerStorage');
  const ledger = new ConversationInputLedgerStorage(vault);
  const original = { schemaVersion: 1 as const, conversationId: 'sample', records: [] };
  await ledger.save('sample', original);
  failPartialWrite();
  await expect(ledger.save('sample', original)).rejects.toThrow('disk full');
  await expect(ledger.load('sample')).resolves.toEqual({ status: 'loaded', ledger: original });
});

it('does not publish a deletion marker when its first write fails', async () => {
  const store = new ConversationPersistenceStore(vault);
  const metadata = { id: 'sample', providerId: 'claude' as const, title: 'Committed', createdAt: 1, lastActivityAt: 2 };
  await store.saveMetadata(metadata);
  failPartialWrite();
  await expect(store.markDeleted('sample', 3)).rejects.toThrow('disk full');
  await expect(store.isDeleted('sample')).resolves.toBe(false);
  await expect(store.metadataReader.loadMetadata('sample')).resolves.toEqual(metadata);
});

it('cleans a partially written temporary file', async () => {
  const store = new ConversationPersistenceStore(vault);
  failPartialWrite();
  await expect(store.markDeleted('sample', 3)).rejects.toThrow('disk full');
  expect(await actualFs.readdir(path.join(root, '.claudian/sessions'))).toEqual([]);
});

it('delegates writes for adapters without a desktop filesystem path', async () => {
  const write = jest.fn().mockResolvedValue(undefined);
  const adapter = { exists: jest.fn().mockResolvedValue(true), write };
  const nonDesktop = new VaultFileAdapter({ vault: { adapter } } as never);
  await nonDesktop.writeDurable('.claudian/example.json', '{}');
  expect(write).toHaveBeenCalledWith('.claudian/example.json', '{}');
});

const describePosix = process.platform === 'win32' ? describe.skip : describe;
describePosix('desktop link and permission compatibility', () => {
  it('preserves permissions even with a restrictive umask', async () => {
    await vault.writeDurable('.claudian/data.json', 'before');
    const target = path.join(root, '.claudian/data.json');
    await actualFs.chmod(target, 0o660);
    const previous = process.umask(0o077);
    try { await vault.writeDurable('.claudian/data.json', 'after'); } finally { process.umask(previous); }
    expect((await actualFs.stat(target)).mode & 0o777).toBe(0o660);
    expect(await actualFs.readFile(target, 'utf8')).toBe('after');
  });

  it.each(['symlink', 'hardlink'] as const)('keeps %s writes attached to the original file', async kind => {
    await actualFs.mkdir(path.join(root, '.claudian'));
    const original = path.join(root, 'original.json');
    const target = path.join(root, '.claudian/data.json');
    await actualFs.writeFile(original, 'before');
    if (kind === 'symlink') await actualFs.symlink(original, target);
    else await actualFs.link(original, target);
    await vault.writeDurable('.claudian/data.json', 'after');
    expect(await actualFs.readFile(original, 'utf8')).toBe('after');
    expect(kind === 'symlink' ? (await actualFs.lstat(target)).isSymbolicLink() : (await actualFs.stat(target)).nlink === 2).toBe(true);
  });

  it('supports a linked parent folder', async () => {
    await actualFs.mkdir(path.join(root, 'state'));
    await actualFs.symlink(path.join(root, 'state'), path.join(root, '.claudian'));
    await vault.writeDurable('.claudian/data.json', 'after');
    expect(await actualFs.readFile(path.join(root, 'state/data.json'), 'utf8')).toBe('after');
  });
});

it.each(['EACCES', 'EEXIST'])('keeps the committed file and removes the temporary file when rename fails with %s', async code => {
  await vault.writeDurable('.claudian/data.json', 'before');
  jest.mocked(fs.rename).mockRejectedValueOnce(Object.assign(new Error('rename failed'), { code }));
  await expect(vault.writeDurable('.claudian/data.json', 'after')).rejects.toThrow('rename failed');
  expect(await actualFs.readFile(path.join(root, '.claudian/data.json'), 'utf8')).toBe('before');
  expect(await actualFs.readdir(path.join(root, '.claudian'))).toEqual(['data.json']);
});
