import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Workspace, WorkspaceLeaf } from 'obsidian';
import { App, TFile } from 'obsidian';

import { openAgentSkillByName, openVaultFile, revealWorkspaceLeaf } from '@/utils/obsidianCompat';

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

    it('opens an allowlisted external text file through the injected system opener', async () => {
      const app = createApp([]);
      const openExternalFile = jest.fn().mockResolvedValue('');

      await expect(openVaultFile(app, '/Users/lee/notes/README.md', openExternalFile)).resolves.toBe(true);

      expect(openExternalFile).toHaveBeenCalledWith('/Users/lee/notes/README.md');
      expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    });

    it('does not pass non-text external files to the system opener', async () => {
      const app = createApp([]);
      const openExternalFile = jest.fn().mockResolvedValue('');

      await expect(openVaultFile(app, '/Users/lee/notes/screenshot.png', openExternalFile)).resolves.toBe(false);

      expect(openExternalFile).not.toHaveBeenCalled();
    });
  });

  describe('openAgentSkillByName', () => {
    it('opens a named skill from the vault skill directory', async () => {
      const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-skill-'));
      const skillPath = '.agents/skills/release-notes/SKILL.md';
      await fs.mkdir(path.join(vaultPath, '.agents/skills/release-notes'), { recursive: true });
      await fs.writeFile(path.join(vaultPath, skillPath), '# Release notes');
      const app = new App();
      const file = Object.assign(new TFile(), { path: skillPath });
      (app.vault.adapter as unknown as { basePath: string }).basePath = vaultPath;
      app.vault.getAbstractFileByPath = jest.fn((filePath: string) => filePath === skillPath ? file : null);
      const openFile = jest.fn().mockResolvedValue(undefined);
      app.workspace.getLeaf = jest.fn().mockReturnValue({ openFile });

      try {
        await expect(openAgentSkillByName(app, 'release-notes')).resolves.toBe(true);
        expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(skillPath);
        expect(openFile).toHaveBeenCalledWith(file);
      } finally {
        await fs.rm(vaultPath, { recursive: true, force: true });
      }
    });

    it('rejects skill names that could escape the managed skill directory', async () => {
      const app = new App();

      await expect(openAgentSkillByName(app, '../README')).resolves.toBe(false);
      expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    });
  });
});
