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
import type { OmpDiscoveredModel } from '@/providers/omp/models';
import { ompSettingsTabRenderer } from '@/providers/omp/ui/OmpSettingsTab';
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

describe('Omp settings model catalog', () => {
  let container: HTMLElement;

  beforeEach(() => { container = document.createElement('div'); });
  afterEach(() => {
    destroyProviderModelPickers(container);
    destroyProviderReadinessPanels(container);
    destroyProviderEnablementSettings(container);
    destroyHostnameCliPathSettings(container);
    destroyCliLifecycleSections(container);
  });

  function renderModels(models: OmpDiscoveredModel[]) {
    const settings = { providerConfigs: { omp: { discoveredModels: models, visibleModels: [] } } };
    ompSettingsTabRenderer.render(container, {
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

  it('groups role selectors separately and persists explicit enablement', async () => {
    const settings = renderModels([
      { label: '@smol', rawId: '@smol', description: 'openai/gpt-5-mini:off' },
      { label: 'GPT Mini', rawId: 'openai/gpt-5-mini' },
    ]);
    const filter = container.querySelector<HTMLSelectElement>('.claudian-provider-model-picker-provider');
    if (!filter) throw new Error('Expected a provider filter');
    expect(Array.from(filter.options).map(option => [option.value, option.textContent])).toContainEqual(['roles', 'Model roles (1)']);
    filter.value = 'roles';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(Array.from(container.querySelectorAll('.claudian-provider-model-picker-row-name'))
      .map(element => element.textContent)).toEqual(['@smol']);
    const checkbox = container.querySelector<HTMLInputElement>('.claudian-provider-model-picker-row input');
    if (!checkbox) throw new Error('Expected a role checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(settings.providerConfigs.omp.visibleModels).toEqual(['@smol']);
  });
});
