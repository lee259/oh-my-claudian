/** @jest-environment jsdom */

import { h, render } from 'preact';

import { SettingsToggleListView } from '@/shared/settings/SettingsToggleListView';

describe('SettingsToggleListView', () => {
  it('renders labeled switches and reports the changed setting id', async () => {
    const onChange = jest.fn(() => Promise.resolve());
    const container = document.createElement('div');

    render(h(SettingsToggleListView, {
      items: [
        {
          id: 'auto-scroll',
          name: 'Enable auto-scroll',
          description: 'Keep the latest response visible.',
          value: true,
        },
        {
          id: 'tab-titles',
          name: 'Show tab titles',
          description: 'Display titles for open chat tabs.',
          value: false,
        },
      ],
      onChange,
    }), container);

    const settings = [...container.querySelectorAll('.setting-item')];
    expect(settings).toHaveLength(2);
    expect(settings[0]?.querySelector('.setting-item-name')?.textContent)
      .toBe('Enable auto-scroll');
    expect(settings[0]?.querySelector('.setting-item-description')?.textContent)
      .toBe('Keep the latest response visible.');

    const switches = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(switches).toHaveLength(2);
    expect(switches[0]?.checked).toBe(true);
    expect(switches[1]?.checked).toBe(false);
    expect(switches[0]?.getAttribute('aria-label')).toBe('Enable auto-scroll');

    if (!switches[0]) {
      throw new Error('Expected the auto-scroll switch');
    }
    switches[0].checked = false;
    switches[0].dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledWith('auto-scroll', false);
  });

  it('disables a switch while its save is pending', async () => {
    let resolveChange!: () => void;
    const onChange = jest.fn(() => new Promise<void>((resolve) => {
      resolveChange = resolve;
    }));
    const container = document.createElement('div');

    render(h(SettingsToggleListView, {
      items: [{
        id: 'defer-math',
        name: 'Defer math rendering',
        description: 'Wait until streaming completes.',
        value: true,
      }],
      onChange,
    }), container);

    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!toggle) {
      throw new Error('Expected a settings toggle');
    }

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(toggle.disabled).toBe(true);

    resolveChange();
    await Promise.resolve();
    await Promise.resolve();
    expect(toggle.disabled).toBe(false);
  });
});
