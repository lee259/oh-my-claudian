import { CursorModelDiscoveryService } from '@/providers/cursor/metadata/CursorModelDiscoveryService';

describe('CursorModelDiscoveryService', () => {
  it('discovers models advertised by the Cursor ACP session', async () => {
    const kernel = {
      cancel: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      openSession: jest.fn().mockResolvedValue({
        models: {
          availableModels: [
            { modelId: 'claude-4-sonnet[effort=high]', name: 'Claude 4 Sonnet' },
            { id: 'gpt-5', name: 'GPT-5' },
          ],
          currentModelId: 'claude-4-sonnet',
        },
        sessionId: 'metadata-session',
      }),
      prompt: jest.fn(),
      setConfigOption: jest.fn(),
      setMode: jest.fn(),
      listAvailableModels: jest.fn().mockResolvedValue({ models: [{ value: 'claude-4-sonnet', configOptions: [{
        id: 'effort', category: 'thought_level', type: 'select', currentValue: 'high', options: [
          { name: 'Low', value: 'low' }, { name: 'High', value: 'high' },
        ],
      }] }] }),
      setModel: jest.fn(),
    };
    const plugin = { app: { vault: { adapter: { basePath: '/vault' } } } } as never;
    const removeProbeSession = jest.fn().mockResolvedValue(undefined);
    const service = new CursorModelDiscoveryService(plugin, {
      createKernel: () => kernel,
      removeProbeSession,
    });

    await expect(service.discover()).resolves.toEqual([
      { label: 'Claude 4 Sonnet', rawId: 'claude-4-sonnet[effort=high]', reasoning: {
        parameterId: 'effort', currentValue: 'high', options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }],
      } },
      { label: 'GPT-5', rawId: 'gpt-5' },
    ]);
    expect(kernel.listAvailableModels).toHaveBeenCalledTimes(1);
    expect(kernel.dispose).toHaveBeenCalledTimes(1);
    expect(removeProbeSession).toHaveBeenCalledWith('metadata-session');
  });
});
