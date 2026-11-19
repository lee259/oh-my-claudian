import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderTransitionOwnerContext,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { AntigravityCommandCatalog } from '../commands/AntigravityCommandCatalog';
import { AntigravityCLIResolver } from '../runtime/AntigravityCLIResolver';
import { AntigravityModelCatalog } from '../runtime/AntigravityModelCatalog';
import { ANTIGRAVITY_PROVIDER_ID } from '../settings';
import { antigravitySettingsTabRenderer } from '../ui/AntigravitySettingsTab';
import { AntigravityCommandLoader } from './AntigravityCommandLoader';
import { AntigravityMetadataProbe } from './AntigravityMetadataProbe';

export interface AntigravityWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: AntigravityCLIResolver;
  commandCatalog: ProviderCommandCatalog;
  modelCatalogOwner: AntigravityModelCatalog;
  refreshModelCatalog(context?: ProviderTransitionOwnerContext): Promise<{
    changed: boolean;
    diagnostics?: string;
    persistedSettingsChanged?: boolean;
  }>;
  dispose(): Promise<void>;
}

export async function createAntigravityWorkspaceServices(plugin: ProviderHost): Promise<AntigravityWorkspaceServices> {
  const runtimeHost = plugin.getRuntimeHost(ANTIGRAVITY_PROVIDER_ID);
  const metadataProbe = new AntigravityMetadataProbe(runtimeHost);
  const modelCatalogOwner = new AntigravityModelCatalog(runtimeHost);
  const unregisterTransitionHook = plugin.executionLifecycleRegistry.registerTransitionHook(ANTIGRAVITY_PROVIDER_ID, {
    beforeTransition: async () => {
      metadataProbe.beginEnvironmentTransition();
      await metadataProbe.quiesceForEnvironmentChange();
    },
    afterTransition: async () => {
      try {
        await metadataProbe.quiesceForEnvironmentChange();
      } finally {
        metadataProbe.endEnvironmentTransition();
      }
    },
  });

  return {
    cliResolver: new AntigravityCLIResolver(),
    commandCatalog: new AntigravityCommandCatalog(),
    commandLoader: new AntigravityCommandLoader(metadataProbe),
    modelCatalogOwner,
    refreshModelCatalog: async context => modelCatalogOwner.refresh(
      context?.signal ?? new AbortController().signal,
    ),
    settingsTabRenderer: antigravitySettingsTabRenderer,
    tabWarmupPolicy: { resolveMode: () => 'commands' },
    async dispose() {
      unregisterTransitionHook();
      modelCatalogOwner.dispose();
      await metadataProbe.dispose();
    },
  };
}

export const antigravityWorkspaceRegistration: ProviderWorkspaceRegistration<AntigravityWorkspaceServices> = {
  initialize: async ({ plugin }) => createAntigravityWorkspaceServices(plugin),
};

export function getAntigravityWorkspaceServices(): AntigravityWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices(ANTIGRAVITY_PROVIDER_ID) as AntigravityWorkspaceServices;
}
