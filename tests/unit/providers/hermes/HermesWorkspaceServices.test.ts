import { hermesWorkspaceRegistration } from '@/providers/hermes/app/HermesWorkspaceServices';
import { HermesModelDiscoveryService } from '@/providers/hermes/metadata/HermesModelDiscoveryService';
import { getHermesProviderSettings } from '@/providers/hermes/settings';

jest.mock('@/providers/hermes/metadata/HermesModelDiscoveryService');

it('does not let an old discovery overwrite settings after a runtime transition', async () => {
  let resolve!: (models: { rawId: string; label: string }[]) => void;
  jest.mocked(HermesModelDiscoveryService).mockImplementation(() => ({ discover: () => new Promise(r => { resolve = r; }) }) as never);
  let hook: { beforeTransition(): Promise<void> } | undefined;
  const settings = { providerConfigs: { hermes: { discoveredModels: [], visibleModels: [] } } };
  const plugin = { settings, mutateSettings: async (fn: (s: typeof settings) => void) => fn(settings), executionLifecycleRegistry: {
    registerTransitionHook: (_id: string, value: typeof hook) => { hook = value; return () => undefined; },
  } };
  const services = await hermesWorkspaceRegistration.initialize({ plugin: plugin as never } as never);
  const pending = services.refreshModelCatalog!();
  expect(hook).toBeDefined();
  const transitioning = hook!.beforeTransition();
  resolve([{ rawId: 'old:model', label: 'Old' }]);
  await transitioning;
  await pending;
  expect(getHermesProviderSettings(settings).discoveredModels).toEqual([]);
  await services.dispose?.();
});

it('retains a selected model but marks it unavailable when discovery no longer returns it', async () => {
  jest.mocked(HermesModelDiscoveryService).mockImplementation(() => ({ discover: async () => [{ rawId: 'new:model', label: 'New' }] }) as never);
  const settings = { providerConfigs: { hermes: { discoveredModels: [{ rawId: 'old:model', label: 'Old' }], visibleModels: ['old:model'] } } };
  const plugin = { settings, mutateSettings: async (fn: (s: typeof settings) => void) => fn(settings), executionLifecycleRegistry: {
    registerTransitionHook: () => () => undefined,
  } };
  const services = await hermesWorkspaceRegistration.initialize({ plugin: plugin as never } as never);
  await services.refreshModelCatalog!();
  const provider = getHermesProviderSettings(settings);
  expect(provider.visibleModels).toEqual(['old:model']);
  expect(provider.discoveredModels).toEqual([{ rawId: 'new:model', label: 'New' }, { rawId: 'old:model', label: 'Old', available: false }]);
  await services.dispose?.();
});
