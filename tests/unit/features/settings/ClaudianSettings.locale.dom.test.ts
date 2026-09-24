/** @jest-environment jsdom */

import '@/providers';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import { ClaudianView } from '@/features/chat/ClaudianView';
import { createInputToolbar, type ToolbarCallbacks } from '@/features/chat/ui/InputToolbar';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import { getLocale, setLocale } from '@/i18n/i18n';

HTMLElement.prototype.empty = function empty(): void {
  this.replaceChildren();
};
HTMLElement.prototype.setText = function setText(text: string): void {
  this.textContent = text;
};

jest.mock('electron', () => ({
  remote: {
    dialog: {
      showOpenDialog: jest.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    },
  },
}), { virtual: true });

function createToolbarCallbacks(): ToolbarCallbacks {
  return {
    onModelChange: jest.fn().mockResolvedValue(undefined),
    onModeChange: jest.fn().mockResolvedValue(undefined),
    onThinkingBudgetChange: jest.fn().mockResolvedValue(undefined),
    onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
    onServiceTierChange: jest.fn().mockResolvedValue(undefined),
    onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
    getSettings: () => ({
      model: 'model',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
    }),
    getUIConfig: () => ({
      getProviderIcon: () => null,
      getModelOptions: () => [{ value: 'model', label: 'Model' }],
      getReasoningOptions: () => [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
      getDefaultReasoningValue: () => 'low',
      isAdaptiveReasoningModel: () => true,
      getModeSelector: () => ({
        activeValue: 'build',
        label: 'Mode',
        options: [
          { value: 'build', label: 'Build' },
          { value: 'plan', label: 'Plan' },
        ],
        value: 'build',
      }),
      getPermissionModeToggle: () => ({
        inactiveValue: 'normal',
        inactiveLabel: 'Safe',
        activeValue: 'yolo',
        activeLabel: 'YOLO',
      }),
      getServiceTierToggle: () => null,
    }) as unknown as ReturnType<ToolbarCallbacks['getUIConfig']>,
    getCapabilities: () => ({
      providerId: 'claude',
      reasoningControl: 'effort',
      supportsPlanMode: true,
    }) as ReturnType<ToolbarCallbacks['getCapabilities']>,
  };
}

describe('ClaudianSettingTab live locale change', () => {
  it('refreshes mounted chat composers after saving the interface language', async () => {
    const settings = {
      ...DEFAULT_CLAUDIAN_SETTINGS,
      locale: 'zh-CN',
      customContextLimits: {} as Record<string, number>,
      customModelAliases: {} as Record<string, string>,
    };
    setLocale('zh-CN');
    const toolbarEl = document.createElement('div');
    document.body.append(toolbarEl);
    const toolbar = createInputToolbar(toolbarEl, createToolbarCallbacks());
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = {
      getAllTabs: () => [{ ui: { refreshComposerLocale: toolbar.refreshLocale } }],
    } as any;
    const plugin = {
      settings,
      getActiveEnvironmentVariables: jest.fn(() => ''),
      mutateSettings: jest.fn(async (mutation: (value: typeof settings) => void) => {
        mutation(settings);
      }),
      getAllViews: jest.fn(() => [view]),
      notifyProviderChatOptionsChanged: jest.fn(),
      notifyAgentSkillsChanged: jest.fn(),
      storage: { getAdapter: jest.fn(() => ({})) },
      providerHost: {
        settings,
        getEnvironmentVariablesForScope: jest.fn(() => ''),
        applyEnvironmentVariables: jest.fn(),
      },
    };
    const tab = new ClaudianSettingTab({} as any, plugin as any);
    tab.containerEl = document.createElement('div') as any;

    try {
      tab.display();
      expect(toolbarEl.querySelector('.claudian-context-actions-trigger')?.getAttribute('aria-label'))
        .toBe('添加上下文');
      expect(toolbarEl.querySelector('.claudian-external-context-picker')?.getAttribute('aria-label'))
        .toBe('添加文件或文件夹');

      const languageSelect = tab.containerEl.querySelector<HTMLSelectElement>(
        '.claudian-settings-select-list select',
      );
      if (!languageSelect) throw new Error('Expected the interface language selector');
      languageSelect.value = 'en';
      languageSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => window.setTimeout(resolve, 0));

      expect(settings.locale).toBe('en');
      expect(getLocale()).toBe('en');
      expect(plugin.getAllViews).toHaveBeenCalledTimes(1);
      expect(toolbarEl.querySelector('.claudian-context-actions-trigger')?.getAttribute('aria-label'))
        .toBe('Add context');
      expect(toolbarEl.querySelector('.claudian-external-context-picker')?.getAttribute('aria-label'))
        .toBe('Add files or folders');
      expect(toolbarEl.querySelector('.claudian-external-context-label')?.textContent)
        .toBe('Add files or folders');
    } finally {
      toolbar.destroy();
      toolbarEl.remove();
      setLocale('en');
    }
  });
});
