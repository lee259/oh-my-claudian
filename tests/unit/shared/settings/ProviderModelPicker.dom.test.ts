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

import { waitFor } from '@testing-library/dom';
import { act } from 'preact/test-utils';

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
  it.each(['__proto__', 'constructor', 'toString'])('edits and clears the own alias for %s', async modelId => {
    const container = document.body.appendChild(document.createElement('div'));
    const state = createPickerState();
    state.models = [{ id: modelId, name: 'Native model' }];
    state.selectedIds = [modelId];
    const onAliasesChange = jest.fn(async aliases => { state.aliases = aliases; });
    const picker = renderProviderModelPicker({
      container, emptyCatalogText: 'empty', failedCatalogText: 'failed', getState: () => state,
      loadCatalog: async () => 'loaded', loadingCatalogText: 'loading', modifier: 'test',
      onAliasesChange, onSelectedIdsChange: async () => {}, providerName: 'Test',
    });
    try {
      const input = container.querySelector<HTMLInputElement>('.claudian-provider-model-picker-selected-alias')!;
      expect(input.value).toBe('');
      await act(async () => {
        input.focus();
        input.value = 'My alias';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => { input.blur(); });
      expect(Object.hasOwn(state.aliases, modelId)).toBe(true);
      expect(JSON.parse(JSON.stringify(state.aliases))[modelId]).toBe('My alias');
      expect(Object.getPrototypeOf(state.aliases)).toBe(Object.prototype);
      await act(async () => { picker.refresh(); });
      expect(input.value).toBe('My alias');
      await act(async () => {
        input.focus(); input.value = 'Discard';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(input.value).toBe('My alias');
      expect(onAliasesChange).toHaveBeenCalledTimes(1);
      await act(async () => {
        input.focus(); input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => { input.blur(); });
      expect(Object.hasOwn(state.aliases, modelId)).toBe(false);
      expect(Object.getPrototypeOf(state.aliases)).toBe(Object.prototype);
    } finally { picker.dispose(); container.remove(); }
  });

  it('retains a focused alias draft and caret across refresh, then saves on Enter', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    const state = createPickerState();
    const onAliasesChange = jest.fn(async aliases => { state.aliases = aliases; });
    const picker = renderProviderModelPicker({
      container, emptyCatalogText: 'empty', failedCatalogText: 'failed', getState: () => state,
      loadCatalog: async () => 'loaded', loadingCatalogText: 'loading', modifier: 'test',
      onAliasesChange, onSelectedIdsChange: async () => {}, providerName: 'Test',
    });
    try {
      const alias = container.querySelector<HTMLInputElement>('.claudian-provider-model-picker-selected-alias')!;
      await act(async () => {
        alias.focus();
        alias.value = ' My draft ';
        alias.dispatchEvent(new Event('input', { bubbles: true }));
      });
      alias.setSelectionRange(2, 5, 'backward');
      picker.refresh();
      expect(document.activeElement).toBe(alias);
      expect(alias.value).toBe(' My draft ');
      expect([alias.selectionStart, alias.selectionEnd, alias.selectionDirection]).toEqual([2, 5, 'backward']);
      expect(onAliasesChange).not.toHaveBeenCalled();
      await act(async () => {
        alias.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(onAliasesChange).toHaveBeenCalledWith({ 'claude-sonnet': 'My draft' });
      await waitFor(() => expect(alias.value).toBe('My draft'));
    } finally {
      picker.dispose(); container.remove();
    }
  });

  it('cancels the refreshed alias draft on Escape and follows later saved aliases', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    const state = createPickerState();
    state.aliases = { 'claude-sonnet': 'Original' };
    const onAliasesChange = jest.fn(async () => {});
    const picker = renderProviderModelPicker({
      container, emptyCatalogText: 'empty', failedCatalogText: 'failed', getState: () => state,
      loadCatalog: async () => 'loaded', loadingCatalogText: 'loading', modifier: 'test',
      onAliasesChange, onSelectedIdsChange: async () => {}, providerName: 'Test',
    });
    try {
      const alias = container.querySelector<HTMLInputElement>('.claudian-provider-model-picker-selected-alias')!;
      await act(async () => {
        alias.focus(); alias.value = 'Discard me';
        alias.dispatchEvent(new Event('input', { bubbles: true }));
      });
      picker.refresh();
      expect(alias.value).toBe('Discard me');
      await act(async () => {
        alias.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(alias.value).toBe('Original');
      expect(onAliasesChange).not.toHaveBeenCalled();
      state.aliases = { 'claude-sonnet': 'External update' };
      picker.refresh();
      expect(alias.value).toBe('External update');
    } finally {
      picker.dispose(); container.remove();
    }
  });

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
