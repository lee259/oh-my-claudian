import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { CursorCommandCatalog } from '../commands/CursorCommandCatalog';
import { CursorModelDiscoveryService } from '../metadata/CursorModelDiscoveryService';
import { CursorCliResolver } from '../runtime/CursorCliResolver';
import { updateCursorProviderSettings } from '../settings';
import { cursorSettingsTabRenderer } from '../ui/CursorSettingsTab';
import { CursorCommandLoader } from './CursorCommandLoader';
import { CursorCommandMetadataProbe } from './CursorCommandMetadataProbe';

export interface CursorWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: CursorCliResolver;
  commandCatalog: ProviderCommandCatalog;
  modelDiscoveryService: CursorModelDiscoveryService;
  dispose(): Promise<void>;
}

const cursorTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'commands';
  },
};

export const cursorWorkspaceRegistration: ProviderWorkspaceRegistration<CursorWorkspaceServices> = {
  initialize: async ({ plugin }) => {
    const modelDiscoveryService = new CursorModelDiscoveryService(plugin);
    const commandMetadataProbe = new CursorCommandMetadataProbe(plugin);
    const unregisterTransitionHook =
      plugin.executionLifecycleRegistry.registerTransitionHook('cursor', {
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
      cliResolver: new CursorCliResolver(),
      commandCatalog: new CursorCommandCatalog(),
      commandLoader: new CursorCommandLoader(commandMetadataProbe),
      modelDiscoveryService,
      refreshModelCatalog: async () => {
        try {
          const catalog = await modelDiscoveryService.discoverCatalog();
          await plugin.mutateSettings(settings => {
            updateCursorProviderSettings(settings, {
              discoveredModels: catalog.models,
              catalogTimestamp: Date.now(),
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
      settingsTabRenderer: cursorSettingsTabRenderer,
      tabWarmupPolicy: cursorTabWarmupPolicy,
      async dispose() {
        unregisterTransitionHook();
        await commandMetadataProbe.dispose();
      },
    };
  },
};

export function maybeGetCursorWorkspaceServices(): CursorWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('cursor') as CursorWorkspaceServices | null;
}
