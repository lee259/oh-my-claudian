import { TEST_CODEX_CATALOG } from '@test/helpers/codexModels';

import { getCodexProviderSettings } from '@/providers/codex/settings';
import { renderCodexModelPicker } from '@/providers/codex/ui/CodexModelPicker';
import type { ProviderModelPickerOptions } from '@/shared/settings/ProviderModelPicker';

const mockNormalizeAllModelVariants = jest.fn();
let mockProviderModelPickerOptions: ProviderModelPickerOptions | null = null;

jest.mock('@/core/providers/ProviderSettingsCoordinator', () => ({
  ProviderSettingsCoordinator: {
    normalizeAllModelVariants: (...args: unknown[]) => mockNormalizeAllModelVariants(...args),
  },
}));

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
}));
jest.mock('@/shared/settings/ProviderModelPicker', () => ({
  renderProviderModelPicker: (options: ProviderModelPickerOptions) => {
    mockProviderModelPickerOptions = options;
    return { dispose: jest.fn(), refresh: jest.fn() };
  },
}));

function createPlugin() {
  const plugin: any = {
    settings: {
      providerConfigs: {
        codex: {
          discoveredModels: TEST_CODEX_CATALOG,
          modelAliases: {},
          visibleModels: null,
        },
      },
    },
    saveSettings: jest.fn().mockResolvedValue(undefined),
  };
  plugin.mutateSettings = jest.fn(async (mutation: (settings: any) => void | Promise<void>) => {
    await mutation(plugin.settings);
    await plugin.saveSettings();
  });
  return plugin;
}

