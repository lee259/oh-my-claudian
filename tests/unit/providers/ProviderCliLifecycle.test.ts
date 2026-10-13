import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ManagedCommandRunner } from '@/core/process/ManagedCommandRunner';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { claudeCliLifecycle } from '@/providers/claude/runtime/ClaudeCliLifecycle';
import { codexCliLifecycle } from '@/providers/codex/runtime/CodexCliLifecycle';
import * as codexTargetResolver from '@/providers/codex/runtime/CodexExecutionTargetResolver';
import { cursorCliLifecycle } from '@/providers/cursor/runtime/CursorCliLifecycle';
import { grokCliLifecycle } from '@/providers/grok/runtime/GrokCliLifecycle';
import { ompCliLifecycle } from '@/providers/omp/runtime/OmpCliLifecycle';
import { opencodeCliLifecycle } from '@/providers/opencode/runtime/OpencodeCliLifecycle';
import { piCliLifecycle } from '@/providers/pi/runtime/PiCliLifecycle';

const adapters = [claudeCliLifecycle, codexCliLifecycle, cursorCliLifecycle, grokCliLifecycle,
  ompCliLifecycle, opencodeCliLifecycle, piCliLifecycle];

describe('Provider-owned CLI lifecycle launch policy', () => {
  let directory: string;
  let cliPath: string;
  let host: ProviderHost;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'claudian-provider-cli-'));
    cliPath = path.join(directory, 'configured-cli');
    writeFileSync(cliPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    host = {
      settings: {}, app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: async () => cliPath,
      getActiveEnvironmentVariables: () => 'PATH=/different/installation\nPI_PACKAGE_DIR=/pi-only',
    } as unknown as ProviderHost;
    jest.spyOn(ManagedCommandRunner.prototype, 'run').mockResolvedValue({ exitCode: 0, stdout: '' });
    jest.spyOn(codexTargetResolver, 'resolveCodexExecutionTargetAsync').mockResolvedValue({
      method: 'host-native', platformFamily: 'unix', platformOs: 'linux',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each(adapters)('inspects the exact configured installation of $metadata.displayName', async adapter => {
    const target = await adapter.resolveTarget(host);
    expect(target?.path).toBe(cliPath);
    expect(target?.versionCommand).toEqual({ command: cliPath, args: ['--version'] });
    expect(target?.identityCommand).toEqual({ command: cliPath, args: ['--help'] });
    expect(target?.installationIdentity).toEqual(expect.any(String));
  });

  it('keeps OMP isolated from inherited and configured Pi package state', async () => {
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = '/inherited/pi';
    try {
      const target = await ompCliLifecycle.resolveTarget(host);
      expect(target?.environment.PI_CODING_AGENT_DIR).toBeUndefined();
      expect(target?.environment.PI_PACKAGE_DIR).toBeUndefined();
      expect(target?.updateCommand).toEqual({ command: cliPath, args: ['update'] });
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });

  it('keeps Codex inspection and update in the selected WSL distribution', async () => {
    cliPath = '/custom/codex';
    jest.mocked(codexTargetResolver.resolveCodexExecutionTargetAsync).mockResolvedValue({
      method: 'wsl', platformFamily: 'unix', platformOs: 'linux', distroName: 'Ubuntu',
    });
    host.app.vault.adapter = { basePath: 'C:\\vault' } as never;
    const target = await codexCliLifecycle.resolveTarget(host);
    expect(target?.versionCommand).toEqual({ command: 'wsl.exe', args: [
      '--distribution', 'Ubuntu', '--cd', '/mnt/c/vault', cliPath, '--version',
    ] });
    expect(target?.updateCommand).toEqual({ command: 'wsl.exe', args: [
      '--distribution', 'Ubuntu', '--cd', '/mnt/c/vault', cliPath, 'update',
    ] });
  });

  it.each(['ChatGPT.app', 'Codex.app'])('offers application update guidance for the %s bundled Codex installation', async appName => {
    const bundledDirectory = path.join(directory, appName, 'Contents', 'Resources');
    mkdirSync(bundledDirectory, { recursive: true });
    cliPath = path.join(bundledDirectory, 'codex');
    writeFileSync(cliPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const target = await codexCliLifecycle.resolveTarget(host);
    expect(target?.updateCommand).toBeNull();
    expect(target?.updateHint).toContain('desktop application');
  });
});
