import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import { assertValidSessionMetadataId, isValidSessionMetadataId } from './SessionStorage';
import { CLAUDIAN_STORAGE_PATH } from './storagePaths';

export type ComposerDraftScope = 'conversation' | 'tab';

/** Stores unsent text independently of conversation metadata and tab layout. */
export class ComposerDraftStorage {
  private readonly writes = new Map<string, Promise<void>>();

  constructor(private readonly adapter: Pick<VaultFileAdapter, 'verifyManagedPath' | 'readManagedFile' | 'ensureManagedFolder' | 'writeManagedFile' | 'removeManagedFile' | 'listManagedFolder'>) {}

  async listTabDrafts(): Promise<string[]> {
    const folder = `${CLAUDIAN_STORAGE_PATH}/drafts`;
    if (!await this.adapter.verifyManagedPath(folder, { expectedType: 'folder', allowMissing: true })) return [];
    const { files } = await this.adapter.listManagedFolder(folder);
    return files.flatMap(file => {
      const prefix = `${folder}/tab-`;
      if (!file.startsWith(prefix) || !file.endsWith('.json')) return [];
      const id = file.slice(prefix.length, -'.json'.length);
      return isValidSessionMetadataId(id) ? [id] : [];
    });
  }

  async read(scope: ComposerDraftScope, id: string): Promise<string> {
    const path = this.path(scope, id);
    await this.writes.get(path);
    if (!await this.adapter.verifyManagedPath(path, { expectedType: 'file', allowMissing: true })) return '';
    const value: unknown = JSON.parse(await this.adapter.readManagedFile(path));
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
      || !('text' in value) || typeof value.text !== 'string') {
      throw new Error('Invalid composer draft');
    }
    return value.text;
  }

  async write(scope: ComposerDraftScope, id: string, text: string): Promise<void> {
    const path = this.path(scope, id);
    const previous = this.writes.get(path) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      if (text === '') await this.adapter.removeManagedFile(path);
      else {
        await this.adapter.ensureManagedFolder(`${CLAUDIAN_STORAGE_PATH}/drafts`);
        await this.adapter.writeManagedFile(path, JSON.stringify({ version: 1, text }));
      }
    });
    this.writes.set(path, next);
    try { await next; } finally { if (this.writes.get(path) === next) this.writes.delete(path); }
  }

  private path(scope: ComposerDraftScope, id: string): string {
    assertValidSessionMetadataId(id);
    return `${CLAUDIAN_STORAGE_PATH}/drafts/${scope}-${id}.json`;
  }
}
