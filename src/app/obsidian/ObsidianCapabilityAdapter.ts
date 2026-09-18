import { type App, TFile } from 'obsidian';

import type {
  ObsidianPropertyValue,
  ObsidianWorkspaceAdapter,
} from '../../core/obsidian/ObsidianWorkspaceAdapter';

function assertVaultPath(path: string): string {
  const normalized = path.trim().replaceAll('\\', '/');
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error('Obsidian path must be vault-relative.');
  }
  return normalized;
}

/**
 * Application-owned adapter. The first implementation deliberately uses the
 * live Obsidian API for vault operations. The adapter intentionally stays
 * inside the active Obsidian app and does not spawn an external process.
 */
export class ObsidianCapabilityAdapter implements ObsidianWorkspaceAdapter {
  constructor(private readonly app: App) {}

  async setProperty(path: string, name: string, value: ObsidianPropertyValue): Promise<void> {
    const file = this.getFile(path);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (value === null) {
        delete frontmatter[name];
      } else {
        frontmatter[name] = value;
      }
    });
  }

  async move(path: string, destination: string): Promise<void> {
    await this.app.fileManager.renameFile(this.getFile(path), assertVaultPath(destination));
  }

  async trash(path: string): Promise<void> {
    await this.app.fileManager.trashFile(this.getFile(path));
  }

  async backlinks(path: string): Promise<string[]> {
    const target = assertVaultPath(path);
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    return Object.entries(resolvedLinks)
      .filter(([, links]) => Object.prototype.hasOwnProperty.call(links, target))
      .map(([source]) => source)
      .sort();
  }

  private getFile(path: string): TFile {
    const normalized = assertVaultPath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      throw new Error(`Obsidian file not found: ${normalized}`);
    }
    return file;
  }

}
