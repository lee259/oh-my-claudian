import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { App } from 'obsidian';

import { AgentSkillRepository } from '@/core/skills/AgentSkillRepository';
import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { ClaudeSkillMigration } from '@/providers/claude/skills/ClaudeSkillMigration';

it('copies a reviewed package, including binary files and permissions, without changing its source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-skill-migration-'));
  const resolve = (relative: string) => path.join(root, ...relative.split('/'));
  const adapter = {
    getBasePath: () => root,
    exists: async (relative: string) => fs.access(resolve(relative)).then(() => true, () => false),
    mkdir: async (relative: string) => fs.mkdir(resolve(relative)),
    list: async (relative: string) => {
      const entries = await fs.readdir(resolve(relative), { withFileTypes: true });
      return { files: entries.filter(entry => !entry.isDirectory()).map(entry => `${relative}/${entry.name}`),
        folders: entries.filter(entry => entry.isDirectory()).map(entry => `${relative}/${entry.name}`) };
    },
    read: async (relative: string) => fs.readFile(resolve(relative), 'utf8'),
    readBinary: async (relative: string) => Uint8Array.from(await fs.readFile(resolve(relative))).buffer,
    remove: async (relative: string) => fs.unlink(resolve(relative)),
    rmdir: async (relative: string) => fs.rmdir(resolve(relative)),
  };
  try {
    const source = resolve('.claude/skills/review');
    await fs.mkdir(path.join(source, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(source, 'empty'));
    const markdown = '---\nname: review\ndescription: Review changes\n---\nReview carefully.\n';
    await fs.writeFile(path.join(source, 'SKILL.md'), markdown);
    await fs.writeFile(path.join(source, 'scripts', 'check'), Buffer.from([0, 1, 255]));
    if (process.platform !== 'win32') {
      await fs.chmod(source, 0o700);
      await fs.chmod(path.join(source, 'scripts'), 0o700);
      await fs.chmod(path.join(source, 'scripts', 'check'), 0o755);
    }
    const files = new VaultFileAdapter({ vault: { adapter } } as unknown as App);
    const migration = new ClaudeSkillMigration(files);
    const [candidate] = await migration.preview();
    expect(candidate.blocked).toBe(false);
    const prepared = await migration.prepare(candidate);
    const repository = new AgentSkillRepository(files);
    await repository.importPackage(prepared.name, prepared.markdown, prepared.files, prepared.directories, prepared.rootMode);
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe(markdown);
    expect(await fs.readFile(path.join(source, 'scripts', 'check'))).toEqual(Buffer.from([0, 1, 255]));
    expect(await fs.readFile(resolve('.agents/skills/review/scripts/check'))).toEqual(Buffer.from([0, 1, 255]));
    expect((await fs.stat(resolve('.agents/skills/review/empty'))).isDirectory()).toBe(true);
    const rootMode = (await fs.stat(resolve('.agents/skills/review'))).mode & 0o777;
    const fileMode = (await fs.stat(resolve('.agents/skills/review/scripts/check'))).mode & 0o777;
    expect(process.platform === 'win32' || rootMode === 0o700).toBe(true);
    expect(process.platform === 'win32' || fileMode === 0o755).toBe(true);
    await expect(repository.importPackage(prepared.name, prepared.markdown, prepared.files, prepared.directories, prepared.rootMode)).rejects.toThrow();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
