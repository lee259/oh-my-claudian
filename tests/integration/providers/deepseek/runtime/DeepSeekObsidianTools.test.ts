import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

import { ObsidianWorkspaceToolBridgeServer } from '@/app/obsidian/ObsidianWorkspaceToolBridgeServer';
import type { ObsidianWorkspaceAdapter } from '@/core/obsidian/ObsidianWorkspaceAdapter';
import { prepareDeepSeekLaunchArtifacts } from '@/providers/deepseek/runtime/DeepSeekLaunchArtifacts';

it('routes native tools only through the claimed session credential and revokes access on release', async () => {
  const adapter = { backlinks: jest.fn(async () => ['source.md']), move: jest.fn(), trash: jest.fn(), setProperty: jest.fn() } as ObsidianWorkspaceAdapter;
  const bridge = new ObsidianWorkspaceToolBridgeServer(adapter);
  const artifacts = await prepareDeepSeekLaunchArtifacts();
  try {
    const connection = await bridge.createConnection();
    bridge.setAllowedOperations(connection.token, ['backlinks']);
    await artifacts.writeObsidianConnection('root', connection);
    const patch = JSON.parse(await readFile(artifacts.patchPath, 'utf8'));
    const presets = patch.find((row: any) => row.insert).insert.slice(1);
    const tool = presets[0].config.plugins.find((row: any) => row.id === 'claudian-obsidian');
    expect(tool).toBeDefined();
    expect(await readFile(new URL(tool.name), 'utf8')).not.toContain(connection.token);
    const directoryMode = (await stat(tool.config.connectionDirectory)).mode & 0o777;
    expect(process.platform === 'win32' || directoryMode === 0o700).toBe(true);
    expect(presets.slice(2).every((row: any) => !row.config.plugins.some((plugin: any) => plugin.id === 'claudian-obsidian'))).toBe(true);
    const run = async (sessionId: string, operation = 'backlinks') => {
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
        const plugin = await import(process.argv[1]);
        let tool;
        plugin.apply({ tools: { register: value => { tool = value; } } }, JSON.parse(process.argv[2]));
        try {
          const result = await tool.execute({ operation: process.argv[4], path: 'target.md' }, { agent: { session: { id: process.argv[3] } }, signal: new AbortController().signal });
          process.stdout.write(JSON.stringify({ result }));
        } catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); }
      `, tool.name, JSON.stringify(tool.config), sessionId, operation]);
      return JSON.parse(stdout);
    };
    expect(await run('root')).toMatchObject({ result: { content: [{ type: 'text', text: expect.stringContaining('source.md') }] } });
    expect(adapter.backlinks).toHaveBeenCalledWith('target.md');
    expect(await run('other')).toMatchObject({ error: expect.stringContaining('not authorized') });
    expect(await run('root', 'trash')).toMatchObject({ error: expect.stringContaining('not allowed') });
    expect(adapter.trash).not.toHaveBeenCalled();
    bridge.releaseConnection(connection.token);
    expect(await run('root')).toMatchObject({ error: expect.stringContaining('401') });
    await artifacts.writeObsidianConnection('root', null);
    expect(await run('root')).toMatchObject({ error: expect.stringContaining('not authorized') });
  } finally {
    await artifacts.dispose();
    await bridge.dispose();
  }
});
