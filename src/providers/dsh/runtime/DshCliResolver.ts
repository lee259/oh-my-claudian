import { CachedProviderCliResolver } from '../../../core/providers/cli/CachedProviderCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderCliResolutionContext, ProviderCliResolver } from '../../../core/providers/types';
import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import { getDshProviderSettings, isNpmRunnerCliPath } from '../settings';

export class DshCliResolver implements ProviderCliResolver {
  private readonly resolver = new CachedProviderCliResolver({
    binaryName: 'dsh',
    getSettingsProjection: settings => {
      const provider = getDshProviderSettings(settings);
      return {
        cliPathsByHost: provider.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'dsh'),
        legacyCliPath: provider.cliPath,
      };
    },
    providerId: 'dsh',
    resolve: context => {
      const configured = context.hostnamePath || context.legacyCliPath;
      if (!configured || isNpmRunnerCliPath(configured)) {
        return findCliBinaryPath('dsh', context.environmentVariables.PATH);
      }
      return resolveConfiguredCliPath(configured)
        ?? findCliBinaryPath(configured, context.environmentVariables.PATH)
        ?? configured;
    },
  });

  resolveFromSettings(settings: Record<string, unknown>, _context?: ProviderCliResolutionContext): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  reset(): void {
    this.resolver.reset();
  }
}
