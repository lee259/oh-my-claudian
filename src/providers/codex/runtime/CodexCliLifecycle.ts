import { realpathSync } from 'node:fs';

import { ManagedCommandRunner } from '@/core/process/ManagedCommandRunner';
import { createHostCliLifecycleAdapter } from '@/core/providers/cli/HostCliLifecycleAdapter';
import type { ProviderCliLifecycleAdapter } from '@/core/providers/cli/ProviderCliLifecycle';
import { t } from '@/i18n/i18n';
import { getVaultPath } from '@/utils/path';

import { buildCodexAppServerEnvironment } from './codexAppServerSupport';
import { codexCliMetadata } from './CodexCliMetadata';
import { resolveCodexExecutionTargetAsync } from './CodexExecutionTargetResolver';
import { buildCodexLaunchSpec } from './CodexLaunchSpecBuilder';

const nativeAdapter = createHostCliLifecycleAdapter('codex', codexCliMetadata, {
  identityPattern: /\bcodex\b/iu,
  environment: host => buildCodexAppServerEnvironment(host),
});

export const codexCliLifecycle: ProviderCliLifecycleAdapter = {
  metadata: codexCliMetadata,
  async resolveInstallCommand(host) {
    const hostVaultPath = getVaultPath(host.app);
    const executionTarget = await resolveCodexExecutionTargetAsync({ settings: host.settings, hostVaultPath });
    if (executionTarget.method === 'native-windows') return null;
    if (executionTarget.method !== 'wsl') return nativeAdapter.resolveInstallCommand(host);
    const env = buildCodexAppServerEnvironment(host);
    const spec = buildCodexLaunchSpec({
      settings: host.settings, resolvedCliCommand: 'npm', hostVaultPath, executionTarget, env,
      cliArguments: ['install', '-g', '@openai/codex@latest'],
    });
    return { command: { command: spec.command, args: spec.args }, environment: env, cwd: spec.spawnCwd };
  },
  async resolveTarget(host, context) {
    const hostVaultPath = getVaultPath(host.app);
    const executionTarget = await resolveCodexExecutionTargetAsync({ settings: host.settings, hostVaultPath });
    if (executionTarget.method !== 'wsl') {
      const target = await nativeAdapter.resolveTarget(host, context);
      if (target && (executionTarget.method === 'native-windows' || /[\\/](?:ChatGPT|Codex|CodexCLI)\.app[\\/]/iu.test(realpathSync(target.path)))) {
        target.updateCommand = null;
        target.updateHint = t('settings.cliLifecycle.bundledUpdate');
      }
      return target;
    }
    const env = buildCodexAppServerEnvironment(host);
    let cliPath = await host.getResolvedProviderCliPath('codex', { ...context, executionTarget });
    if (!cliPath) return null;
    if (!cliPath.startsWith('/')) {
      const result = await new ManagedCommandRunner().run({
        command: 'wsl.exe',
        args: ['--distribution', executionTarget.distroName ?? '', '--exec', '/bin/sh', '-lc', 'command -v codex'],
        cwd: process.cwd(), env, timeoutMs: 10_000, stdoutLimitBytes: 4096,
      });
      cliPath = result.exitCode === 0 ? result.stdout.trim() : '';
      if (!cliPath.startsWith('/') || /[\r\n]/u.test(cliPath)) throw new Error('Could not resolve the Codex executable inside WSL.');
    }
    const command = (args: string[]) => {
      const spec = buildCodexLaunchSpec({
        settings: host.settings, resolvedCliCommand: cliPath, hostVaultPath,
        executionTarget, env, cliArguments: args,
      });
      return { command: spec.command, args: spec.args };
    };
    return {
      path: cliPath, versionCommand: command(['--version']),
      updateCommand: command(['update']), identityCommand: command(['--help']),
      identityPattern: /\bcodex\b/iu, environment: env, cwd: hostVaultPath ?? process.cwd(),
    };
  },
};
