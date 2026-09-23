/** @jest-environment jsdom */

import { h, render } from 'preact';

import { HotkeySettingsView } from '@/shared/settings/HotkeySettingsView';

describe('HotkeySettingsView', () => {
  it('renders keyboard-accessible hotkey actions and preserves missing shortcuts', () => {
    const onOpenSettings = jest.fn();
    const container = document.createElement('div');

    render(h(HotkeySettingsView, {
      items: [
        { id: 'open-chat', label: 'Open chat', hotkey: '⌘O' },
        { id: 'new-tab', label: 'New tab', hotkey: null },
      ],
      onOpenSettings,
    }), container);

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    expect(buttons.every(button => button.type === 'button')).toBe(true);
    expect(buttons.map(button => button.querySelector('.claudian-hotkey-name')?.textContent))
      .toEqual(['Open chat', 'New tab']);
    expect(buttons[0]?.querySelector('.claudian-hotkey-badge')?.textContent).toBe('⌘O');
    expect(buttons[1]?.querySelector('.claudian-hotkey-badge')).toBeNull();

    buttons[0]?.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
