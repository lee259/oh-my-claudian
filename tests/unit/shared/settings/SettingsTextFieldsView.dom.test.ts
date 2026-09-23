/** @jest-environment jsdom */

import { h, render } from 'preact';

import { SettingsTextFieldsView } from '@/shared/settings/SettingsTextFieldsView';

const saveLabels = {
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Could not save',
};

const item = {
  id: 'user-name',
  name: 'Name',
  description: 'Name included in prompts.',
  value: 'Ada',
  placeholder: 'Name',
};

describe('SettingsTextFieldsView', () => {
  it('flushes a pending save on blur before running the blur action', async () => {
    let resolveChange!: () => void;
    const onChange = jest.fn(() => new Promise<void>((resolve) => {
      resolveChange = resolve;
    }));
    const onBlur = jest.fn();
    const container = document.createElement('div');

    render(h(SettingsTextFieldsView, {
      items: [item],
      onChange,
      onBlur,
      saveLabels,
    }), container);

    const input = container.querySelector<HTMLInputElement>('input[type="text"]');
    if (!input) throw new Error('Expected a name input');

    input.value = 'Ada Lovelace';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur'));
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledWith('user-name', 'Ada Lovelace');
    expect(onBlur).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saving…');

    resolveChange();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(onBlur).toHaveBeenCalledWith('user-name');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved');
  });

  it('flushes a pending debounced value when the view is unmounted', async () => {
    const onChange = jest.fn(() => Promise.resolve());
    const container = document.createElement('div');

    render(h(SettingsTextFieldsView, {
      items: [item],
      onChange,
      saveLabels,
    }), container);

    const input = container.querySelector<HTMLInputElement>('input[type="text"]');
    if (!input) throw new Error('Expected a name input');

    input.value = 'Ada Lovelace';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    render(null, container);

    expect(onChange).toHaveBeenCalledWith('user-name', 'Ada Lovelace');
  });

  it('keeps the draft visible and announces when a save fails', async () => {
    const onChange = jest.fn().mockRejectedValue(new Error('Disk is full'));
    const container = document.createElement('div');

    render(h(SettingsTextFieldsView, {
      items: [item],
      onChange,
      saveLabels,
    }), container);

    const input = container.querySelector<HTMLInputElement>('input[type="text"]');
    if (!input) throw new Error('Expected a name input');

    input.value = 'Ada Lovelace';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => window.setTimeout(resolve, 200));

    expect(input.value).toBe('Ada Lovelace');
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe('Could not save: Disk is full');
  });
});
