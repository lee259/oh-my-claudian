/** @jest-environment jsdom */

import { h, render } from 'preact';

import { EnvironmentVariableSettingsView } from '@/shared/settings/EnvironmentVariableSettingsView';

describe('EnvironmentVariableSettingsView', () => {
  it('renders the environment field and updates ownership guidance while editing', async () => {
    const onApply = jest.fn(() => Promise.resolve());
    const container = document.createElement('div');

    render(h(EnvironmentVariableSettingsView, {
      scope: 'shared',
      name: 'Environment variables',
      description: 'Shared runtime variables.',
      placeholder: 'PATH=/usr/local/bin',
      initialValue: 'PATH=/usr/local/bin',
      onApply,
    }), container);

    expect(container.querySelector('.setting-item-name')?.textContent)
      .toBe('Environment variables');
    expect(container.querySelector('.setting-item-description')?.textContent)
      .toBe('Shared runtime variables.');

    const textarea = container.querySelector('textarea');
    expect(textarea?.value).toBe('PATH=/usr/local/bin');
    expect(textarea?.placeholder).toBe('PATH=/usr/local/bin');
    expect(container.querySelector('[role="status"]')?.hasAttribute('hidden')).toBe(true);

    if (!textarea) {
      throw new Error('Expected environment textarea');
    }
    textarea.value = 'FOO=bar';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    const warning = container.querySelector<HTMLElement>('[role="status"]');
    expect(warning?.textContent).toBe('Review environment ownership for: FOO');
    expect(warning?.hasAttribute('hidden')).toBe(false);

    textarea.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(onApply).toHaveBeenCalledWith('FOO=bar');
  });
});
