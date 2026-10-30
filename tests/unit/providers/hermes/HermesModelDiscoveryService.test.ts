import { HermesModelDiscoveryService } from '@/providers/hermes/metadata/HermesModelDiscoveryService';

describe('Hermes model discovery', () => {
  it('discovers provider-qualified model IDs in an isolated session and disposes it', async () => {
    const kernel = { connect: jest.fn(), openSession: jest.fn().mockResolvedValue({ sessionId: 'probe', models: { currentModelId: 'custom:one', availableModels: [{ modelId: 'custom:one', name: 'One' }] } }), dispose: jest.fn() };
    const isolate = jest.fn().mockResolvedValue({ home: '/isolated', dispose: jest.fn() });
    const plugin = { settings: {}, app: { vault: { adapter: { basePath: '/vault' } } }, getActiveEnvironmentVariables: () => '' } as never;
    const service = new HermesModelDiscoveryService(plugin, { createKernel: () => kernel as never, isolate });
    expect(await service.discover()).toEqual([{ rawId: 'custom:one', label: 'One' }]);
    expect(kernel.dispose).toHaveBeenCalled();
    expect((await isolate.mock.results[0].value).dispose).toHaveBeenCalled();
  });
  it('removes the isolated home even if kernel disposal fails', async () => {
    const disposeHome = jest.fn();
    const kernel = { connect: jest.fn(), openSession: jest.fn().mockResolvedValue({ sessionId: 'probe' }), dispose: jest.fn().mockRejectedValue(new Error('dispose failed')) };
    const plugin = { settings: {}, app: { vault: { adapter: { basePath: '/vault' } } }, getActiveEnvironmentVariables: () => '' } as never;
    const service = new HermesModelDiscoveryService(plugin, { createKernel: () => kernel as never, isolate: async () => ({ home: '/isolated', dispose: disposeHome }) });
    await expect(service.discover()).rejects.toThrow('dispose failed');
    expect(disposeHome).toHaveBeenCalled();
  });
});
