import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createHostCliLifecycleAdapter } from '@/core/providers/cli/HostCliLifecycleAdapter';
import type { ProviderHost } from '@/core/providers/ProviderHost';

describe('Host CLI lifecycle adapter', () => {
  it('uses the configured binary for both inspection and update even with a different PATH', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'claudian-cli-target-'));
    const cliPath = path.join(directory, 'agent');
    writeFileSync(cliPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const host = {
      app: { vault: { adapter: { basePath: '/vault' } } }, getResolvedProviderCliPath: async () => cliPath,
      getActiveEnvironmentVariables: () => 'PATH=/other/installation',
    } as unknown as ProviderHost;
    const adapter = createHostCliLifecycleAdapter('test', {
      binaryName: 'agent', displayName: 'Test', update: { command: 'agent', args: ['update'] },
    });
    try {
      const target = await adapter.resolveTarget(host);
      expect(target?.versionCommand).toEqual({ command: cliPath, args: ['--version'] });
      expect(target?.updateCommand).toEqual({ command: cliPath, args: ['update'] });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
