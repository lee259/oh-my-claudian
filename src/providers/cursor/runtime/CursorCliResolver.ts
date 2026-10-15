import { CachedProviderCliResolver } from '../../../core/providers/cli/CachedProviderCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { findCliBinaryPath } from '../../../utils/cliBinaryLocator';
import { getCursorProviderSettings } from '../settings';

export class CursorCliResolver {
  private readonly resolver = new CachedProviderCliResolver({
    binaryName: 'cursor-agent',
    getSettingsProjection: settings => {
      const provider = getCursorProviderSettings(settings);
      return {
        cliPathsByHost: provider.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'cursor'),
        legacyCliPath: provider.cliPath,
      };
    },
    providerId: 'cursor',
    resolve: (context, resolveDefault) => (
      resolveDefault()
      ?? findCliBinaryPath('agent', context.environmentVariables.PATH)
    ),
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  reset(): void { this.resolver.reset(); }
}
