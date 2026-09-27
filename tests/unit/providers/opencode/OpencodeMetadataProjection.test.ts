import { projectOpencodeMetadata } from '@/providers/opencode/metadata/OpencodeMetadataProjection';
import { getOpencodeProviderSettings } from '@/providers/opencode/settings';

function createPlugin(): any {
  const instance: any = {
    mutateSettings: jest.fn(async (mutation) => mutation(instance.settings)),
    notifyProviderChatOptionsChanged: jest.fn(),
    settings: {
      providerConfigs: {
        opencode: {
          discoveredModels: [{ label: 'Old model', rawId: 'opencode/old-model' }],
          visibleModels: ['opencode/old-model'],
        },
      },
    },
  };
  return instance;
}

describe('OpenCode metadata projection', () => {
  it('clears a previously discovered model catalog when a refresh returns an empty snapshot', async () => {
    const plugin = createPlugin();

    await projectOpencodeMetadata(plugin, {
      models: { availableModels: [], currentModelId: '' },
    });

    expect(getOpencodeProviderSettings(plugin.settings).discoveredModels).toEqual([]);
  });

  it('preserves the model catalog when an update omits model metadata', async () => {
    const plugin = createPlugin();

    await projectOpencodeMetadata(plugin, {
      modes: { availableModes: [], currentModeId: '' },
    });

    expect(getOpencodeProviderSettings(plugin.settings).discoveredModels).toEqual([
      { label: 'Old model', rawId: 'opencode/old-model' },
    ]);
  });
});
