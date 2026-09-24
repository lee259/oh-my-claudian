/** @jest-environment jsdom */

import '@/providers';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import type { WelcomeHomeOptions } from '@/features/chat/rendering/WelcomeRenderer';
import { unmountWelcomeElement } from '@/features/chat/rendering/WelcomeRenderer';
import { createTabRuntime } from '@/features/chat/tabs/TabRuntimeFactory';
import type { FeatureHost } from '@/features/FeatureHost';

describe('TabRuntimeFactory shared navigation header', () => {
  it('renders the home menu in the fixed header host, outside the message scroller', () => {
    const containerEl = document.createElement('div');
    const plugin = { settings: DEFAULT_CLAUDIAN_SETTINGS } as unknown as FeatureHost;
    const homeOptions: WelcomeHomeOptions = {
      getConversations: () => [],
      onOpenHistory: jest.fn(),
      onOpenSettings: jest.fn(),
      onNewConversation: jest.fn(),
    };
    const tab = createTabRuntime({
      plugin,
      containerEl,
      getWelcomeHomeOptions: () => homeOptions,
    });

    try {
      const headerHost = containerEl.querySelector('.claudian-conversation-header-host');

      expect({
        homeTitleInFixedHeaderHost: !!headerHost?.querySelector('.claudian-home-title'),
        homeTitleInsideMessageScroller: !!tab.dom.welcomeEl?.querySelector('.claudian-home-title'),
      }).toEqual({
        homeTitleInFixedHeaderHost: true,
        homeTitleInsideMessageScroller: false,
      });

      headerHost?.querySelector<HTMLButtonElement>('.claudian-home-action')?.click();
      expect(homeOptions.onOpenHistory).toHaveBeenCalledTimes(1);

      tab.dom.updateConversationHeader('A saved conversation');
      expect(containerEl.querySelector('.claudian-conversation-header-host')).toBe(headerHost);
      expect(headerHost?.querySelector('.claudian-conversation-header-title')?.textContent)
        .toBe('A saved conversation');
    } finally {
      tab.dom.conversationHeaderRoot.unmount();
      unmountWelcomeElement(tab.dom.welcomeEl);
    }
  });
});
