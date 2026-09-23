/** @jest-environment jsdom */

import { h, render } from 'preact';

import { SettingsToggleListView } from '@/shared/settings/SettingsToggleListView';

const saveLabels = {
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Could not save',
};

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
      saveLabels,
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
      saveLabels,
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
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saving…');

    resolveChange();
    await Promise.resolve();
    await Promise.resolve();
    expect(toggle.disabled).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved');
  });

  it('announces a save failure and restores the last saved value', async () => {
    const onChange = jest.fn().mockRejectedValue(new Error('Disk is full'));
    const container = document.createElement('div');

    render(h(SettingsToggleListView, {
      items: [{
        id: 'auto-scroll',
        name: 'Enable auto-scroll',
        description: 'Keep the latest response visible.',
        value: true,
      }],
      onChange,
      saveLabels,
    }), container);

    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!toggle) {
      throw new Error('Expected an auto-scroll switch');
    }

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(toggle.checked).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe('Could not save: Disk is full');
  });
});
