import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { OmpCommandCatalog } from '../commands/OmpCommandCatalog';
import { OmpModelDiscoveryService } from '../metadata/OmpModelDiscoveryService';
import { OmpCliResolver } from '../runtime/OmpCliResolver';
import { getOmpProviderSettings, updateOmpProviderSettings } from '../settings';
import { ompSettingsTabRenderer } from '../ui/OmpSettingsTab';
import { OmpCommandLoader } from './OmpCommandLoader';
import { OmpCommandMetadataProbe } from './OmpCommandMetadataProbe';

export interface OmpWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: OmpCliResolver;
  commandCatalog: ProviderCommandCatalog;
  modelDiscoveryService: OmpModelDiscoveryService;
  dispose(): Promise<void>;
}

const ompTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'commands';
  },
};

export const ompWorkspaceRegistration: ProviderWorkspaceRegistration<OmpWorkspaceServices> = {
  initialize: async ({ plugin }) => {
    const modelDiscoveryService = new OmpModelDiscoveryService(plugin);
    const commandMetadataProbe = new OmpCommandMetadataProbe(plugin);
    const unregisterTransitionHook =
      plugin.executionLifecycleRegistry.registerTransitionHook('omp', {
        beforeTransition: async () => {
          commandMetadataProbe.beginEnvironmentTransition();
          await commandMetadataProbe.quiesceForEnvironmentChange();
        },
        afterTransition: async () => {
          try {
            await commandMetadataProbe.quiesceForEnvironmentChange();
          } finally {
            commandMetadataProbe.endEnvironmentTransition();
          }
        },
      });
    return {
      cliResolver: new OmpCliResolver(),
      commandCatalog: new OmpCommandCatalog(),
      commandLoader: new OmpCommandLoader(commandMetadataProbe),
      modelDiscoveryService,
      refreshModelCatalog: async () => {
        try {
          const catalog = await modelDiscoveryService.discoverCatalog();
          await plugin.mutateSettings(settings => {
            const current = getOmpProviderSettings(settings);
            updateOmpProviderSettings(settings, {
              discoveredModels: catalog.models,
              catalogTimestamp: Date.now(),
              visibleModels: current.visibleModels.length > 0
                ? current.visibleModels
                : catalog.models[0]
                  ? [catalog.models[0].rawId]
                  : [],
              ...(catalog.thinking ? { thinking: catalog.thinking } : {}),
            });
          });
          return { changed: true };
        } catch (error) {
          return {
            changed: false,
            diagnostics: error instanceof Error ? error.message : String(error),
          };
        }
      },
      settingsTabRenderer: ompSettingsTabRenderer,
      tabWarmupPolicy: ompTabWarmupPolicy,
      async dispose() {
        unregisterTransitionHook();
        await commandMetadataProbe.dispose();
      },
    };
  },
};

export function maybeGetOmpWorkspaceServices(): OmpWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('omp') as OmpWorkspaceServices | null;
}
