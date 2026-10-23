import { CachedProviderCliResolver } from '@/core/providers/cli/CachedProviderCliResolver';
import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';

import { getDeepSeekProviderSettings } from '../settings';
import { findDeepSeekDesktopCli, resolveDeepSeekCliPath } from './DeepSeekInstallation';

export class DeepSeekCliResolver {
  private readonly resolver = new CachedProviderCliResolver({
    providerId: 'deepseek', binaryName: 'dsh',
    getSettingsProjection: settings => {
      const current = getDeepSeekProviderSettings(settings);
      return { cliPathsByHost: current.cliPathsByHost, legacyCliPath: current.cliPath, environmentText: getRuntimeEnvironmentText(settings, 'deepseek') };
    },
    resolve: (context, resolveDefault) => {
      const configured = context.hostnamePath || context.legacyCliPath;
      if (configured) return resolveDeepSeekCliPath(configured);
      const cli = resolveDefault();
      return cli ? resolveDeepSeekCliPath(cli) : findDeepSeekDesktopCli();
    },
    // Install, move and uninstall can change Auto resolution without a settings edit.
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null { this.resolver.reset(); return this.resolver.resolveFromSettings(settings); }
  reset(): void { this.resolver.reset(); }
}