function createContext(plugin: ReturnType<typeof createPlugin>) {
  return {
    plugin,
    notifyProviderModelOptionsChanged: jest.fn(),
  } as any;
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('CodexModelPicker', () => {
  beforeEach(() => {
    mockProviderModelPickerOptions = null;
    jest.clearAllMocks();
  });

  const getPickerOptions = (): ProviderModelPickerOptions => {
    if (!mockProviderModelPickerOptions) throw new Error('Expected model picker options');
    return mockProviderModelPickerOptions;
  };

  it('renders all app-server models selected by default and can clear the filter', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);
    const onSelectionChanged = jest.fn().mockResolvedValue(undefined);

    renderCodexModelPicker({} as HTMLElement, context, {
      refreshModelCatalog: jest.fn(),
    } as any, onSelectionChanged);

    expect(getPickerOptions().getState().selectedIds).toEqual(['gpt-5.5', 'gpt-5.4-mini']);
    await getPickerOptions().onSelectedIdsChange([]);

    expect(getCodexProviderSettings(plugin.settings).visibleModels).toEqual([]);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(context.notifyProviderModelOptionsChanged).toHaveBeenCalledWith('codex');
    expect(onSelectionChanged).toHaveBeenCalledTimes(1);
  });

  it('marks the first selected model as default and reorders from the drag handle', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);

    renderCodexModelPicker({} as HTMLElement, context, {
      refreshModelCatalog: jest.fn(),
    } as any);

    expect(getPickerOptions().getState().defaultModelId).toBe('gpt-5.5');
    await getPickerOptions().onSelectedIdsChange(['gpt-5.4-mini', 'gpt-5.5']);
    expect(getCodexProviderSettings(plugin.settings).visibleModels).toEqual([
      'gpt-5.4-mini',
      'gpt-5.5',
    ]);
  });

  it('marks the first currently available ordered model as default', () => {
    const plugin = createPlugin();
    plugin.settings.providerConfigs.codex.discoveredModels = [
      {
        ...TEST_CODEX_CATALOG[1],
        model: 'gpt-ultra-only',
        displayName: 'GPT Ultra Only',
        supportedReasoningEfforts: [{ value: 'ultra', description: 'Ultra' }],
      },
      ...TEST_CODEX_CATALOG,
    ];
    plugin.settings.providerConfigs.codex.enableUltraEffort = false;
    plugin.settings.providerConfigs.codex.visibleModels = ['gpt-ultra-only', 'gpt-5.5'];

    renderCodexModelPicker({} as HTMLElement, createContext(plugin), {
      refreshModelCatalog: jest.fn(),
    } as any);

    expect(getPickerOptions().getState().defaultModelId).toBe('gpt-5.5');
  });


  it('persists drag reordering of selected models', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);

    renderCodexModelPicker({} as HTMLElement, context, {
      refreshModelCatalog: jest.fn(),
    } as any);

    await getPickerOptions().onSelectedIdsChange(['gpt-5.4-mini', 'gpt-5.5']);
    expect(getCodexProviderSettings(plugin.settings).visibleModels).toEqual([
      'gpt-5.4-mini',
      'gpt-5.5',
    ]);
  });

  it('marks an ultra-only model unavailable while ultra effort is disabled', () => {
    const plugin = createPlugin();
    plugin.settings.providerConfigs.codex = {
      discoveredModels: [{
        ...TEST_CODEX_CATALOG[0],
        model: 'gpt-ultra-only',
        displayName: 'GPT Ultra Only',
        supportedReasoningEfforts: [
          { value: 'ultra', description: 'Automatic task delegation' },
        ],
        defaultReasoningEffort: 'ultra',
      }],
      enableUltraEffort: false,
      modelAliases: {},
      visibleModels: null,
    };

    renderCodexModelPicker({} as HTMLElement, createContext(plugin), {} as any);

    const ultraModel = getPickerOptions().getState().models.find(model => model.id === 'gpt-ultra-only');
    expect(ultraModel?.isAvailable).toBe(false);
    expect(ultraModel?.unavailableMessage).toBe('Requires Ultra effort to be enabled');
  });

  it('exposes provider catalog and persistence actions through async callbacks', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);
    const refreshModelCatalog = jest.fn().mockResolvedValue({
      changed: false,
      persistedSettingsChanged: false,
    });

    renderCodexModelPicker({} as HTMLElement, context, {
      modelCatalogCoordinator: { ensureFresh: refreshModelCatalog },
    } as any);

    await getPickerOptions().loadCatalog(true);
    await getPickerOptions().onAliasesChange({ 'gpt-5.5': 'Primary' });
    await getPickerOptions().onSelectedIdsChange(['gpt-5.5']);
    expect(refreshModelCatalog).toHaveBeenCalled();
  });

  it('persists a catalog-ordered subset when a model is unchecked', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);
    renderCodexModelPicker({} as HTMLElement, context, {} as any);
    await getPickerOptions().onSelectedIdsChange(['gpt-5.5']);

    expect(getCodexProviderSettings(plugin.settings).visibleModels).toEqual(['gpt-5.5']);
  });

  it('persists aliases for selected models', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);

    renderCodexModelPicker({} as HTMLElement, context, {} as any);

    await getPickerOptions().onAliasesChange({ 'gpt-5.5': 'Primary' });

    expect(getCodexProviderSettings(plugin.settings).modelAliases).toEqual({
      'gpt-5.5': 'Primary',
    });
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(context.notifyProviderModelOptionsChanged).toHaveBeenCalledWith('codex');
  });

  it('refreshes the app-server catalog through the provider-owned persistence boundary', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);
    const ensureFresh = jest.fn().mockResolvedValue({
      kind: 'completed',
      models: [],
      refreshed: true,
    });
    renderCodexModelPicker({} as HTMLElement, context, {
      modelCatalogCoordinator: { ensureFresh },
    } as any);

    await getPickerOptions().loadCatalog(true);

    expect(ensureFresh).toHaveBeenCalledWith('model-picker', { force: true });
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(context.notifyProviderModelOptionsChanged).toHaveBeenCalledWith('codex');
  });

  it('does not save when refresh only changes the runtime catalog', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);
    const ensureFresh = jest.fn().mockResolvedValue({
      kind: 'completed',
      models: [],
      refreshed: false,
    });
    renderCodexModelPicker({} as HTMLElement, context, {
      modelCatalogCoordinator: { ensureFresh },
    } as any);

    await getPickerOptions().loadCatalog(true);

    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(context.notifyProviderModelOptionsChanged).not.toHaveBeenCalled();
  });

  it('checks cached catalog freshness on open and rerenders after background refresh', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);
    const refreshedCatalog = [
      ...TEST_CODEX_CATALOG,
      {
        ...TEST_CODEX_CATALOG[1],
        model: 'gpt-5.6-new',
        displayName: 'GPT-5.6 New',
        description: 'Newly discovered model',
      },
    ];
    let finishBackgroundRefresh!: (value: {
      kind: 'completed';
      models: typeof refreshedCatalog;
      refreshed: true;
    }) => void;
    const backgroundRefresh = new Promise<{
      kind: 'completed';
      models: typeof refreshedCatalog;
      refreshed: true;
    }>((resolve) => {
      finishBackgroundRefresh = resolve;
    });
    const ensureFresh = jest.fn().mockResolvedValue({
      kind: 'completed',
      models: TEST_CODEX_CATALOG,
      refreshed: false,
      backgroundRefresh,
    });

    renderCodexModelPicker({} as HTMLElement, context, {
      modelCatalogCoordinator: { ensureFresh },
    } as any);

    await getPickerOptions().loadCatalog(false);

    expect(ensureFresh).toHaveBeenCalledWith('model-picker', { force: false });

    plugin.settings.providerConfigs.codex.discoveredModels = refreshedCatalog;
    finishBackgroundRefresh({
      kind: 'completed',
      models: refreshedCatalog,
      refreshed: true,
    });
    await flushPromises();

    expect(getPickerOptions().getState().models.some(model => model.id === 'gpt-5.6-new')).toBe(true);
    expect(context.notifyProviderModelOptionsChanged).toHaveBeenCalledWith('codex');
  });
});
