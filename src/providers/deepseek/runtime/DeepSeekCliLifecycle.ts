import type { CliProviderMetadata } from '@/core/providers/cli/CliProviderMetadata';
import type { ProviderCliLifecycleAdapter } from '@/core/providers/cli/ProviderCliLifecycle';
import { getRuntimeEnvironmentVariables } from '@/core/providers/providerEnvironment';
import { t } from '@/i18n/i18n';
import { findNodeExecutable, getEnhancedPath } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

import { getDeepSeekDesktopInstallation, resolveDeepSeekNodeEntry } from './DeepSeekInstallation';

export const deepseekCliMetadata: CliProviderMetadata = {
  binaryName: 'dsh', displayName: 'DeepSeek Harness',
};

/** Probe the same installation execution uses; Desktop and custom installs keep their native update authority. */
export const deepseekCliLifecycle: ProviderCliLifecycleAdapter = {
  metadata: deepseekCliMetadata,
  async resolveTarget(host, context) {
    const cliPath = await host.getResolvedProviderCliPath('deepseek', context);
    if (!cliPath) return null;
    const configured = getRuntimeEnvironmentVariables(host.settings, 'deepseek');
    const environment = { ...process.env, ...configured, PATH: getEnhancedPath(configured.PATH, cliPath) };
    const desktop = getDeepSeekDesktopInstallation(cliPath);
    const entry = desktop ? undefined : resolveDeepSeekNodeEntry(cliPath);
    const node = entry ? findNodeExecutable(environment.PATH) : undefined;
    if (entry && !node) throw new Error('Node.js is required for this DeepSeek Harness installation.');
    return {
      path: cliPath, environment: desktop ? { ...environment, ELECTRON_RUN_AS_NODE: '1' } : environment,
      cwd: getVaultPath(host.app) ?? process.cwd(),
      versionCommand: desktop ? {
        command: desktop.executable,
        args: ['-p', `JSON.parse(require('node:fs').readFileSync(${JSON.stringify(desktop.installAnchor)}, 'utf8')).version`],
      } : { command: node ?? cliPath, args: [...(entry ? [entry] : []), '--version'] },
      updateCommand: null,
      updateHint: t(desktop ? 'settings.deepseek.installation.updateDesktop' : 'settings.deepseek.installation.updateWeb'),
    };
  },
  async resolveInstallCommand() { return null; },
};
