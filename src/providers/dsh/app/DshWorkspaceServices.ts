import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderWorkspaceRegistration, ProviderWorkspaceServices } from '../../../core/providers/types';
import { DshModelDiscoveryService } from '../metadata/DshModelDiscoveryService';
import { LEGACY_FORCED_DSH_DEFAULT_MODEL_ID } from '../models';
import { DshCliResolver } from '../runtime/DshCliResolver';
import { getDshProviderSettings, updateDshProviderSettings } from '../settings';
import { dshSettingsTabRenderer } from '../ui/DshSettingsTab';

export interface DshWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: DshCliResolver;
  modelDiscoveryService: DshModelDiscoveryService;
}

export const dshWorkspaceRegistration: ProviderWorkspaceRegistration<DshWorkspaceServices> = {
  initialize: async ({ plugin }) => {
    const modelDiscoveryService = new DshModelDiscoveryService(plugin);
    return {
      cliResolver: new DshCliResolver(),
      modelDiscoveryService,
      refreshModelCatalog: async () => {
        try {
          const catalog = await modelDiscoveryService.discoverCatalog(
            getDshProviderSettings(plugin.settings).catalogSessionId || undefined,
          );
          await plugin.mutateSettings(settings => {
            const current = getDshProviderSettings(settings);
            const validVisible = current.visibleModels.filter(modelId =>
              catalog.models.some(model => model.rawId === modelId),
            );
            const replaceLegacyForcedDefault = current.visibleModels.length === 1
              && current.visibleModels[0] === LEGACY_FORCED_DSH_DEFAULT_MODEL_ID;
            const catalogDefault = catalog.defaultModelId
              ?? catalog.models[0]?.rawId
              ?? '';
            updateDshProviderSettings(settings, {
              catalogTimestamp: Date.now(),
              catalogSessionId: catalog.sessionId,
              discoveredModels: catalog.models,
              reasoning: catalog.reasoning,
              visibleModels: replaceLegacyForcedDefault && catalogDefault
                ? [catalogDefault]
                : validVisible.length > 0 || current.catalogTimestamp > 0
                  ? validVisible
                  : catalogDefault ? [catalogDefault] : [],
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
      settingsTabRenderer: dshSettingsTabRenderer,
    };
  },
};

export function maybeGetDshWorkspaceServices(): DshWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('dsh') as DshWorkspaceServices | null;
}
