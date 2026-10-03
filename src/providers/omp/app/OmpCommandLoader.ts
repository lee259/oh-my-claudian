import type { ProviderCommandDiscoveryResult } from '@/core/providers/commands/ProviderCommandDiscoveryResult';
import { loadRuntimeCommands } from '@/core/providers/commands/RuntimeCommandLoader';
import type {
  ProviderCommandLoader as ProviderCommandLoaderContract,
  ProviderCommandLoaderContext,
} from '@/core/providers/types';
import type { SlashCommand } from '@/core/types';

import { getOmpProviderSettings } from '../settings';
import type { OmpCommandMetadataProbe } from './OmpCommandMetadataProbe';

export class OmpCommandLoader implements ProviderCommandLoaderContract {
  constructor(private readonly metadataProbe: Pick<OmpCommandMetadataProbe, 'load'>) {}

  getCacheFingerprint(settings: Record<string, unknown>): string {
    const providerSettings = getOmpProviderSettings(settings);
    const hasConfiguredCli = providerSettings.cliPath.length > 0
      || Object.values(providerSettings.cliPathsByHost).some(path => path.trim().length > 0);
    return [
      'omp:commands:v1',
      providerSettings.enabled ? 'enabled' : 'disabled',
      hasConfiguredCli ? 'configured-cli' : 'auto-cli',
    ].join(':');
  }

  isAvailable(settings: Record<string, unknown>): boolean {
    return getOmpProviderSettings(settings).enabled;
  }

  async loadCommands(
    context: ProviderCommandLoaderContext,
  ): Promise<ProviderCommandDiscoveryResult<SlashCommand>> {
    return loadRuntimeCommands({
      allowIsolatedMetadataCreation: context.allowIsolatedMetadataCreation,
      discover: signal => this.metadataProbe.load(signal),
      errorMessage: 'Could not load OMP commands and skills.',
      projectItems: commands => commands,
      readyCommandSnapshot: context.readyCommandSnapshot,
      requiresSessionMessage: 'OMP command metadata has not been loaded for this tab.',
      signal: context.signal,
    });
  }
}
