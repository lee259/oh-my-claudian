import '@/providers';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProviderHost } from '@/core/providers/ProviderHost';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { setLocale } from '@/i18n/i18n';

describe('DeepSeek CLI preflight', () => {
  beforeEach(() => { setLocale('zh-CN'); });
  afterEach(() => { setLocale('en'); });
  it('registers lifecycle preflight and probes the configured npm entry without replacing its installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-lifecycle-'));
    const entry = join(root, 'bin.js');
    await writeFile(entry, '#!/usr/bin/env node\n');
    try {
      const adapter = ProviderRegistry.getCliLifecycleAdapter('deepseek');
      expect(adapter).toBeDefined();
      const host = { settings: { providerConfigs: { deepseek: { environmentVariables: 'DSH_HOME=/isolated/native' } } },
        getResolvedProviderCliPath: async () => entry,
        app: { vault: { adapter: { basePath: root } } },
      } as unknown as ProviderHost;
      const target = await adapter!.resolveTarget(host);
      expect(target).toMatchObject({ path: entry, versionCommand: { args: [entry, '--version'] },
        environment: { DSH_HOME: '/isolated/native' }, updateCommand: null });
      expect(target?.updateHint).toBe('如需更新，请使用安装 dsh 时的包管理器（如 npm 或 pnpm）。');
      expect(await adapter!.resolveInstallCommand(host)).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('probes Desktop with its bundled executable and keeps updates with Desktop', async () => {
    const path = process.platform === 'win32' ? 'C:/Users/probe/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd' : '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
    const adapter = ProviderRegistry.getCliLifecycleAdapter('deepseek');
    expect(adapter).toBeDefined();
    const host = { settings: {}, getResolvedProviderCliPath: async () => path,
      app: { vault: { adapter: { basePath: '/vault' } } },
    } as unknown as ProviderHost;
    const target = await adapter!.resolveTarget(host);
    expect(target?.versionCommand.command).toBe(process.platform === 'win32' ? join('C:/Users/probe/DeepSeek Harness', 'DeepSeek Harness.exe') : '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness');
    expect(target?.versionCommand.args[0]).toBe('-p');
    expect(target?.versionCommand.args[1].split(String.fromCharCode(92)).filter(Boolean).join('/')).toContain('app.asar/dsh/node_modules/@deepseek-ai/dsh/package.json');
    expect(target?.environment.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(target?.updateCommand).toBeNull();
    expect(target?.updateHint).toBe('如需更新，请前往 DeepSeek Harness Desktop。');
  });
});
