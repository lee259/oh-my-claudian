import { DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS } from '@/providers/antigravity/config';
import { antigravitySettingsTabRenderer } from '@/providers/antigravity/ui/AntigravitySettingsTab';
import type { ProviderModelPickerOptions } from '@/shared/settings/ProviderModelPicker';
import { getHostnameKey } from '@/utils/env';

const mockRefreshReadiness = jest.fn().mockResolvedValue(undefined);
const mockRefreshModelCatalog = jest.fn().mockResolvedValue({
  changed: true,
  persistedSettingsChanged: true,
});
const mockModelPickerOptions: ProviderModelPickerOptions[] = [];
const mockNotifyProviderModelOptionsChanged = jest.fn();
let mockSettingsBag: Record<string, unknown> = {};

const mockWorkspace = {
  cliResolver: { reset: jest.fn() },
  refreshModelCatalog: mockRefreshModelCatalog,
};

jest.mock('@/core/providers/ProviderWorkspaceRegistry', () => ({
  ProviderWorkspaceRegistry: {
    requireServices: () => mockWorkspace,
  },
}));

jest.mock('@/shared/settings/ProviderReadinessPanel', () => ({
  renderProviderReadinessPanel: () => ({
    refresh: mockRefreshReadiness,
    root: mockCreateContainer(),
    management: mockCreateContainer(),
    enablement: mockCreateContainer(),
    setInstallationSummary: jest.fn(),
    cliDetail: mockCreateContainer(),
    destroy: jest.fn(),
  }),
}));

jest.mock('@/shared/settings/ProviderModelPicker', () => ({
  renderProviderModelPicker: (options: ProviderModelPickerOptions) => {
    mockModelPickerOptions.push(options);
    return { refresh: jest.fn(), dispose: jest.fn() };
  },
}));

jest.mock('@/shared/settings/ProviderEnablementSetting', () => ({
  renderProviderEnablementSetting: jest.fn(),
}));

jest.mock('@/shared/settings/ProviderModelEnablementWarning', () => ({
  renderLastEnabledProviderWarning: () => ({
    hide: jest.fn(),
    showFor: jest.fn(),
  }),
  renderProviderModelEnablementWarning: () => ({
    context: {
      notifyProviderModelOptionsChanged: mockNotifyProviderModelOptionsChanged,
      plugin: {
        mutateSettings: async (mutation: (bag: Record<string, unknown>) => void) => {
          mutation(mockSettingsBag);
        },
      },
    },
    refresh: jest.fn(),
    hide: jest.fn(),
    showFor: jest.fn(),
  }),
}));

jest.mock('@/shared/settings/HostnameCliPathSetting', () => ({
  renderHostnameCliPathSetting: jest.fn(),
}));

jest.mock('@/shared/settings/EnvironmentSettingsSection', () => ({
  renderEnvironmentSettingsSection: jest.fn(),
}));

function mockCreateContainer(): HTMLElement {
  const container = {
    createDiv: () => mockCreateContainer(),
    createEl: () => mockCreateContainer(),
  };
  return container as unknown as HTMLElement;
}

function createSettings() {
  const host = getHostnameKey();
  return {
    providerConfigs: {
      antigravity: {
        ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
        catalogsByHost: {
          [host]: {
            defaultModelId: 'gemini-3.8-flash',
            models: [{
              displayName: 'Gemini 3.8 Flash',
              rawId: 'gemini-3.8-flash',
              reasoningEfforts: [
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
              ],
            }],
            refreshedAt: 1,
          },
        },
        enabled: true,
        visibleModels: [],
      },
    },
  } as Record<string, unknown>;
}

function renderSettings(settings: Record<string, unknown>) {
  mockSettingsBag = settings;
  const context = {
    notifyProviderModelOptionsChanged: mockNotifyProviderModelOptionsChanged,
    plugin: {
      cliLifecycle: { getSnapshot: () => ({ status: 'ready' }) },
      getResolvedProviderCliPath: async () => '/opt/homebrew/bin/agy',
      mutateSettings: async (mutation: (bag: Record<string, unknown>) => void) => {
        mutation(settings);
      },
      settings,
    },
    renderCustomContextLimits: jest.fn(),
  };
  antigravitySettingsTabRenderer.render(mockCreateContainer(), context as never);
  return context;
}

describe('Antigravity settings', () => {
  beforeEach(() => {
    mockRefreshReadiness.mockClear();
    mockRefreshModelCatalog.mockClear();
    mockModelPickerOptions.length = 0;
  });

  it('refreshes readiness after model selection changes', async () => {
    const settings = createSettings();
    renderSettings(settings);
    const options = mockModelPickerOptions[0];

    await options.onSelectedIdsChange(['gemini-3.8-flash']);

    expect(
      (settings.providerConfigs as Record<string, { visibleModels: string[] }>)
        .antigravity.visibleModels,
    ).toEqual(['gemini-3.8-flash']);
    expect(mockRefreshReadiness).toHaveBeenCalledTimes(1);
    expect(mockNotifyProviderModelOptionsChanged).toHaveBeenCalledWith('antigravity');
  });

  it('refreshes readiness after the model picker discovers the catalog', async () => {
    renderSettings(createSettings());
    const options = mockModelPickerOptions[0];

    await options.loadCatalog(false);

    expect(mockRefreshModelCatalog).toHaveBeenCalledTimes(1);
    expect(mockRefreshReadiness).toHaveBeenCalledTimes(1);
  });
});
