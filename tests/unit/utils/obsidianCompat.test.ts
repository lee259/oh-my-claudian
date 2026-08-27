import type { Workspace, WorkspaceLeaf } from 'obsidian';
import { App, TFile } from 'obsidian';

import { openVaultFile, revealWorkspaceLeaf } from '@/utils/obsidianCompat';

describe('obsidianCompat', () => {
  describe('revealWorkspaceLeaf', () => {
    it('reveals the workspace leaf', async () => {
      const leaf = {} as WorkspaceLeaf;
      const workspace = {
        revealLeaf: jest.fn().mockResolvedValue(undefined),
      } as unknown as Workspace;

      await revealWorkspaceLeaf(workspace, leaf);

      expect((workspace as unknown as { revealLeaf: jest.Mock }).revealLeaf).toHaveBeenCalledWith(leaf);
    });
  });

  describe('openVaultFile', () => {
    function createApp(files: string[]): App {
      const app = new App();
      const fileObjects = files.map((filePath) => Object.assign(new TFile(), { path: filePath }));
      app.vault.getAbstractFileByPath = jest.fn((filePath: string) => (
        fileObjects.find((file) => file.path === filePath) ?? null
      ));
      app.vault.getFiles = jest.fn(() => fileObjects);
      app.workspace.getLeaf = jest.fn().mockReturnValue({ openFile: jest.fn().mockResolvedValue(undefined) });
      return app;
    }

    it('opens a unique suffix match for a provider working-directory relative path', async () => {
      const app = createApp(['分享文档/AI/技术剖析/TencentDB Agent Memory 剖析.md']);

      await expect(openVaultFile(app, 'AI/技术剖析/TencentDB Agent Memory 剖析.md')).resolves.toBe(true);
      expect(app.workspace.getLeaf().openFile).toHaveBeenCalled();
    });

    it('does not guess when a relative path has multiple suffix matches', async () => {
      const app = createApp([
        '分享文档/AI/README.md',
        '归档/AI/README.md',
      ]);

      await expect(openVaultFile(app, 'AI/README.md')).resolves.toBe(false);
    });
  });
});
