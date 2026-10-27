/** @jest-environment jsdom */

import '@/providers';

import { fireEvent, getByRole, queryByRole } from '@testing-library/dom';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';

HTMLElement.prototype.empty = function empty(): void {
  this.replaceChildren();
};
HTMLElement.prototype.setText = function setText(text: string): void {
  this.textContent = text;
};

function createTab() {
  const settings = JSON.parse(JSON.stringify(DEFAULT_CLAUDIAN_SETTINGS)) as typeof DEFAULT_CLAUDIAN_SETTINGS;
  settings.locale = 'en';
  const plugin = {
    settings,
    getActiveEnvironmentVariables: () => '',
    mutateSettings: jest.fn(async (mutate: (value: typeof settings) => void) => { mutate(settings); }),
    getAllViews: () => [],
    storage: { getAdapter: () => ({}) },
    providerHost: { settings, getEnvironmentVariablesForScope: () => '', applyEnvironmentVariables: jest.fn() },
  };
  const tab = new ClaudianSettingTab({} as any, plugin as any);
  tab.containerEl = document.createElement('div');
  document.body.append(tab.containerEl);
  return { tab, settings };
}

describe('Provider settings navigation', () => {
  beforeEach(() => {
    jest.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized').mockResolvedValue({} as any);
    jest.spyOn(ProviderWorkspaceRegistry, 'prepareSettings').mockResolvedValue();
    jest.spyOn(ProviderWorkspaceRegistry, 'getSettingsTabRenderer').mockReturnValue({
      render(container) { container.createEl('input', { attr: { 'aria-label': 'Provider draft' } }); },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('shows all providers with full names and loads only a selected detail page', async () => {
    const { tab } = createTab();
    tab.display();
    fireEvent.click(getByRole(tab.containerEl, 'tab', { name: 'Providers' }));

    const list = getByRole(tab.containerEl, 'list', { name: 'Providers' });
    expect(list.querySelectorAll('li')).toHaveLength(ProviderRegistry.getRegisteredProviderIds().length);
    expect(getByRole(list, 'button', { name: /DeepSeek Harness/ })).toBeTruthy();
    expect(ProviderWorkspaceRegistry.ensureInitialized).not.toHaveBeenCalled();

    fireEvent.click(getByRole(list, 'button', { name: /DeepSeek Harness/ }));
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(ProviderWorkspaceRegistry.ensureInitialized).toHaveBeenCalledTimes(1);
    expect(ProviderWorkspaceRegistry.ensureInitialized).toHaveBeenCalledWith(
      expect.anything(), 'deepseek', 'settings-tab',
    );
    expect(queryByRole(tab.containerEl, 'list', { name: 'Providers' })).toBeNull();
    expect(getByRole(tab.containerEl, 'heading', { name: 'DeepSeek Harness' })).toBeTruthy();
    expect(getByRole(tab.containerEl, 'textbox', { name: 'Provider draft' })).toBeTruthy();
  });

  it('preserves search, list position, focus and provider drafts when returning', async () => {
    const { tab } = createTab();
    tab.display();
    fireEvent.click(getByRole(tab.containerEl, 'tab', { name: 'Providers' }));
    const search = getByRole(tab.containerEl, 'searchbox', { name: 'Search providers' });
    fireEvent.input(search, { target: { value: 'hArNeSs' } });
    const list = getByRole(tab.containerEl, 'list', { name: 'Providers' });
    expect(list.querySelectorAll('li')).toHaveLength(1);
    const row = getByRole(list, 'button', { name: /DeepSeek Harness/ });
    tab.containerEl.scrollTop = 120;
    fireEvent.click(row);
    await new Promise(resolve => window.setTimeout(resolve, 0));
    const back = getByRole(tab.containerEl, 'button', { name: 'All providers' });
    expect(document.activeElement).toBe(back);
    expect(tab.containerEl.scrollTop).toBe(0);
    const draft = getByRole(tab.containerEl, 'textbox', { name: 'Provider draft' }) as HTMLInputElement;
    draft.value = 'Keep unsaved input';

    fireEvent.click(back);
    expect((getByRole(tab.containerEl, 'searchbox') as HTMLInputElement).value).toBe('hArNeSs');
    expect(tab.containerEl.scrollTop).toBe(120);
    expect(document.activeElement).toBe(row);
    expect(queryByRole(tab.containerEl, 'textbox', { name: 'Provider draft' })).toBeNull();

    fireEvent.click(row);
    expect(getByRole(tab.containerEl, 'textbox', { name: 'Provider draft' })).toBe(draft);
    expect(draft.value).toBe('Keep unsaved input');
    expect(ProviderWorkspaceRegistry.ensureInitialized).toHaveBeenCalledTimes(1);
  });

  it('filters enabled providers, refreshes status on return and recovers from empty results', async () => {
    const { tab, settings } = createTab();
    const ids = ProviderRegistry.getRegisteredProviderIds();
    for (const id of ids) ProviderRegistry.setEnabled(id, settings, id === 'deepseek');
    tab.display();
    fireEvent.click(getByRole(tab.containerEl, 'tab', { name: 'Providers' }));
    const enabledOnly = getByRole(tab.containerEl, 'checkbox', { name: 'Enabled only' });
    fireEvent.click(enabledOnly);
    expect(getByRole(tab.containerEl, 'list').querySelectorAll('li')).toHaveLength(1);
    fireEvent.click(getByRole(tab.containerEl, 'button', { name: /DeepSeek Harness/ }));
    ProviderRegistry.setEnabled('deepseek', settings, false);
    fireEvent.click(getByRole(tab.containerEl, 'button', { name: 'All providers' }));

    expect((getByRole(tab.containerEl, 'checkbox') as HTMLInputElement).checked).toBe(true);
    expect(getByRole(tab.containerEl, 'status').textContent).toBe('No matching providers.');
    expect(document.activeElement).toBe(getByRole(tab.containerEl, 'searchbox'));
    fireEvent.click(enabledOnly);
    expect(getByRole(tab.containerEl, 'list').querySelectorAll('li')).toHaveLength(ids.length);
    expect(getByRole(tab.containerEl, 'button', { name: /DeepSeek Harness/ }).textContent).toContain('Disabled');

    fireEvent.input(getByRole(tab.containerEl, 'searchbox'), { target: { value: 'no-such-provider' } });
    expect(getByRole(tab.containerEl, 'status').textContent).toBe('No matching providers.');
    fireEvent.input(getByRole(tab.containerEl, 'searchbox'), { target: { value: '' } });
    expect(getByRole(tab.containerEl, 'list').querySelectorAll('li')).toHaveLength(ids.length);
  });

  it('allows returning to the list during loading and retrying a failed provider', async () => {
    let rejectInitialization!: (error: Error) => void;
    jest.mocked(ProviderWorkspaceRegistry.ensureInitialized).mockImplementationOnce(() => (
      new Promise((_resolve, reject) => { rejectInitialization = reject; })
    ));
    const { tab } = createTab();
    tab.display();
    fireEvent.click(getByRole(tab.containerEl, 'tab', { name: 'Providers' }));
    fireEvent.click(getByRole(tab.containerEl, 'button', { name: /DeepSeek Harness/ }));
    expect(tab.containerEl.textContent).toContain('Loading DeepSeek Harness settings...');
    fireEvent.click(getByRole(tab.containerEl, 'button', { name: 'All providers' }));
    rejectInitialization(new Error('Unavailable installation'));
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(getByRole(tab.containerEl, 'list', { name: 'Providers' })).toBeTruthy();
    expect(ProviderWorkspaceRegistry.getSettingsTabRenderer).not.toHaveBeenCalled();

    fireEvent.click(getByRole(tab.containerEl, 'button', { name: /DeepSeek Harness/ }));
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(getByRole(tab.containerEl, 'textbox', { name: 'Provider draft' })).toBeTruthy();
    expect(ProviderWorkspaceRegistry.ensureInitialized).toHaveBeenCalledTimes(2);
  });
});
