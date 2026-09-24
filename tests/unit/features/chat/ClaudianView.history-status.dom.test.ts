/** @jest-environment jsdom */

import '@/providers';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import { ClaudianView } from '@/features/chat/ClaudianView';
import { ConversationController } from '@/features/chat/controllers/ConversationController';
import { unmountWelcomeElement } from '@/features/chat/rendering/WelcomeRenderer';
import { createTabRuntime } from '@/features/chat/tabs/TabRuntimeFactory';
import type { FeatureHost } from '@/features/FeatureHost';

HTMLElement.prototype.empty = function empty(): void {
  this.replaceChildren();
};

function createHistoryHarness() {
  const style = document.createElement('style');
  style.textContent = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');
  document.head.appendChild(style);

  const pluginRoot = document.createElement('div');
  pluginRoot.className = 'oh-my-claudian-root';
  document.body.appendChild(pluginRoot);

  const viewContainer = pluginRoot.createDiv({ cls: 'claudian-home-state' });
  const historyDropdown = viewContainer.createDiv({ cls: 'claudian-history-menu visible' });
  const listHost = historyDropdown.createDiv({ cls: 'claudian-home-history-list-host' });
  const messagesEl = document.createElement('div');
  const inputEl = document.createElement('textarea');
  const tabContainer = pluginRoot.createDiv({ cls: 'claudian-test-tab-container' });
  const conversation = {
    id: 'conversation-1',
    title: 'Finished conversation',
    messages: [],
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    messageCount: 1,
    titleGenerationStatus: 'pending' as const,
  };
  const view = Object.create(ClaudianView.prototype) as any;
  const tab = createTabRuntime({
    plugin: { settings: DEFAULT_CLAUDIAN_SETTINGS } as FeatureHost,
    containerEl: tabContainer,
    onStreamingChanged: () => view.notifyConversationRuntimeStateChanged(),
  });
  tab.conversationId = conversation.id;
  tab.state.currentConversationId = conversation.id;
  tab.state.messages = [{
    id: 'message-1',
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
  }];
  const conversationController = new ConversationController({
    plugin: {
      getConversationList: () => [conversation],
      getConversationSync: () => conversation,
    } as any,
    state: tab.state,
    renderer: {} as any,
    subagentManager: {} as any,
    getHistoryDropdown: () => historyDropdown,
    getWelcomeEl: () => null,
    setWelcomeEl: () => {},
    getMessagesEl: () => messagesEl,
    getInputEl: () => inputEl,
    getFileContextManager: () => null,
    getImageContextManager: () => null,
    getMcpServerSelector: () => null,
    getExternalContextSelector: () => null,
    clearQueuedMessage: () => {},
    getTitleGenerationService: () => null,
    getStatusPanel: () => null,
    getExecutionCoordinator: () => null,
  } as any);

  tab.controllers.conversationController = conversationController;
  Object.assign(view, {
    plugin: {
      getAllViews: () => [view],
      getConversationSync: () => conversation,
      getConversationList: () => [conversation],
      findConversationAcrossViews: () => null,
    },
    tabManager: {
      getActiveTab: () => tab,
      getAllTabs: () => [tab],
      getTab: () => tab,
    },
    viewContainerEl: viewContainer,
    historyDropdown,
    historyListHostEl: listHost,
    historyDropdownDirty: true,
    historySurfaceRendered: true,
    historySearchQuery: '',
    historyRenderAbortController: null,
    pendingHistorySurfaceUpdate: null,
    isWideSessionLayout: false,
    isArchiveSessionView: false,
    activeSidebarSurface: 'sessions',
  });
  tab.state.isStreaming = true;

  return {
    cleanup: () => {
      tab.dom.conversationHeaderRoot.unmount();
      unmountWelcomeElement(tab.dom.welcomeEl);
    },
    historyDropdown,
    pluginRoot,
    state: tab.state,
    style,
    view,
  };
}

describe('ClaudianView history runtime status', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.body.replaceChildren();
    document.head.querySelectorAll('style').forEach(style => style.remove());
  });

  it('updates the rendered history row as soon as the active conversation finishes', () => {
    const harness = createHistoryHarness();
    cleanup = harness.cleanup;
    const { historyDropdown, state } = harness;

    expect(historyDropdown.querySelector('.claudian-history-item')?.getAttribute('data-running'))
      .toBe('true');

    state.isStreaming = false;

    expect(historyDropdown.querySelector('.claudian-history-item')?.getAttribute('data-running'))
      .toBe('false');
    expect(historyDropdown.querySelector('.claudian-session-running-indicator')).toBeNull();
  });

  it('updates the welcome recent row from a background tab streaming transition', () => {
    const pluginRoot = document.createElement('div');
    document.body.appendChild(pluginRoot);
    const homeContainer = pluginRoot.createDiv();
    const conversationContainer = pluginRoot.createDiv();
    const conversation = {
      id: 'background-conversation',
      title: 'Background conversation',
      messages: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      messageCount: 1,
      titleGenerationStatus: 'pending' as const,
    };
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: {
        getAllViews: () => [view],
        getConversationList: () => [conversation],
        findConversationAcrossViews: () => null,
      },
      updateConversationHeaders: () => {},
      updateHistoryDropdown: () => {},
      pendingHistorySurfaceUpdate: null,
    });
    const homeTab = createTabRuntime({
      plugin: { settings: DEFAULT_CLAUDIAN_SETTINGS } as FeatureHost,
      containerEl: homeContainer,
      getWelcomeHomeOptions: () => view.getWelcomeHomeOptions(),
    });
    const homeWelcomeEl = homeTab.dom.welcomeEl;
    if (!homeWelcomeEl) throw new Error('Expected the home tab to render its welcome view');
    const conversationTab = createTabRuntime({
      plugin: { settings: DEFAULT_CLAUDIAN_SETTINGS } as FeatureHost,
      containerEl: conversationContainer,
      onStreamingChanged: () => view.notifyConversationRuntimeStateChanged(),
    });
    conversationTab.conversationId = conversation.id;
    conversationTab.state.currentConversationId = conversation.id;
    Object.assign(view, {
      tabManager: {
        getActiveTab: () => homeTab,
        getAllTabs: () => [homeTab, conversationTab],
        getTab: () => conversationTab,
      },
    });
    cleanup = () => {
      homeTab.dom.conversationHeaderRoot.unmount();
      conversationTab.dom.conversationHeaderRoot.unmount();
      unmountWelcomeElement(homeTab.dom.welcomeEl);
      unmountWelcomeElement(conversationTab.dom.welcomeEl);
    };

    expect(homeWelcomeEl.querySelector('.claudian-home-conversation-loading'))
      .toBeNull();

    conversationTab.state.isStreaming = true;
    expect(homeWelcomeEl.querySelector('.claudian-home-conversation-loading'))
      .not.toBeNull();

    conversationTab.state.isStreaming = false;
    expect(homeWelcomeEl.querySelector('.claudian-home-conversation-loading'))
      .toBeNull();
  });

});
