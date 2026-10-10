/** @jest-environment jsdom */

import { axe } from 'jest-axe';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { ModelSelectorView, type ModelSelectorViewProps } from '@/features/chat/ui/ModelSelectorView';

describe('ModelSelectorView browsing', () => {
  let container: HTMLDivElement;
  let props: ModelSelectorViewProps;

  const options = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.claudian-model-option'));
  const click = async (selector: string) => {
    const button = container.querySelector<HTMLButtonElement>(selector);
    expect(button).not.toBeNull();
    await act(() => button!.click());
  };
  const search = async (query: string) => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input).not.toBeNull();
    await act(() => {
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    props = {
      id: 'model-picker',
      models: [
        { value: 'shared-id', label: 'Sonnet', providerId: 'claude', group: 'Claude' },
        { value: 'opus', label: 'Opus', providerId: 'claude', group: 'Claude' },
        { value: 'shared-id', label: 'GPT Sol', providerId: 'codex', group: 'Codex' },
      ],
      currentProviderId: 'claude',
      currentModel: 'shared-id',
      displayModelLabel: 'Sonnet',
      modelTitle: '',
      favoriteModels: [{ providerId: 'codex', model: 'shared-id' }],
      reasoningOptions: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
      reasoningValue: 'high',
      reasoningDefaultValue: 'low',
      reasoningLabel: 'Effort',
      serviceTier: null,
      serviceTierActive: false,
      onModelChange: jest.fn(),
      onFavoriteToggle: jest.fn(),
      onReasoningChange: jest.fn(),
      onServiceTierToggle: jest.fn(),
    };
    await act(() => render(h(ModelSelectorView, props), container));
    await click('.claudian-model-btn');
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('opens on the selected provider and only browses when a provider is clicked', async () => {
    expect(options().map(option => option.textContent)).toEqual(['Opus', 'Sonnet']);
    await click('[data-provider-filter="codex"]');
    expect(options().map(option => option.textContent)).toEqual(['GPT Sol']);
    expect(props.onModelChange).not.toHaveBeenCalled();
    expect(container.querySelector('.claudian-model-menu-footer')).toBeNull();
    await click('.claudian-model-option');
    expect(props.onModelChange).toHaveBeenCalledWith(props.models[2]);
  });

  it('places a stepped reasoning slider in the selected model pane and hides it during unrelated browsing', async () => {
    const footer = container.querySelector('.claudian-model-menu-footer');
    expect(container.querySelector('.claudian-model-browser-main')?.contains(footer)).toBe(true);
    expect(footer?.textContent).toContain('Sonnet');
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider).not.toBeNull();
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('1');
    expect(slider.step).toBe('1');
    expect(slider.value).toBe('1');
    expect(slider.getAttribute('aria-valuetext')).toBe('High');
    await act(() => { slider.value = '0'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(slider.getAttribute('aria-valuetext')).toBe('Low');
    expect(props.onReasoningChange).not.toHaveBeenCalled();
    await act(() => { slider.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(props.onReasoningChange).toHaveBeenCalledWith('low');
    await search('opus');
    expect(container.querySelector('.claudian-model-menu-footer')).toBeNull();
    await search('sonnet');
    expect(container.querySelector('.claudian-model-menu-footer')).not.toBeNull();
  });

  it('keeps the picker open and waits for the committed selection before changing its controls', async () => {
    await click('[data-provider-filter="codex"]');
    await click('.claudian-model-option');
    expect(container.querySelector('.claudian-model-dropdown')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('.claudian-model-menu-footer')).toBeNull();
    // The owner publishes the successful provider switch and its native options.
    props = { ...props, currentProviderId: 'codex', currentModel: 'shared-id', displayModelLabel: 'GPT Sol',
      reasoningOptions: [{ value: 'medium', label: 'Medium' }, { value: 'xhigh', label: 'Extra high' }],
      reasoningValue: 'xhigh', serviceTier: { inactiveValue: 'default', inactiveLabel: 'Standard',
        activeValue: 'fast', activeLabel: 'Fast' }, serviceTierActive: true };
    await act(() => render(h(ModelSelectorView, props), container));
    expect(container.querySelector('.claudian-model-dropdown')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('.claudian-model-menu-footer')?.textContent).toContain('GPT Sol');
    expect(container.querySelector<HTMLInputElement>('input[type="range"]')?.getAttribute('aria-valuetext')).toBe('Extra high');
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    await click('[role="switch"]');
    expect(props.onServiceTierToggle).toHaveBeenCalledTimes(1);
    expect((await axe(container)).violations).toEqual([]);
  });

  it('hides unsupported controls and closes when clicked outside', async () => {
    props = { ...props, reasoningOptions: [], serviceTier: null };
    await act(() => render(h(ModelSelectorView, props), container));
    expect(container.querySelector('.claudian-model-menu-footer')).toBeNull();
    await act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(container.querySelector('.claudian-model-dropdown')?.hasAttribute('hidden')).toBe(true);
  });

  it('searches labels and IDs inside the selected filter and can clear the query', async () => {
    await search('OPUS');
    expect(options()).toHaveLength(1);
    await click('[data-provider-filter="all"]');
    await search('shared-id');
    expect(options()).toHaveLength(2);
    await click('.claudian-model-search-clear');
    expect(options()).toHaveLength(3);
  });

  it('qualifies selection and favorites by provider even when IDs collide', async () => {
    await click('[data-provider-filter="all"]');
    expect(container.querySelectorAll('.claudian-model-option[aria-pressed="true"]')).toHaveLength(1);
    await click('[data-provider-filter="favorites"]');
    expect(options().map(option => option.textContent)).toEqual(['GPT Sol']);
    await click('.claudian-model-favorite');
    expect(props.onFavoriteToggle).toHaveBeenCalledWith(props.models[2]);
    expect(props.onModelChange).not.toHaveBeenCalled();
  });

  it('does not expose unavailable favorites or create synthetic model entries', async () => {
    props.favoriteModels = [{ providerId: 'pi', model: 'missing' }];
    await act(() => render(h(ModelSelectorView, props), container));
    await click('[data-provider-filter="favorites"]');
    expect(options()).toHaveLength(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('No favorite models');
    expect(container.querySelector('[data-provider-filter="pi"]')).toBeNull();
  });

  it('shows a search empty state and keeps the search input focused on clear', async () => {
    await search('no-such-model');
    expect(options()).toHaveLength(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('No matching models');
    await click('.claudian-model-search-clear');
    expect(document.activeElement).toBe(container.querySelector('input[type="search"]'));
  });

  it('moves focus from search into the list and restores it on Escape', async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.focus();
    await act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(options()[0]);
    await act(() => { options()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(options()[1]);
    await act(() => { options()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(container.querySelector('.claudian-model-dropdown')?.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('.claudian-model-btn'));
  });

  it('resets browsing and query when reopened', async () => {
    await click('[data-provider-filter="codex"]');
    await search('nothing');
    await click('.claudian-model-btn');
    await click('.claudian-model-btn');
    expect(options().map(option => option.textContent)).toEqual(['Opus', 'Sonnet']);
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('');
  });

  it('keeps model browsing and favorite actions accessible', async () => {
    expect((await axe(container)).violations).toEqual([]);
  });
});
