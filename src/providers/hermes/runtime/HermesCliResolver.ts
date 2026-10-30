import { CachedProviderCliResolver } from '../../../core/providers/cli/CachedProviderCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getHermesProviderSettings } from '../settings';

export class HermesCliResolver {
  private readonly resolver = new CachedProviderCliResolver({
    binaryName: 'hermes',
    getSettingsProjection: settings => {
      const provider = getHermesProviderSettings(settings);
      return {
        cliPathsByHost: provider.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'hermes'),
        legacyCliPath: provider.cliPath,
      };
    },
    providerId: 'hermes',
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  reset(): void { this.resolver.reset(); }
}
