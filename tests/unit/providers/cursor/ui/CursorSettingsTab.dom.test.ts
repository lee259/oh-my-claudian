/** @jest-environment jsdom */

jest.mock('obsidian', () => ({
  Notice: class {},
  Setting: class {
    settingEl: HTMLElement;
    controlEl: HTMLElement;
    constructor(container: HTMLElement) {
      this.settingEl = document.createElement('div');
      this.controlEl = document.createElement('div');
      this.settingEl.append(this.controlEl);
      container.append(this.settingEl);
    }
    setName(): this { return this; }
    setDesc(): this { return this; }
    setHeading(): this { return this; }
    addTextArea(callback: (component: unknown) => void): this {
      const inputEl = document.createElement('textarea');
      const component = {
        inputEl,
        setValue(value: string) { inputEl.value = value; return component; },
        setPlaceholder(value: string) { inputEl.placeholder = value; return component; },
      };
      this.controlEl.append(inputEl);
      callback(component);
      return this;
    }
  },
}));

import type { ProviderSettingsTabRendererContext } from '@/core/providers/types';
import type { CursorDiscoveredModel } from '@/providers/cursor/models';
import { cursorSettingsTabRenderer } from '@/providers/cursor/ui/CursorSettingsTab';
import { destroyCliLifecycleSections } from '@/shared/settings/CliLifecycleSection';
import { destroyHostnameCliPathSettings } from '@/shared/settings/HostnameCliPathSetting';
import { destroyProviderEnablementSettings } from '@/shared/settings/ProviderEnablementSetting';
import { destroyProviderModelPickers } from '@/shared/settings/ProviderModelPicker';
import { destroyProviderReadinessPanels } from '@/shared/settings/ProviderReadinessPanel';

beforeAll(() => {
  Object.assign(HTMLElement.prototype, {
    createEl(this: HTMLElement, tag: string, options: { cls?: string; text?: string; attr?: Record<string, string> } = {}) {
      const element = document.createElement(tag);
      if (options.cls) element.className = options.cls;
      if (options.text) element.textContent = options.text;
      for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
      this.append(element);
      return element;
    },
    createDiv(this: HTMLElement, options = {}) { return this.createEl('div', options); },
    createSpan(this: HTMLElement, options = {}) { return this.createEl('span', options); },
    addClass(this: HTMLElement, ...names: string[]) { this.classList.add(...names); },
    setText(this: HTMLElement, text: string) { this.textContent = text; },
  });
});

describe('Cursor settings model catalog', () => {
  let container: HTMLElement;

  beforeEach(() => { container = document.createElement('div'); });
  afterEach(() => {
    destroyProviderModelPickers(container);
    destroyProviderReadinessPanels(container);
    destroyProviderEnablementSettings(container);
    destroyHostnameCliPathSettings(container);
    destroyCliLifecycleSections(container);
  });

  function renderModels(models: CursorDiscoveredModel[]) {
    const settings = { providerConfigs: { cursor: { discoveredModels: models, visibleModels: [] } } };
    cursorSettingsTabRenderer.render(container, {
      plugin: {
        app: { vault: { adapter: { basePath: '/vault' } } },
        settings,
        getResolvedProviderCliPath: async () => null,
        getActiveEnvironmentVariables: () => '',
        mutateSettings: async (mutation: (target: typeof settings) => void) => mutation(settings),
      },
      notifyProviderModelOptionsChanged: () => {},
      renderHiddenProviderCommandSetting: () => {},
    } as unknown as ProviderSettingsTabRendererContext);
    return settings;
  }

  it('does not turn flat Cursor model IDs and their options into provider groups', async () => {
    const models = [
      { label: 'Auto Balance', rawId: 'auto-smart[optimize_for=balanced]' },
      { label: 'claude-opus-5-5', rawId: 'claude-opus-5-5[context=300k,effort=medium,fast=false]' },
      { label: 'gpt-5-mini', rawId: 'gpt-5-mini[]' },
    ];
    const settings = renderModels(models);
    const filter = container.querySelector<HTMLSelectElement>('.claudian-provider-model-picker-provider');
    expect(filter?.classList.contains('claudian-hidden')).toBe(true);
    expect(Array.from(filter?.options ?? []).map(option => option.value)).toEqual(['all']);
    expect(Array.from(container.querySelectorAll('.claudian-provider-model-picker-row-name'))
      .map(element => element.textContent)).toEqual(models.map(model => model.label));

    const checkbox = container.querySelector<HTMLInputElement>('.claudian-provider-model-picker-row input');
    if (!checkbox) throw new Error('Expected a model checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(settings.providerConfigs.cursor.visibleModels).toEqual(['auto-smart[optimize_for=balanced]']);
  });

  it('retains provider filtering for explicitly namespaced model IDs', async () => {
    renderModels([
      { label: 'Claude Sonnet', rawId: 'anthropic/claude-sonnet[effort=high]' },
      { label: 'GPT Mini', rawId: 'openai/gpt-mini[]' },
    ]);
    const filter = container.querySelector<HTMLSelectElement>('.claudian-provider-model-picker-provider');
    if (!filter) throw new Error('Expected a provider filter');
    expect(filter.classList.contains('claudian-hidden')).toBe(false);
    expect(Array.from(filter.options).map(option => option.value)).toEqual(['all', 'anthropic', 'openai']);
    filter.value = 'anthropic';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(Array.from(container.querySelectorAll('.claudian-provider-model-picker-row-name'))
      .map(element => element.textContent)).toEqual(['Claude Sonnet']);
  });
});
