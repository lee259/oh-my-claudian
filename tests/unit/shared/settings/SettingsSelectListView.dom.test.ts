/** @jest-environment jsdom */

import { h, render } from 'preact';

import { SettingsSelectListView } from '@/shared/settings/SettingsSelectListView';

const saveLabels = {
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Could not save',
};

describe('SettingsSelectListView', () => {
  it('shows save progress and completion for a changed option', async () => {
    let resolveChange!: () => void;
    const onChange = jest.fn(() => new Promise<void>((resolve) => {
      resolveChange = resolve;
    }));
    const container = document.createElement('div');

    render(h(SettingsSelectListView, {
      items: [{
        id: 'placement',
        name: 'Chat location',
        description: 'Choose where the chat opens.',
        value: 'right',
        options: [
          { value: 'right', label: 'Right sidebar' },
          { value: 'main', label: 'Main tab' },
        ],
      }],
      onChange,
      saveLabels,
    }), container);

    const select = container.querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('Expected a chat location selector');

    select.value = 'main';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(select.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saving…');

    resolveChange();
    await Promise.resolve();
    await Promise.resolve();
    expect(select.disabled).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved');
  });

  it('restores the saved option and announces a save error', async () => {
    const onChange = jest.fn().mockRejectedValue(new Error('Write failed'));
    const container = document.createElement('div');

    render(h(SettingsSelectListView, {
      items: [{
        id: 'placement',
        name: 'Chat location',
        description: 'Choose where the chat opens.',
        value: 'right',
        options: [
          { value: 'right', label: 'Right sidebar' },
          { value: 'main', label: 'Main tab' },
        ],
      }],
      onChange,
      saveLabels,
    }), container);

    const select = container.querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('Expected a chat location selector');

    select.value = 'main';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(select.value).toBe('right');
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe('Could not save: Write failed');
  });
});
