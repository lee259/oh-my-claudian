/** @jest-environment jsdom */

jest.mock('obsidian', () => ({
  Setting: class MockSetting {
    settingEl: HTMLElement;

    constructor(container: HTMLElement) {
      this.settingEl = document.createElement('div');
      container.append(this.settingEl);
    }

    addClass(className: string): void {
      this.settingEl.classList.add(className);
    }

    setDesc(): this { return this; }
    setHeading(): this { return this; }
    setName(): this { return this; }
  },
}));

import { type ProviderModelPickerState,renderProviderModelPicker } from '@/shared/settings/ProviderModelPicker';

beforeAll(() => {
  const prototype = HTMLElement.prototype as unknown as {
    createDiv(this: HTMLElement, options?: { cls?: string }): HTMLDivElement;
  };
  prototype.createDiv = function createDiv(this: HTMLElement, options = {}): HTMLDivElement {
    const element = document.createElement('div');
    if (options.cls) element.className = options.cls;
    this.append(element);
    return element;
  };
});

function createPickerState(): ProviderModelPickerState {
  return {
    aliases: {},
    discoveredCount: 3,
    models: [
      { id: 'claude-sonnet', name: 'Claude Sonnet', providerKey: 'anthropic', providerLabel: 'Anthropic' },
      { id: 'gpt-5', name: 'GPT 5', providerKey: 'openai', providerLabel: 'OpenAI' },
      { id: 'gpt-5-mini', name: 'GPT 5 Mini', providerKey: 'openai', providerLabel: 'OpenAI' },
    ],
    selectedIds: ['claude-sonnet'],
  };
}

describe('ProviderModelPicker public renderer', () => {
  it('filters the catalog by search text and provider', async () => {
    const container = document.createElement('div');
    const state = createPickerState();
    const picker = renderProviderModelPicker({
      container,
      emptyCatalogText: 'empty',
      failedCatalogText: 'failed',
      getState: () => state,
      loadCatalog: async () => 'loaded',
      loadingCatalogText: 'loading',
      modifier: 'test',
      onAliasesChange: async () => {},
      onSelectedIdsChange: async () => {},
      providerName: 'Test',
    });
    expect(container.querySelector('.claudian-provider-model-picker-setting')).not.toBeNull();
    expect(container.querySelector('.claudian-provider-model-picker-summary-value')?.textContent).toBe('1');
    expect(container.querySelector('.claudian-provider-model-picker-selected-default')?.textContent).toBe('Default');
    expect(container.querySelector('.claudian-provider-model-picker-selected-alias-field')).not.toBeNull();

    const search = container.querySelector<HTMLInputElement>('.claudian-provider-model-picker-search');
    const provider = container.querySelector<HTMLSelectElement>('.claudian-provider-model-picker-provider');
    if (!search || !provider) throw new Error('Expected model filters');

    search.value = 'mini';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    expect([...container.querySelectorAll('.claudian-provider-model-picker-row-name')]
      .map(element => element.textContent)).toEqual(['GPT 5 Mini']);

    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    provider.value = 'anthropic';
    provider.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect([...container.querySelectorAll('.claudian-provider-model-picker-row-name')]
      .map(element => element.textContent)).toEqual(['Claude Sonnet']);
    picker.dispose();
  });

  it('persists selection, removal, clearing, and keyboard reordering through callbacks', async () => {
    const container = document.createElement('div');
    const state = createPickerState();
    const onSelectedIdsChange = jest.fn(async (selectedIds: string[]) => {
      state.selectedIds = selectedIds;
    });
    const picker = renderProviderModelPicker({
      container,
      emptyCatalogText: 'empty',
      failedCatalogText: 'failed',
      getState: () => state,
      loadCatalog: async () => 'loaded',
      loadingCatalogText: 'loading',
      modifier: 'test',
      onAliasesChange: async () => {},
      onSelectedIdsChange,
      providerName: 'Test',
    });

    const checkbox = container.querySelector<HTMLInputElement>(
      '.claudian-provider-model-picker-row[title="gpt-5"] input[type="checkbox"]',
    );
    if (!checkbox) throw new Error('Expected a catalog model checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith(['claude-sonnet', 'gpt-5']);

    const firstDragHandle = container.querySelector<HTMLButtonElement>(
      '.claudian-provider-model-picker-selected-drag',
    );
    if (!firstDragHandle) throw new Error('Expected a selected model reorder control');
    firstDragHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await Promise.resolve();
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith(['gpt-5', 'claude-sonnet']);

    const removeButton = container.querySelector<HTMLButtonElement>(
      '.claudian-provider-model-picker-selected-remove',
    );
    if (!removeButton) throw new Error('Expected a selected model remove control');
    removeButton.click();
    await Promise.resolve();
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith(['claude-sonnet']);

    const clearButton = container.querySelector<HTMLButtonElement>(
      '.claudian-provider-model-picker-selected-clear',
    );
    if (!clearButton) throw new Error('Expected a clear-all control');
    clearButton.click();
    await Promise.resolve();
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith([]);
    picker.dispose();
  });

  it('reports catalog refresh state and disposes its rendered root', async () => {
    const container = document.createElement('div');
    const loadCatalog = jest.fn(async () => 'failed' as const);
    const picker = renderProviderModelPicker({
      container,
      checkCatalogFreshnessWhenCached: true,
      emptyCatalogText: 'empty',
      failedCatalogText: 'failed',
      getState: createPickerState,
      loadCatalog,
      loadingCatalogText: 'loading',
      modifier: 'test',
      onAliasesChange: async () => {},
      onSelectedIdsChange: async () => {},
      providerName: 'Test',
    });

    const catalog = container.querySelector<HTMLDetailsElement>('.claudian-provider-model-picker-catalog');
    if (!catalog) throw new Error('Expected a model catalog disclosure');
    catalog.open = true;
    catalog.dispatchEvent(new Event('toggle'));
    await Promise.resolve();
    expect(loadCatalog).toHaveBeenLastCalledWith(false);

    container.querySelector<HTMLButtonElement>('.claudian-provider-model-picker-action')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(loadCatalog).toHaveBeenCalledWith(true);
    expect(loadCatalog).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.claudian-provider-model-picker')?.getAttribute('data-catalog-status'))
      .toBe('failed');

    picker.dispose();
    expect(container.querySelector('.claudian-provider-model-picker')).toBeNull();
    expect(container.querySelector('.claudian-provider-model-picker-mount')).toBeNull();
  });
});
