const mockDiscoverCatalog = jest.fn();

jest.mock('@/providers/dsh/metadata/DshModelDiscoveryService', () => ({
  DshModelDiscoveryService: jest.fn().mockImplementation(() => ({
    discoverCatalog: mockDiscoverCatalog,
  })),
}));

import { dshWorkspaceRegistration } from '@/providers/dsh/app/DshWorkspaceServices';
import { LEGACY_FORCED_DSH_DEFAULT_MODEL_ID } from '@/providers/dsh/models';
import { getDshProviderSettings } from '@/providers/dsh/settings';

describe('DshWorkspaceServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses ACP currentValue as the initial visible model instead of the first catalog entry', async () => {
    const defaultModelId = '["opencode","claude-fable-5"]';
    const firstModelId = '["deepseek-official","deepseek-v4-flash"]';
    mockDiscoverCatalog.mockResolvedValue({
      defaultModelId,
      models: [
        { label: 'DeepSeek V4 Flash', rawId: firstModelId },
        { label: 'Claude Fable 5', rawId: defaultModelId },
      ],
      reasoning: null,
      sessionId: 'session-1',
    });

    const settings: Record<string, unknown> = { providerConfigs: { dsh: {} } };
    const plugin = {
      app: {},
      mutateSettings: async (mutate: (value: Record<string, unknown>) => void) => mutate(settings),
      settings,
    };
    const services = await dshWorkspaceRegistration.initialize({ plugin } as never);

    await services.refreshModelCatalog?.();

    expect(getDshProviderSettings(settings).visibleModels).toEqual([defaultModelId]);
  });

  it('replaces only the old forced default left by the initial DSH preview', async () => {
    const defaultModelId = '["opencode","claude-fable-5"]';
    mockDiscoverCatalog.mockResolvedValue({
      defaultModelId,
      models: [{ label: 'Claude Fable 5', rawId: defaultModelId }],
      reasoning: null,
      sessionId: 'session-2',
    });

    const settings: Record<string, unknown> = {
      providerConfigs: {
        dsh: {
          catalogTimestamp: 1,
          discoveredModels: [{ label: LEGACY_FORCED_DSH_DEFAULT_MODEL_ID, rawId: LEGACY_FORCED_DSH_DEFAULT_MODEL_ID }],
          visibleModels: [LEGACY_FORCED_DSH_DEFAULT_MODEL_ID],
        },
      },
    };
    const plugin = {
      app: {},
      mutateSettings: async (mutate: (value: Record<string, unknown>) => void) => mutate(settings),
      settings,
    };
    const services = await dshWorkspaceRegistration.initialize({ plugin } as never);

    await services.refreshModelCatalog?.();

    expect(getDshProviderSettings(settings).visibleModels).toEqual([defaultModelId]);
  });
});
