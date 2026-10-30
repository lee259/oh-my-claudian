import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type { ProviderWorkspaceRegistration, ProviderWorkspaceServices } from '@/core/providers/types';

import { HermesModelDiscoveryService } from '../metadata/HermesModelDiscoveryService';
import { HermesCliResolver } from '../runtime/HermesCliResolver';
import { getHermesProviderSettings, updateHermesProviderSettings } from '../settings';
import { hermesSettingsTabRenderer } from '../ui/HermesSettingsTab';

export interface HermesWorkspaceServices extends ProviderWorkspaceServices { cliResolver: HermesCliResolver }
export const hermesWorkspaceRegistration: ProviderWorkspaceRegistration<HermesWorkspaceServices> = {
  initialize: async ({ plugin }) => {
    const resolver = new HermesCliResolver();
    const discovery = new HermesModelDiscoveryService(plugin);
    const active = new Map<AbortController, Promise<void>>();
    let transitioning = false;
    let disposed = false;
    const quiesce = async () => {
      for (const controller of active.keys()) controller.abort();
      await Promise.allSettled(active.values());
    };
    const unregister = plugin.executionLifecycleRegistry.registerTransitionHook('hermes', {
      beforeTransition: async () => { transitioning = true; await quiesce(); },
      afterTransition: async () => { try { await quiesce(); } finally { transitioning = false; } },
    });
    return {
      cliResolver: resolver,
      settingsTabRenderer: hermesSettingsTabRenderer,
      async refreshModelCatalog(context) {
        if (disposed || (transitioning && !context?.providerTransitionOwner)) {
          return { changed: false, diagnostics: 'Hermes runtime is changing.' };
        }
        for (const existing of active.keys()) existing.abort();
        const controller = new AbortController();
        const abort = () => controller.abort();
        context?.signal?.addEventListener('abort', abort, { once: true });
        if (context?.signal?.aborted) controller.abort();
        let finish!: () => void;
        const settled = new Promise<void>(resolve => { finish = resolve; });
        active.set(controller, settled);
        try {
          const discovered = await discovery.discover(controller.signal);
          controller.signal.throwIfAborted();
          await plugin.mutateSettings(settings => {
            controller.signal.throwIfAborted();
            const current = getHermesProviderSettings(settings);
            const known = new Set(discovered.map(model => model.rawId));
            const selected = current.discoveredModels.filter(model => current.visibleModels.includes(model.rawId) && !known.has(model.rawId));
            updateHermesProviderSettings(settings, { discoveredModels: [...discovered, ...selected.map(model => ({ ...model, available: false }))], catalogTimestamp: Date.now() });
          });
          return { changed: true };
        } catch (error) { return { changed: false, diagnostics: error instanceof Error ? error.message : String(error) }; }
        finally {
          context?.signal?.removeEventListener('abort', abort);
          active.delete(controller);
          finish();
        }
      },
      async dispose() { disposed = true; unregister(); await quiesce(); },
    };
  },
};
export function maybeGetHermesWorkspaceServices(): HermesWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('hermes') as HermesWorkspaceServices | null;
}
