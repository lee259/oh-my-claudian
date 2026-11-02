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
  it('preserves a usable model catalog when an early snapshot is empty', async () => {
    const plugin = createPlugin();

    await expect(projectOpencodeMetadata(plugin, {
      models: { availableModels: [], currentModelId: '' },
    })).resolves.toBe(false);

    expect(getOpencodeProviderSettings(plugin.settings).discoveredModels).toEqual([
      { label: 'Old model', rawId: 'opencode/old-model' },
    ]);
    expect(plugin.mutateSettings).not.toHaveBeenCalled();
    expect(plugin.notifyProviderChatOptionsChanged).not.toHaveBeenCalled();
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

  it('does not notify when a repeated non-empty projection is unchanged', async () => {
    const plugin = createPlugin();
    const metadata = {
      modes: {
        availableModes: [
          { id: 'build', name: 'Build' },
          { id: 'plan', name: 'Plan' },
        ],
        currentModeId: 'build',
      },
      models: {
        availableModels: [
          { modelId: 'opencode/new-model', name: 'opencode/New model' },
          { modelId: 'opencode/second-model', name: 'opencode/Second model' },
        ],
        currentModelId: '',
      },
    };

    await expect(projectOpencodeMetadata(plugin, metadata)).resolves.toBe(true);
    await expect(projectOpencodeMetadata(plugin, {
      ...metadata,
      modes: { ...metadata.modes, availableModes: [...metadata.modes.availableModes].reverse() },
      models: { ...metadata.models, availableModels: [...metadata.models.availableModels].reverse() },
    })).resolves.toBe(false);

    expect(plugin.mutateSettings).toHaveBeenCalledTimes(1);
    expect(plugin.notifyProviderChatOptionsChanged).toHaveBeenCalledTimes(1);
  });
});
