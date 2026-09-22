/** @jest-environment jsdom */

import { h, render } from 'preact';

import {
  SettingsTabBar,
  type SettingsTabDefinition,
} from '@/shared/settings/SettingsTabBar';

const tabs: SettingsTabDefinition[] = [
  { id: 'general', label: 'General', contentId: 'settings-general' },
  { id: 'claude', label: 'Claude', contentId: 'settings-claude' },
  { id: 'codex', label: 'Codex', contentId: 'settings-codex' },
];

describe('SettingsTabBar', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('exposes tab semantics and keeps only the active tab in the tab order', () => {
    const container = document.createElement('div');
    container.setAttribute('role', 'tablist');
    document.body.appendChild(container);
    const onTabChange = jest.fn();

    render(h(SettingsTabBar, {
      tabs,
      initialActiveTabId: 'general',
      onTabChange,
    }), container);

    const tabButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabButtons).toHaveLength(3);
    expect(tabButtons.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(tabButtons.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabButtons[0].getAttribute('aria-controls')).toBe('settings-general');
  });

  it('moves selection and focus with keyboard navigation', () => {
    const container = document.createElement('div');
    container.setAttribute('role', 'tablist');
    document.body.appendChild(container);
    const onTabChange = jest.fn();

    render(h(SettingsTabBar, {
      tabs,
      initialActiveTabId: 'general',
      onTabChange,
    }), container);

    const generalTab = container.querySelector<HTMLButtonElement>('[data-tab-id="general"]');
    const codexTab = container.querySelector<HTMLButtonElement>('[data-tab-id="codex"]');
    if (!generalTab || !codexTab) {
      throw new Error('Expected settings tabs');
    }

    generalTab.focus();
    generalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(onTabChange).toHaveBeenCalledWith('claude');
    expect(document.activeElement).toBe(
      container.querySelector('[data-tab-id="claude"]'),
    );

    const claudeTab = container.querySelector<HTMLButtonElement>('[data-tab-id="claude"]');
    claudeTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(onTabChange).toHaveBeenLastCalledWith('codex');
    expect(document.activeElement).toBe(codexTab);

    codexTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(onTabChange).toHaveBeenLastCalledWith('general');
    expect(document.activeElement).toBe(generalTab);
  });
});
