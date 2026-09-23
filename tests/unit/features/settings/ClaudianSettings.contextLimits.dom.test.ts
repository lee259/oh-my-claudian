/** @jest-environment jsdom */

import '@/providers';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';

HTMLElement.prototype.empty = function empty(): void {
  this.replaceChildren();
};

function createSettingsTab() {
  const settings = {
    ...DEFAULT_CLAUDIAN_SETTINGS,
    customContextLimits: {} as Record<string, number>,
    customModelAliases: {} as Record<string, string>,
  };
  const plugin = {
    settings,
    getActiveEnvironmentVariables: jest.fn(() => ''),
    mutateSettings: jest.fn(async (mutation: (value: typeof settings) => void) => {
      mutation(settings);
    }),
    getAllViews: jest.fn(() => []),
    notifyProviderChatOptionsChanged: jest.fn(),
    notifyAgentSkillsChanged: jest.fn(),
    storage: { getAdapter: jest.fn(() => ({})) },
    providerHost: { settings },
  };
  const tab = new ClaudianSettingTab({} as any, plugin as any);
  tab.containerEl = document.createElement('div') as any;
  (tab as any).renderGeneralTab = jest.fn();
  (tab as any).activeTab = 'claude';
  return { plugin, tab };
}

describe('ClaudianSettingTab custom model overrides', () => {
  beforeEach(() => {
    jest.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized').mockResolvedValue({} as any);
    jest.spyOn(ProviderWorkspaceRegistry, 'prepareSettings').mockResolvedValue();
    jest.spyOn(ProviderWorkspaceRegistry, 'getSettingsTabRenderer').mockReturnValue({
      render(container, context) {
        context.renderCustomContextLimits(container, 'claude');
      },
    });
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue({
      getCustomModelIds: () => ['custom-model'],
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('announces invalid context limits and skips persistence', async () => {
    const { plugin, tab } = createSettingsTab();
    tab.display();
    await Promise.resolve();
    await Promise.resolve();

    const input = tab.containerEl.querySelector<HTMLInputElement>(
      '[aria-label="Custom Context Limits: custom-model"]',
    );
    if (!input) throw new Error('Expected the custom-model context-limit field');
    input.value = '20m';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(tab.containerEl.querySelector('[role="alert"]')?.textContent)
      .toMatch(/invalid format/i);
    expect(plugin.mutateSettings).not.toHaveBeenCalled();
  });

  it('saves valid limits as tokens and commits aliases on blur', async () => {
    const { plugin, tab } = createSettingsTab();
    tab.display();
    await Promise.resolve();
    await Promise.resolve();

    const limitInput = tab.containerEl.querySelector<HTMLInputElement>(
      '[aria-label="Custom Context Limits: custom-model"]',
    );
    if (!limitInput) throw new Error('Expected custom-model override fields');

    limitInput.value = '512k';
    limitInput.dispatchEvent(new Event('input', { bubbles: true }));
    const aliasInput = tab.containerEl.querySelector<HTMLInputElement>(
      '[aria-label="Alias: custom-model"]',
    );
    if (!aliasInput) throw new Error('Expected the custom-model alias field');
    aliasInput.value = 'My Model';
    aliasInput.dispatchEvent(new Event('input', { bubbles: true }));
    aliasInput.dispatchEvent(new Event('blur'));
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(plugin.settings.customContextLimits['custom-model']).toBe(512_000);
    expect(plugin.settings.customModelAliases['custom-model']).toBe('My Model');
    expect(plugin.notifyProviderChatOptionsChanged).toHaveBeenCalledWith('claude');

    aliasInput.value = 'Unsaved name';
    aliasInput.dispatchEvent(new Event('input', { bubbles: true }));
    aliasInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(tab.containerEl.querySelector<HTMLInputElement>(
      '[aria-label="Alias: custom-model"]',
    )?.value).toBe('My Model');
    expect(plugin.mutateSettings).toHaveBeenCalledTimes(2);
  });

  it('restores the last saved alias and announces a persistence error', async () => {
    const { plugin, tab } = createSettingsTab();
    plugin.settings.customModelAliases['custom-model'] = 'Saved name';
    plugin.mutateSettings.mockRejectedValueOnce(new Error('Vault write failed'));
    tab.display();
    await Promise.resolve();
    await Promise.resolve();

    const aliasInput = tab.containerEl.querySelector<HTMLInputElement>(
      '[aria-label="Alias: custom-model"]',
    );
    if (!aliasInput) throw new Error('Expected the custom-model alias field');
    aliasInput.value = 'Unsaved name';
    aliasInput.dispatchEvent(new Event('input', { bubbles: true }));
    aliasInput.dispatchEvent(new Event('blur'));
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(tab.containerEl.querySelector<HTMLInputElement>(
      '[aria-label="Alias: custom-model"]',
    )?.value).toBe('Saved name');
    expect(tab.containerEl.querySelector('[role="alert"]')?.textContent)
      .toContain('Vault write failed');
  });
});
