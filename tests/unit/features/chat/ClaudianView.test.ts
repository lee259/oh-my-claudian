import { createMockEl } from '@test/helpers/MockElement';
import { Notice, Platform, Scope } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { ClaudianView } from '@/features/chat/ClaudianView';

const mockRefreshWelcomeContent = jest.fn();

jest.mock('@/features/chat/rendering/WelcomeRenderer', () => ({
  refreshWelcomeContent: (...args: unknown[]) => mockRefreshWelcomeContent(...args),
}));

const mockTabManagerConstructor = jest.fn();
jest.mock('@/features/chat/tabs/TabManager', () => ({
  TabManager: jest.fn().mockImplementation((...args: unknown[]) =>
    mockTabManagerConstructor(...args)),
}));
jest.mock('@/shared/ui/PreactRoot', () => ({
  createPreactRoot: jest.fn(() => ({
    render: jest.fn(),
    unmount: jest.fn(),
  })),
}));

const MockScope = Scope as typeof Scope & { instances: Scope[] };

function createModelRefreshTab(providerId: 'codex' | 'grok') {
  return {
    conversationId: `${providerId}-conversation`,
    dom: {
      inputWrapper: {
        toggleClass: jest.fn(),
      },
    },
    lifecycleState: 'cold',
    providerId,
    service: null,
    state: { usage: null },
    ui: {
      modeSelector: {
        renderOptions: jest.fn(),
        updateDisplay: jest.fn(),
      },
      modelSelector: {
        renderOptions: jest.fn(),
        updateDisplay: jest.fn(),
      },
      permissionToggle: { updateDisplay: jest.fn() },
      serviceTierToggle: { updateDisplay: jest.fn() },
      thinkingBudgetSelector: { updateDisplay: jest.fn() },
    },
  };
}

function createBlankModelRefreshTab(providerId: 'codex' | 'grok') {
  return {
    ...createModelRefreshTab(providerId),
    conversationId: null,
    draftModel: null,
    lifecycleState: 'cold',
    services: {
      instructionRefineService: null,
      subagentManager: {
        setTaskResultInterpreter: jest.fn(),
      },
    },
    ui: {
      ...createModelRefreshTab(providerId).ui,
      permissionToggle: {
        setVisible: jest.fn(),
        updateDisplay: jest.fn(),
      },
    },
  };
}

describe('ClaudianView model refresh routing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refreshes matching bound tabs and all blank tabs without priming runtimes', () => {
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot')
      .mockImplementation((_settings, providerId) => ({
        customContextLimits: {},
        model: `${providerId}-model`,
        permissionMode: 'normal',
      }));
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue({
      getContextWindowSize: jest.fn().mockReturnValue(200_000),
      getPermissionModeToggle: jest.fn().mockReturnValue(null),
    } as any);
    jest.spyOn(ProviderRegistry, 'getCapabilities').mockImplementation(providerId => ({
      providerId,
      supportsImageAttachments: false,
      supportsMcpTools: false,
      supportsPlanMode: false,
    } as any));
    jest.spyOn(ProviderRegistry, 'getEnabledProviderIds').mockReturnValue(['codex', 'grok']);
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService')
      .mockReturnValue(null as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter')
      .mockReturnValue(null as any);

    const codexTab = createModelRefreshTab('codex');
    const grokTab = createModelRefreshTab('grok');
    const blankGrokTab = createBlankModelRefreshTab('grok');
    const primeProviderExecution = jest.fn();
    const view = Object.create(ClaudianView.prototype) as any;
    view.plugin = {
      getConversationSync: jest.fn().mockReturnValue(null),
      providerHost: {},
      settings: {},
    };
    view.tabManager = {
      getAllTabs: jest.fn().mockReturnValue([codexTab, grokTab, blankGrokTab]),
      primeProviderExecution,
      reconcileProviderAvailability: jest.fn(),
    };

    view.refreshModelSelector('codex');

    expect(codexTab.ui.modelSelector.updateDisplay).toHaveBeenCalledTimes(1);
    expect(codexTab.ui.modelSelector.renderOptions).toHaveBeenCalledTimes(1);
    expect(grokTab.ui.modelSelector.updateDisplay).not.toHaveBeenCalled();
    expect(grokTab.ui.modelSelector.renderOptions).not.toHaveBeenCalled();
    expect(blankGrokTab.ui.modelSelector.updateDisplay).toHaveBeenCalled();
    expect(blankGrokTab.ui.modelSelector.renderOptions).toHaveBeenCalled();
    expect(view.tabManager.reconcileProviderAvailability).toHaveBeenCalledTimes(1);
    expect(primeProviderExecution).not.toHaveBeenCalled();
  });

  it('refreshes localized composer UI in every retained tab', () => {
    const refreshDraft = jest.fn();
    const refreshConversation = jest.fn();
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = {
      getAllTabs: jest.fn().mockReturnValue([
        { ui: { refreshComposerLocale: refreshDraft } },
        { ui: { refreshComposerLocale: refreshConversation } },
      ]),
    };

    view.refreshComposerLocale();

    expect(refreshDraft).toHaveBeenCalledTimes(1);
    expect(refreshConversation).toHaveBeenCalledTimes(1);
  });
});

describe('ClaudianView chat surface state', () => {
  it('opens the plugin settings tab from the home settings action', () => {
    const open = jest.fn();
    const openTabById = jest.fn();
    const view = Object.create(ClaudianView.prototype) as any;
    view.plugin = {
      app: { setting: { open, openTabById } },
      getConversationList: jest.fn().mockReturnValue([]),
    };

    const options = view.getWelcomeHomeOptions();
    options.onOpenSettings();

    expect(open).toHaveBeenCalledTimes(1);
    expect(openTabById).toHaveBeenCalledWith('oh-my-claudian');
    expect(open.mock.invocationCallOrder[0])
      .toBeLessThan(openTabById.mock.invocationCallOrder[0]);
  });

  it('renames the requested conversation from its header action', () => {
    const renameConversation = jest.fn().mockResolvedValue(undefined);
    const view = Object.create(ClaudianView.prototype) as any;
    view.plugin = {
      getConversationList: jest.fn().mockReturnValue([]),
      renameConversation,
    };

    view.getWelcomeHomeOptions().onRenameConversation('conversation-7', 'A clearer title');

    expect(renameConversation).toHaveBeenCalledWith('conversation-7', 'A clearer title');
  });

  it('mirrors the active home or conversation state to shared and tab-owned surfaces', () => {
    const activeTab = {
      id: 'draft-tab',
      conversationId: null as string | null,
      state: { messages: [] as Array<{ id: string }> },
      dom: { contentEl: createMockEl() },
    };
    const inactiveTab = {
      id: 'conversation-tab',
      conversationId: 'conversation-1',
      state: { messages: [{ id: 'message-1' }] },
      dom: { contentEl: createMockEl() },
    };
    const view = Object.create(ClaudianView.prototype) as any;
    view.viewContainerEl = createMockEl();
    view.inputFooterEl = createMockEl();
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(activeTab),
      getAllTabs: jest.fn().mockReturnValue([activeTab, inactiveTab]),
    };
    view.updateConversationHeaders = jest.fn();

    view.updateHomeSurfaceState();

    expect(view.inputFooterEl.hasClass('claudian-home-state')).toBe(true);
    expect(view.inputFooterEl.hasClass('claudian-conversation-state')).toBe(false);
    expect(activeTab.dom.contentEl.hasClass('claudian-home-state')).toBe(true);
    expect(activeTab.dom.contentEl.hasClass('claudian-conversation-state')).toBe(false);
    expect(inactiveTab.dom.contentEl.hasClass('claudian-home-state')).toBe(false);
    expect(inactiveTab.dom.contentEl.hasClass('claudian-conversation-state')).toBe(false);

    activeTab.conversationId = 'conversation-2';
    activeTab.state.messages = [{ id: 'message-2' }];
    view.updateHomeSurfaceState(activeTab);

    expect(view.inputFooterEl.hasClass('claudian-home-state')).toBe(false);
    expect(view.inputFooterEl.hasClass('claudian-conversation-state')).toBe(true);
    expect(activeTab.dom.contentEl.hasClass('claudian-home-state')).toBe(false);
    expect(activeTab.dom.contentEl.hasClass('claudian-conversation-state')).toBe(true);
  });

  it('switches the shared header presentation when history opens a conversation', () => {
    const updateConversationHeader = jest.fn();
    const tab = {
      conversationId: null as string | null,
      dom: { updateConversationHeader },
      state: { messages: [] as Array<{ id: string }> },
    };
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: {
        getConversationSync: jest.fn().mockReturnValue({ title: 'Opened from history' }),
      },
      tabManager: { getAllTabs: jest.fn().mockReturnValue([tab]) },
    });

    view.updateConversationHeaders();
    expect(updateConversationHeader.mock.lastCall).toEqual([expect.any(String), true, null]);

    tab.conversationId = 'history-conversation';
    tab.state.messages.push({ id: 'message-1' });
    view.updateConversationHeaders();
    expect(updateConversationHeader.mock.lastCall).toEqual([
      'Opened from history',
      false,
      'history-conversation',
    ]);
  });
});

describe('ClaudianView tab controls', () => {
  it('focuses the composer after creating a new tab', async () => {
    const inputEl = createMockEl('textarea') as unknown as HTMLTextAreaElement;
    inputEl.focus = jest.fn();
    const tab = { dom: { inputEl } };
    const view = Object.create(ClaudianView.prototype) as any;

    view.plugin = { settings: {} };
    view.tabManager = {
      createTab: jest.fn().mockResolvedValue(tab),
    };
    view.updateTabBarVisibility = jest.fn();

    await view.createNewTab();

    expect(inputEl.focus).toHaveBeenCalledTimes(1);
  });

;

;

;

;

;







  it('keeps archive navigation at the top of the single-mode history list', () => {
    const container = createMockEl();
    const list = container.createDiv({ cls: 'claudian-history-list' });
    list.createDiv({ cls: 'claudian-history-item' });
    const setArchiveSessionView = jest.fn();
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      isArchiveSessionView: false,
      setArchiveSessionView,
    });

    view.buildHistoryArchiveNavigation(container);

    const archiveControl = list.querySelector('.claudian-history-archive-control')!;
    expect(list.children[0]).toBe(archiveControl);
    expect(archiveControl.querySelector('.claudian-session-nav-label')?.textContent)
      .toBe('Archive');
    const stopPropagation = jest.fn();
    archiveControl.dispatchEvent({
      type: 'click',
      stopPropagation,
    });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(setArchiveSessionView).toHaveBeenCalledWith(true);
  });

  it('keeps conversation navigation on the single-mode history surface', () => {
    const container = createMockEl();
    const ownerRequestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    container.ownerDocument.defaultView.requestAnimationFrame = ownerRequestAnimationFrame;
    const globalRequestAnimationFrame = jest.spyOn(window, 'requestAnimationFrame');
    const renderHistoryDropdown = jest.fn();
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      isArchiveSessionView: false,
      historyDropdown: container,
      openHistoryConversation: jest.fn(),
      getHistoryConversationStatus: jest.fn(),
      setConversationPinned: jest.fn(),
      setConversationArchived: jest.fn(),
      updateHistoryDropdown: jest.fn(),
      buildHistoryArchiveNavigation: jest.fn(),
      tabManager: {
        getActiveTab: jest.fn().mockReturnValue({
          controllers: { conversationController: { renderHistoryDropdown } },
        }),
      },
    });

    view.renderHistorySurface(container, new AbortController().signal);

    const options = renderHistoryDropdown.mock.calls[0]?.[1];
    expect(options.showOpenStateLabels).toBe(false);
    expect(options.showOpenStateIndicators).toBe(false);
    expect(options.showHistoryHeader).toBe(false);
    expect(options.showOpenStateActions).toBe(true);
    expect(options.onRequestInlineRename).toEqual(expect.any(Function));
    expect(options).not.toHaveProperty('onOpenConversationInNewTab');
    expect(options.onBeforeRestoreListState).toEqual(expect.any(Function));
    expect(options).not.toHaveProperty('organization');
    expect(options).not.toHaveProperty('showMetadataPopover');

    const beginRename = jest.fn();
    const targetItem = container.createDiv({ cls: 'claudian-history-item' });
    targetItem.setAttribute('data-conversation-id', 'conversation-1');
    options.onRequestInlineRename({
      beginRename,
      conversationId: 'conversation-1',
    });
    expect(container.hasClass('visible')).toBe(true);
    expect(beginRename).toHaveBeenCalledWith(targetItem);
    expect(ownerRequestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(globalRequestAnimationFrame).not.toHaveBeenCalled();
    globalRequestAnimationFrame.mockRestore();
  });


  it('focuses the current unbound draft when New is clicked again in dual mode', async () => {
    const inputEl = createMockEl('textarea') as unknown as HTMLTextAreaElement;
    inputEl.focus = jest.fn();
    const draftTab = { id: 'draft-1', conversationId: null, dom: { inputEl } };
    const view = Object.create(ClaudianView.prototype) as any;

    view.createNewTab = jest.fn();
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(draftTab),
      getAllTabs: jest.fn().mockReturnValue([draftTab]),
      switchToTab: jest.fn(),
    };

    await view.activateOrCreateDraftTab();

    expect(inputEl.focus).toHaveBeenCalledTimes(1);
    expect(view.tabManager.switchToTab).not.toHaveBeenCalled();
    expect(view.createNewTab).not.toHaveBeenCalled();
  });

  it('resumes the most recent unbound draft instead of creating another one', async () => {
    const firstInputEl = createMockEl('textarea') as unknown as HTMLTextAreaElement;
    const latestInputEl = createMockEl('textarea') as unknown as HTMLTextAreaElement;
    firstInputEl.focus = jest.fn();
    latestInputEl.focus = jest.fn();
    const activeTab = { id: 'tab-1', conversationId: 'conversation-1' };
    const firstDraft = { id: 'draft-1', conversationId: null, dom: { inputEl: firstInputEl } };
    const latestDraft = { id: 'draft-2', conversationId: null, dom: { inputEl: latestInputEl } };
    const view = Object.create(ClaudianView.prototype) as any;

    view.createNewTab = jest.fn();
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(activeTab),
      getAllTabs: jest.fn().mockReturnValue([activeTab, firstDraft, latestDraft]),
      switchToTab: jest.fn().mockResolvedValue(undefined),
    };

    await view.activateOrCreateDraftTab();

    expect(view.tabManager.switchToTab).toHaveBeenCalledWith('draft-2');
    expect(latestInputEl.focus).toHaveBeenCalledTimes(1);
    expect(firstInputEl.focus).not.toHaveBeenCalled();
    expect(view.createNewTab).not.toHaveBeenCalled();
  });

  it('creates an unbound draft tab when no draft can be resumed', async () => {
    const activeTab = { id: 'tab-1', conversationId: 'conversation-1' };
    const view = Object.create(ClaudianView.prototype) as any;

    view.createNewTab = jest.fn().mockResolvedValue(undefined);
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(activeTab),
      getAllTabs: jest.fn().mockReturnValue([activeTab]),
    };

    await view.activateOrCreateDraftTab();

    expect(view.createNewTab).toHaveBeenCalledTimes(1);
  });

  it('handles a New conversation command in the single chat layout', async () => {
    const view = Object.create(ClaudianView.prototype) as any;
    view.activateOrCreateDraftTab = jest.fn().mockResolvedValue(undefined);

    await expect(view.handleNewConversationCommand()).resolves.toBe(true);

    expect(view.activateOrCreateDraftTab).toHaveBeenCalledTimes(1);
  });

  it('handles a New conversation command without a wide-layout guard', async () => {
    const view = Object.create(ClaudianView.prototype) as any;
    view.activateOrCreateDraftTab = jest.fn().mockResolvedValue(undefined);

    await expect(view.handleNewConversationCommand()).resolves.toBe(true);

    expect(view.activateOrCreateDraftTab).toHaveBeenCalledTimes(1);
  });

  it('starts an approved plan in a fresh runtime tab', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const targetTab = {
      controllers: { inputController: { sendMessage } },
    };
    const view = Object.create(ClaudianView.prototype) as any;
    view.createNewTab = jest.fn().mockResolvedValue(undefined);
    view.tabManager = { getActiveTab: jest.fn().mockReturnValue(targetTab) };

    await expect(view.handleNewSessionPlan('Implement the plan')).resolves.toBe(true);

    expect(view.createNewTab).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ content: 'Implement the plan' });
  });

  it('starts an approved plan without a wide-layout guard', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const targetTab = {
      controllers: { inputController: { sendMessage } },
    };
    const view = Object.create(ClaudianView.prototype) as any;
    view.createNewTab = jest.fn().mockResolvedValue(undefined);
    view.tabManager = { getActiveTab: jest.fn().mockReturnValue(targetTab) };

    await expect(view.handleNewSessionPlan('Implement the plan')).resolves.toBe(true);

    expect(view.createNewTab).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ content: 'Implement the plan' });
  });

  it('moves the shared navigation content into the view-owned input row', () => {
    const navRowContent = createMockEl();
    const inputNavRowHostEl = createMockEl();
    const view = Object.create(ClaudianView.prototype) as any;

    view.containerEl = createMockEl();
    view.navRowContent = navRowContent;
    view.inputNavRowHostEl = inputNavRowHostEl;
    view.attachNavRowContentToInputFooter();

    expect(inputNavRowHostEl.children).toContain(navRowContent);
  });

  it('moves only the active tab input into the stable input slot', () => {
    const activeInputSlotEl = createMockEl();
    const tab1 = {
      id: 'tab-1',
      dom: {
        contentEl: createMockEl(),
        inputComposerEl: createMockEl(),
        inputContainerEl: createMockEl(),
      },
    };
    const tab2 = {
      id: 'tab-2',
      dom: {
        contentEl: createMockEl(),
        inputComposerEl: createMockEl(),
        inputContainerEl: createMockEl(),
      },
    };
    const view = Object.create(ClaudianView.prototype) as any;

    view.activeInputSlotEl = activeInputSlotEl;
    view.tabManager = {
      getActiveTab: jest.fn()
        .mockReturnValueOnce(tab1)
        .mockReturnValueOnce(tab2),
      getTab: jest.fn((id: string) => id === 'tab-1' ? tab1 : tab2),
    };

    view.updateInputLocation();
    view.updateInputLocation();

    expect(activeInputSlotEl.children).toContain(tab2.dom.inputComposerEl);
    expect(activeInputSlotEl.children).not.toContain(tab1.dom.inputComposerEl);
    expect(tab1.dom.contentEl.children).toContain(tab1.dom.inputComposerEl);
  });

  it('preserves active pending prompt siblings during same-tab input updates', () => {
    const activeInputSlotEl = createMockEl();
    const inputComposerEl = activeInputSlotEl.createDiv();
    const pendingPromptEl = inputComposerEl.createDiv({ cls: 'claudian-ask-question-inline' });
    const tab = {
      id: 'tab-1',
      dom: {
        contentEl: createMockEl(),
        inputComposerEl,
        inputContainerEl: inputComposerEl.createDiv({ cls: 'claudian-input-container' }),
      },
    };
    const view = Object.create(ClaudianView.prototype) as any;

    Object.defineProperty(inputComposerEl, 'parentElement', {
      configurable: true,
      get: () => activeInputSlotEl,
    });
    view.activeInputTabId = 'tab-1';
    view.activeInputSlotEl = activeInputSlotEl;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(tab),
      getTab: jest.fn().mockReturnValue(tab),
    };

    view.updateInputLocation();

    expect(activeInputSlotEl.children).toContain(inputComposerEl);
    expect(inputComposerEl.children).toContain(pendingPromptEl);
  });

  it('clears the stable input slot when no tab is active', () => {
    const activeInputSlotEl = createMockEl();
    const staleInputEl = activeInputSlotEl.createDiv();
    const view = Object.create(ClaudianView.prototype) as any;

    view.activeInputTabId = 'tab-1';
    view.activeInputSlotEl = activeInputSlotEl;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(null),
    };

    view.updateInputLocation();

    expect(activeInputSlotEl.children).not.toContain(staleInputEl);
    expect(view.activeInputTabId).toBeNull();
  });

  it('toggles the history dropdown when the history button is clicked', () => {
    const historyDropdown = createMockEl();
    const view = Object.create(ClaudianView.prototype) as any;

    view.historyDropdown = historyDropdown;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(null),
    };

    view.toggleHistoryDropdown();

    expect(historyDropdown.hasClass('visible')).toBe(true);

    view.toggleHistoryDropdown();

    expect(historyDropdown.hasClass('visible')).toBe(false);
  });

  it('forces the new-conversation action to finish even if the active turn is streaming', async () => {
    const createNewConversation = jest.fn().mockResolvedValue(undefined);
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      tabManager: {
        createNewConversation,
        getActiveTab: jest.fn().mockReturnValue({ state: { isStreaming: true } }),
      },
      updateHistoryDropdown: jest.fn(),
    });

    view.requestNewConversation();
    await Promise.resolve();
    await Promise.resolve();

    expect(createNewConversation).toHaveBeenCalledWith({ force: true });
  });

  it('switches the history menu between active and archived conversations', () => {
    const historyDropdown = createMockEl();
    historyDropdown.addClass('visible');
    const renderHistoryDropdown = jest.fn((container, _options?: unknown) => {
      container.empty();
      container.createDiv({ cls: 'claudian-history-header' });
      container.createDiv({ cls: 'claudian-history-list' });
      (_options as { onBeforeRestoreListState?: (target: HTMLElement) => void })
        ?.onBeforeRestoreListState?.(container);
    });
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      historyDropdown,
      historyDropdownDirty: true,
      historySurfaceRendered: true,
      isArchiveSessionView: false,
      plugin: {},
      tabManager: {
        getActiveTab: jest.fn().mockReturnValue({
          controllers: { conversationController: { renderHistoryDropdown } },
        }),
      },
    });

    view.renderHistoryDropdown();

    expect(renderHistoryDropdown).toHaveBeenLastCalledWith(
      view.historyListHostEl,
      expect.objectContaining({
        preserveListState: true,
        sessionScope: 'active',
        sessionActionMode: 'active',
        allowConversationSelection: true,
        onBeforeRestoreListState: expect.any(Function),
      }),
    );
    historyDropdown.querySelector('.claudian-history-archive-control')!.click();

    expect(view.isArchiveSessionView).toBe(true);
    expect(renderHistoryDropdown).toHaveBeenLastCalledWith(
      view.historyListHostEl,
      expect.objectContaining({
        preserveListState: true,
        sessionScope: 'archived',
        sessionActionMode: 'archived',
        allowConversationSelection: false,
      }),
    );
    expect(renderHistoryDropdown.mock.calls.at(-1)?.[1])
      .not.toHaveProperty('onOpenConversationInNewTab');
    expect(historyDropdown.querySelector('.claudian-session-nav-label')?.textContent)
      .toBe('Sessions');
  });

  it('defers hidden history rendering and coalesces invalidations until the dropdown opens', () => {
    const historyDropdown = createMockEl();
    const renderHistoryDropdown = jest.fn();
    const view = Object.create(ClaudianView.prototype) as any;

    view.historyDropdown = historyDropdown;
    view.historyDropdownDirty = true;
    view.historySurfaceRendered = false;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        controllers: {
          conversationController: { renderHistoryDropdown },
        },
      }),
    };

    view.updateHistoryDropdown();
    view.updateHistoryDropdown();

    expect(renderHistoryDropdown).not.toHaveBeenCalled();

    view.toggleHistoryDropdown();

    expect(renderHistoryDropdown).toHaveBeenCalledTimes(1);
    const firstRenderSignal = renderHistoryDropdown.mock.calls[0][1].signal as AbortSignal;
    expect(firstRenderSignal.aborted).toBe(false);

    view.updateHistoryDropdown();

    expect(renderHistoryDropdown).toHaveBeenCalledTimes(2);
    const secondRenderSignal = renderHistoryDropdown.mock.calls[1][1].signal as AbortSignal;

    view.toggleHistoryDropdown();
    expect(firstRenderSignal.aborted).toBe(true);
    expect(secondRenderSignal.aborted).toBe(true);
    view.updateHistoryDropdown();

    expect(renderHistoryDropdown).toHaveBeenCalledTimes(2);

    view.toggleHistoryDropdown();

    expect(renderHistoryDropdown).toHaveBeenCalledTimes(3);
    const reopenedSignal = renderHistoryDropdown.mock.calls[2][1].signal as AbortSignal;
    expect(reopenedSignal.aborted).toBe(false);
  });

  it('builds a single chat panel without a persistent session column', () => {
    const viewContainerEl = createMockEl();
    const view = Object.create(ClaudianView.prototype) as any;

    view.viewContainerEl = viewContainerEl;

    view.buildViewLayout();

    expect(viewContainerEl.children).toHaveLength(1);
    expect(viewContainerEl.children[0].hasClass('claudian-chat-panel')).toBe(true);
    expect(viewContainerEl.children[0].children).toContain(view.tabContentEl);
    expect(viewContainerEl.children[0].children).toContain(view.inputFooterEl);
  });

  it('mounts the history overlay in the chat panel instead of the input footer', () => {
    const viewContainerEl = createMockEl();
    const view = Object.create(ClaudianView.prototype) as any;
    view.viewContainerEl = viewContainerEl;

    view.buildViewLayout();

    expect(view.chatPanelEl?.children).toContain(view.historyDropdown);
    expect(view.historyDropdown?.hasClass('claudian-history-menu')).toBe(true);
    expect(view.inputFooterEl?.contains(view.historyDropdown)).toBe(false);
  });

  it('does not add a dual-pane toggle to the chat navigation actions', () => {
    const view = Object.create(ClaudianView.prototype) as any;
    const viewContainerEl = createMockEl();
    Object.assign(view, {
      containerEl: createMockEl(),
      viewContainerEl,
    });

    const nav = view.buildNavRowContent();
    expect(nav.querySelector('.claudian-dual-pane-toggle-btn')).toBeNull();
  });

  it('builds chat navigation actions as native buttons without changing their handlers', () => {
    const requestNewTab = jest.fn();
    const requestNewConversation = jest.fn();
    const toggleHistoryDropdown = jest.fn();
    const view = Object.create(ClaudianView.prototype) as any;

    Object.assign(view, {
      containerEl: createMockEl(),
      handleTabClick: jest.fn(),
      handleTabClose: jest.fn(),
      persistTabWorkspaceState: jest.fn(),
      plugin: { settings: { showTabTitlesByDefault: true } },
      requestNewConversation,
      requestNewTab,
      toggleHistoryDropdown,
    });

    const navContent = view.buildNavRowContent();
    const newTabButton = navContent.querySelector('.claudian-new-tab-btn')!;
    const newConversationButton = navContent.querySelector('.claudian-new-conversation-btn')!;
    const historyButton = navContent.querySelector('.claudian-history-container')!.children[0];
    const buttons = [newTabButton, newConversationButton, historyButton];

    expect(buttons.map(button => button.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(buttons.map(button => button.getAttribute('type'))).toEqual([
      'button',
      'button',
      'button',
    ]);
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      'New tab',
      'New conversation',
      'Chat history',
    ]);

    buttons.forEach(button => button.click());

    expect(requestNewTab).toHaveBeenCalledTimes(1);
    expect(requestNewConversation).toHaveBeenCalledTimes(1);
    expect(toggleHistoryDropdown).toHaveBeenCalledTimes(1);
  });







  it('promotes an open provisional session when it is pinned without opening closed sessions', async () => {
    const openTab = {
      conversationId: 'open-conversation',
      lifecycleState: 'provisional',
    };
    const setConversationPinned = jest.fn().mockResolvedValue(undefined);
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: { setConversationPinned },
      tabManager: { getAllTabs: jest.fn().mockReturnValue([openTab]) },
    });

    await view.setConversationPinned('open-conversation', true);
    await view.setConversationPinned('open-conversation', false);
    await view.setConversationPinned('closed-conversation', true);

    expect(setConversationPinned).toHaveBeenNthCalledWith(1, 'open-conversation', true);
    expect(setConversationPinned).toHaveBeenNthCalledWith(2, 'open-conversation', false);
    expect(setConversationPinned).toHaveBeenNthCalledWith(3, 'closed-conversation', true);
    expect(openTab.lifecycleState).toBe('cold');
    expect(view.tabManager.getAllTabs).toHaveBeenCalledTimes(2);
  });

  it('closes every open idle container before archiving a session', async () => {
    const localTab = {
      id: 'local-tab',
      conversationId: 'conversation-1',
      state: { isStreaming: false },
    };
    const otherTab = {
      id: 'other-tab',
      conversationId: 'conversation-1',
      state: { isStreaming: false },
    };
    const localManager = {
      closeTab: jest.fn().mockResolvedValue(true),
      getAllTabs: jest.fn().mockReturnValue([localTab]),
    };
    const otherManager = {
      closeTab: jest.fn().mockResolvedValue(true),
      getAllTabs: jest.fn().mockReturnValue([otherTab]),
    };
    const otherView = { getTabManager: jest.fn().mockReturnValue(otherManager) };
    const setConversationArchived = jest.fn().mockResolvedValue(undefined);
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: {
        getAllViews: jest.fn().mockReturnValue([view, otherView]),
        setConversationArchived,
      },
      tabManager: localManager,
    });
    view.getTabManager = jest.fn().mockReturnValue(localManager);

    await view.setConversationArchived('conversation-1', true);

    expect(localManager.closeTab).toHaveBeenCalledWith('local-tab');
    expect(otherManager.closeTab).toHaveBeenCalledWith('other-tab');
    expect(setConversationArchived).toHaveBeenCalledWith('conversation-1', true);
    expect(localManager.closeTab.mock.invocationCallOrder[0])
      .toBeLessThan(setConversationArchived.mock.invocationCallOrder[0]);
  });

  it('does not archive a running session', async () => {
    const runningTab = {
      id: 'running-tab',
      conversationId: 'conversation-1',
      state: { isStreaming: true },
    };
    const manager = {
      closeTab: jest.fn().mockResolvedValue(true),
      getAllTabs: jest.fn().mockReturnValue([runningTab]),
    };
    const setConversationArchived = jest.fn().mockResolvedValue(undefined);
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: {
        getAllViews: jest.fn().mockReturnValue([view]),
        setConversationArchived,
      },
      tabManager: manager,
    });
    view.getTabManager = jest.fn().mockReturnValue(manager);

    await view.setConversationArchived('conversation-1', true);

    expect(manager.closeTab).not.toHaveBeenCalled();
    expect(setConversationArchived).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith('Running sessions cannot be archived');
  });

  it('restores an archived session without opening a container', async () => {
    const setConversationArchived = jest.fn().mockResolvedValue(undefined);
    const manager = {
      closeTab: jest.fn(),
      getAllTabs: jest.fn().mockReturnValue([]),
      openConversation: jest.fn(),
    };
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: { setConversationArchived },
      tabManager: manager,
    });

    await view.setConversationArchived('conversation-1', false);

    expect(setConversationArchived).toHaveBeenCalledWith('conversation-1', false);
    expect(manager.closeTab).not.toHaveBeenCalled();
    expect(manager.openConversation).not.toHaveBeenCalled();
  });








  it('projects local and cross-view runtime attention into session status', () => {
    const activeTab = {
      conversationId: 'active',
      id: 'tab-active',
      state: {
        attention: { kind: 'action-required', since: 20 },
        isStreaming: true,
      },
    };
    const localTab = {
      conversationId: 'local',
      id: 'tab-local',
      state: {
        attention: { kind: 'review', since: 10 },
        isStreaming: false,
      },
    };
    const crossViewTab = {
      state: {
        attention: { kind: 'review', since: 5 },
        isStreaming: false,
      },
    };
    const otherView = {
      getTabManager: () => ({ getTab: () => crossViewTab }),
    };
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = {
      getActiveTab: () => activeTab,
      getAllTabs: () => [activeTab, localTab],
    };
    view.plugin = {
      findConversationAcrossViews: (id: string) => id === 'cross'
        ? { tabId: 'tab-cross', view: otherView }
        : null,
    };

    expect(view.getHistoryConversationStatus('active').attention)
      .toEqual({ kind: 'action-required', since: 20 });
    expect(view.getHistoryConversationStatus('local').attention)
      .toEqual({ kind: 'review', since: 10 });
    expect(view.getHistoryConversationStatus('cross').attention)
      .toEqual({ kind: 'review', since: 5 });
    expect(view.getHistoryConversationStatus('closed').attention).toBeUndefined();
  });

  it('updates local history and notifies other open views when runtime session navigation changes', () => {
    const otherView = { notifyConversationListChanged: jest.fn() };
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: { getAllViews: jest.fn().mockReturnValue([view, otherView]) },
      updateHistoryDropdown: jest.fn(),
    });

    view.notifyConversationNavigationChanged();

    expect(view.updateHistoryDropdown).toHaveBeenCalledTimes(1);
    expect(otherView.notifyConversationListChanged).toHaveBeenCalledTimes(1);
  });



  it('refreshes runtime status immediately in every view even while another tab is active', () => {
    const otherView = { refreshConversationRuntimeState: jest.fn() };
    const clearTimeout = jest.fn();
    const ownerWindow = { clearTimeout } as unknown as Window;
    const activeTab = {
      state: { isStreaming: true },
      session: { hasBackgroundWork: false },
    };
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: { getAllViews: jest.fn().mockReturnValue([view, otherView]) },
      tabManager: { getAllTabs: jest.fn().mockReturnValue([activeTab]) },
      updateConversationHeaders: jest.fn(),
      refreshWelcomeHomeSurface: jest.fn(),
      historyDropdownDirty: false,
      pendingHistorySurfaceUpdate: { kind: 'timeout', id: 42, ownerWindow },
    });
    const updateHistoryDropdown = jest.spyOn(view, 'updateHistoryDropdown');

    view.notifyConversationRuntimeStateChanged();

    expect(view.updateConversationHeaders).toHaveBeenCalledTimes(1);
    expect(view.refreshWelcomeHomeSurface).toHaveBeenCalledTimes(1);
    expect(updateHistoryDropdown).toHaveBeenCalledTimes(1);
    expect(view.historyDropdownDirty).toBe(true);
    expect(clearTimeout).toHaveBeenCalledWith(42);
    expect(view.pendingHistorySurfaceUpdate).toBeNull();
    expect(otherView.refreshConversationRuntimeState).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeated conversation-list notifications into one delayed update', () => {
    const setTimeout = jest.fn((_callback: () => void) => 1);
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      containerEl: { ownerDocument: { defaultView: { setTimeout } } },
      pendingHistorySurfaceUpdate: null,
      updateHistoryDropdown: jest.fn(),
    });

    view.notifyConversationListChanged();
    view.notifyConversationListChanged();

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 200);
    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(view.updateHistoryDropdown).not.toHaveBeenCalled();

    const scheduledCallback = setTimeout.mock.calls[0]?.[0] as () => void;
    scheduledCallback();

    expect(view.updateHistoryDropdown).toHaveBeenCalledTimes(1);
    expect(view.pendingHistorySurfaceUpdate).toBeNull();
  });

  it('refreshes the active home conversation list immediately', () => {
    const welcomeEl = {} as HTMLElement;
    const activeTab = {
      state: { messages: [] },
      dom: { welcomeEl },
    };
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      tabManager: { getActiveTab: jest.fn().mockReturnValue(activeTab) },
      updateConversationHeaders: jest.fn(),
      hasActiveStreamingOrBackgroundWork: jest.fn().mockReturnValue(false),
      scheduleHistorySurfaceUpdate: jest.fn(),
    });

    view.notifyConversationListChanged();

    expect(mockRefreshWelcomeContent).toHaveBeenCalledWith(welcomeEl);
  });

  it('exposes live running state for conversations open in another local tab', () => {
    const tab = {
      conversationId: 'conversation-1',
      state: { isStreaming: true },
    };
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: { findConversationAcrossViews: jest.fn().mockReturnValue(null) },
      tabManager: { getAllTabs: () => [tab] },
    });

    const homeOptions = view.getWelcomeHomeOptions();

    expect(homeOptions.isConversationRunning('conversation-1')).toBe(true);
    tab.state.isStreaming = false;
    expect(homeOptions.isConversationRunning('conversation-1')).toBe(false);
    expect(homeOptions.isConversationRunning('another-conversation')).toBe(false);
  });

  it('exposes live running state for conversations open in another view', () => {
    const otherTab = { state: { isStreaming: true } };
    const otherView = {
      getTabManager: () => ({ getTab: () => otherTab }),
    };
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: {
        findConversationAcrossViews: jest.fn().mockReturnValue({
          view: otherView,
          tabId: 'other-tab',
        }),
      },
      tabManager: { getAllTabs: () => [] },
    });

    const homeOptions = view.getWelcomeHomeOptions();

    expect(homeOptions.isConversationRunning('conversation-1')).toBe(true);
    otherTab.state.isStreaming = false;
    expect(homeOptions.isConversationRunning('conversation-1')).toBe(false);
  });

  it('defers history-surface rendering while a tab has active stream work', () => {
    const setTimeout = jest.fn((_callback: () => void) => 1);
    const activeTab = {
      state: { isStreaming: true },
      session: { hasBackgroundWork: false },
    };
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      containerEl: { ownerDocument: { defaultView: { setTimeout } } },
      tabManager: { getAllTabs: () => [activeTab] },
      pendingHistorySurfaceUpdate: null,
      historyDropdownDirty: false,
      updateHistoryDropdown: jest.fn(),
    });

    view.notifyConversationListChanged();

    expect(view.historyDropdownDirty).toBe(true);
    expect(setTimeout).not.toHaveBeenCalled();
    expect(view.updateHistoryDropdown).not.toHaveBeenCalled();

    activeTab.state.isStreaming = false;
    view.notifyConversationListChanged();

    expect(setTimeout).toHaveBeenCalledTimes(1);
  });

  it('refreshes the active conversation header when title changes during streaming', () => {
    const updateConversationHeader = jest.fn();
    const activeTab = {
      id: 'tab-1',
      conversationId: 'conversation-1',
      state: { isStreaming: true },
      session: { hasBackgroundWork: false },
      dom: { updateConversationHeader },
    };
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      plugin: {
        getConversationSync: jest.fn().mockReturnValue({ title: 'Generated title' }),
      },
      tabManager: { getAllTabs: () => [activeTab] },
      containerEl: { ownerDocument: { defaultView: { setTimeout: jest.fn() } } },
      pendingHistorySurfaceUpdate: null,
      historyDropdownDirty: false,
      updateHistoryDropdown: jest.fn(),
    });

    view.notifyConversationListChanged();

    expect(updateConversationHeader).toHaveBeenCalledWith(
      'Generated title',
      false,
      'conversation-1',
    );
  });







  it('opens a history selection in another tab while the active conversation is streaming', async () => {
    const openConversation = jest.fn().mockResolvedValue(undefined);
    const historyDropdown = createMockEl();
    historyDropdown.addClass('visible');
    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      historyDropdown,
      tabManager: {
        getActiveTab: jest.fn().mockReturnValue({ state: { isStreaming: true } }),
        openConversation,
      },
      cancelHistoryRendering: jest.fn(),
    });

    await view.openHistoryConversation('history-target');

    expect(openConversation).toHaveBeenCalledWith('history-target', { preferNewTab: true });
    expect(historyDropdown.hasClass('visible')).toBe(false);
    expect(view.cancelHistoryRendering).toHaveBeenCalledTimes(1);
  });





});

describe('ClaudianView runtime tab initialization', () => {
  it('creates one fresh runtime tab when no current tab was persisted', async () => {
    let tabManagerCallbacks: any;
    const createTab = jest.fn().mockResolvedValue({});
    mockTabManagerConstructor.mockReset();
    mockTabManagerConstructor.mockImplementation(
      (_plugin, _containerEl, _view, callbacks) => {
        tabManagerCallbacks = callbacks;
        return {
          createTab,
          discardProvisionalTabs: jest.fn().mockResolvedValue(undefined),
          getAllTabs: jest.fn().mockReturnValue([]),
        };
      },
    );

    const view = Object.create(ClaudianView.prototype) as any;
    Object.assign(view, {
      attachNavRowContentToInputFooter: jest.fn(),
      buildInputFooter: jest.fn(),
      buildNavRowContent: jest.fn().mockReturnValue(createMockEl()),
      containerEl: createMockEl(),
      contentEl: createMockEl(),
      plugin: {
        storage: {
          getTabManagerState: jest.fn().mockResolvedValue(null),
        },
      },
      syncProviderBrandColor: jest.fn(),
      notifyConversationNavigationChanged: jest.fn(),
      updateTabBar: jest.fn(),
      updateInputLocation: jest.fn(),
      updateTabBarVisibility: jest.fn(),
      wireEventHandlers: jest.fn(),
    });

    await view.onOpenImpl();

    expect(createTab).toHaveBeenCalledTimes(1);
    expect(tabManagerCallbacks).not.toHaveProperty('onPersistedStateChanged');

    tabManagerCallbacks.onTabAttentionChanged('tab-1', { kind: 'review', since: 1 });

    expect(view.updateTabBar).toHaveBeenCalledTimes(1);
    expect(view.notifyConversationNavigationChanged).toHaveBeenCalledTimes(1);
  });
});

describe('ClaudianView current tab persistence', () => {
  it('serializes only the active tab identity without draft state', () => {
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        conversationId: 'conversation-2',
        draftModel: 'ignored-draft-model',
        id: 'tab-2',
      }),
    };

    expect(view.getPersistedCurrentTabState()).toEqual({
      activeTabId: 'tab-2',
      openTabs: [{ conversationId: 'conversation-2', tabId: 'tab-2' }],
    });
  });

  it('restores only the active entry from an older multi-tab snapshot', async () => {
    const view = Object.create(ClaudianView.prototype) as any;
    const createTab = jest.fn().mockResolvedValue({});
    view.plugin = {
      storage: {
        getTabManagerState: jest.fn().mockResolvedValue({
          activeTabId: 'tab-2',
          openTabs: [
            { conversationId: 'conversation-1', tabId: 'tab-1' },
            { conversationId: 'conversation-2', tabId: 'tab-2' },
          ],
        }),
      },
    };
    view.tabManager = { createTab };

    await view.restoreCurrentTab();

    expect(createTab).toHaveBeenCalledTimes(1);
    expect(createTab).toHaveBeenCalledWith('conversation-2', 'tab-2');
  });

  it('restores an unbound current tab as empty and ignores its legacy draft', async () => {
    const view = Object.create(ClaudianView.prototype) as any;
    const createTab = jest.fn().mockResolvedValue({});
    view.plugin = {
      storage: {
        getTabManagerState: jest.fn().mockResolvedValue({
          activeTabId: 'tab-1',
          openTabs: [{
            conversationId: null,
            draftModel: 'do-not-restore',
            tabId: 'tab-1',
          }],
        }),
      },
    };
    view.tabManager = { createTab };

    await view.restoreCurrentTab();

    expect(createTab).toHaveBeenCalledWith(null, 'tab-1');
  });
});

describe('ClaudianView composer input', () => {
  function createComposerHarness(existingContent: string): {
    inputEl: HTMLTextAreaElement;
    inputHandler: jest.Mock;
    view: any;
  } {
    const inputEl = createMockEl('textarea') as unknown as HTMLTextAreaElement;
    const inputHandler = jest.fn();
    inputEl.value = existingContent;
    inputEl.selectionStart = 0;
    inputEl.selectionEnd = 0;
    inputEl.focus = jest.fn();
    inputEl.addEventListener('input', inputHandler);

    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({ dom: { inputEl } }),
    };

    return { inputEl, inputHandler, view };
  }

  it('focuses the active composer', () => {
    const { inputEl, view } = createComposerHarness('');

    view.focusActiveInput();

    expect(inputEl.focus).toHaveBeenCalledTimes(1);
  });

  it('appends text after existing composer content', () => {
    const { inputEl, inputHandler, view } = createComposerHarness('Review this note');

    const appended = view.appendToActiveInput('@projects/plan.md ');

    expect(appended).toBe(true);
    expect(inputEl.value).toBe('Review this note @projects/plan.md ');
    expect(inputEl.selectionStart).toBe(inputEl.value.length);
    expect(inputEl.selectionEnd).toBe(inputEl.value.length);
    expect(inputHandler).toHaveBeenCalledTimes(1);
    expect(inputEl.focus).toHaveBeenCalledTimes(1);
  });

  it('does not add another separator when existing content ends in whitespace', () => {
    const { inputEl, view } = createComposerHarness('Review this note\n');

    view.appendToActiveInput('@projects/plan.md ');

    expect(inputEl.value).toBe('Review this note\n@projects/plan.md ');
  });

  it('returns false when there is no active composer', () => {
    const view = Object.create(ClaudianView.prototype) as any;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(null),
    };

    expect(view.appendToActiveInput('@projects/plan.md ')).toBe(false);
  });
});

describe('ClaudianView shutdown', () => {
  it('flushes the current tab identity before disposing view resources', async () => {
    const view = Object.create(ClaudianView.prototype) as any;
    const destroy = jest.fn().mockResolvedValue(undefined);
    const disposePersistence = jest.fn();
    const flushPersistence = jest.fn().mockResolvedValue(undefined);
    const updatePersistence = jest.fn();

    Object.assign(view, {
      cancelHistoryRendering: jest.fn(),
      eventRefs: [],
      mentionCacheCoordinator: {},
      plugin: { app: { vault: { offref: jest.fn() } } },
      restoreActiveInputToTabContent: jest.fn(),
      scope: {},
      tabManager: {
        destroy,
        getActiveTab: jest.fn().mockReturnValue({
          conversationId: 'conversation-1',
          id: 'tab-1',
        }),
      },
      tabStatePersistence: {
        dispose: disposePersistence,
        flush: flushPersistence,
        update: updatePersistence,
      },
    });

    await expect(view.onClose()).resolves.toBeUndefined();

    expect(view.restoreActiveInputToTabContent).toHaveBeenCalledTimes(1);
    expect(updatePersistence).toHaveBeenCalledWith({
      activeTabId: 'tab-1',
      openTabs: [{ conversationId: 'conversation-1', tabId: 'tab-1' }],
    });
    expect(flushPersistence).toHaveBeenCalledTimes(1);
    expect(disposePersistence).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(view.tabManager).toBeNull();
    expect(view.scope).toBeNull();
  });

  it('still disposes view resources when the current-tab flush fails', async () => {
    const view = Object.create(ClaudianView.prototype) as any;
    const destroy = jest.fn().mockResolvedValue(undefined);
    const disposePersistence = jest.fn();

    Object.assign(view, {
      cancelHistoryRendering: jest.fn(),
      eventRefs: [],
      mentionCacheCoordinator: {},
      pendingTabBarUpdate: null,
      plugin: { app: { vault: { offref: jest.fn() } } },
      restoreActiveInputToTabContent: jest.fn(),
      scope: {},
      tabBar: { destroy: jest.fn() },
      tabManager: {
        destroy,
        getActiveTab: jest.fn().mockReturnValue({
          conversationId: null,
          id: 'tab-1',
        }),
      },
      tabStatePersistence: {
        dispose: disposePersistence,
        flush: jest.fn().mockRejectedValue(new Error('disk full')),
        update: jest.fn(),
      },
    });

    await expect(view.onClose()).resolves.toBeUndefined();

    expect(disposePersistence).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(view.tabManager).toBeNull();
  });
});

describe('ClaudianView Escape handling', () => {
  beforeEach(() => {
    MockScope.instances.length = 0;
  });

  function createEscapeHarness(options: {
    isStreaming: boolean;
  }): {
    cancelInlineRename: jest.Mock;
    cancelStreaming: jest.Mock;
    eventRefs: unknown[];
    view: any;
  } {
    const cancelInlineRename = jest.fn().mockReturnValue(false);
    const cancelStreaming = jest.fn();
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(ClaudianView.prototype) as any;

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        metadataCache: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: options.isStreaming },
        controllers: {
          conversationController: { cancelInlineRename },
          inputController: { cancelStreaming },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
            handleActiveFileMetadataChanged: jest.fn(),
          },
        },
      }),
    };

    return { cancelInlineRename, cancelStreaming, eventRefs, view };
  }

  function createScopedSendHarness(options: {
    inputFocused: boolean;
  }): {
    inputEl: HTMLTextAreaElement;
    sendMessage: jest.Mock;
    view: any;
  } {
    const sendMessage = jest.fn();
    const inputEl = createMockEl('textarea') as unknown as HTMLTextAreaElement;
    Object.defineProperty(inputEl.ownerDocument, 'activeElement', {
      configurable: true,
      get: () => options.inputFocused ? inputEl : null,
    });
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(ClaudianView.prototype) as any;

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        metadataCache: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: false },
        dom: { inputEl },
        controllers: {
          inputController: { sendMessage },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
            handleActiveFileMetadataChanged: jest.fn(),
          },
        },
      }),
    };

    return { inputEl, sendMessage, view };
  }

  it('routes metadata cache refreshes to the active tab file context', () => {
    const { view } = createEscapeHarness({ isStreaming: false });
    view.wireEventHandlers();

    const cacheOn = view.plugin.app.metadataCache.on as jest.Mock;
    const changedHandler = cacheOn.mock.calls
      .find(([event]: unknown[]) => event === 'changed')?.[1] as (file: unknown) => void;
    const resolveHandler = cacheOn.mock.calls
      .find(([event]: unknown[]) => event === 'resolve')?.[1] as (file: unknown) => void;
    const resolvedHandler = cacheOn.mock.calls
      .find(([event]: unknown[]) => event === 'resolved')?.[1] as () => void;
    expect(changedHandler).toBeDefined();
    expect(resolveHandler).toBeDefined();
    expect(resolvedHandler).toBeDefined();

    const file = { path: 'Notes/Current.md' };
    changedHandler(file);
    resolveHandler(file);
    resolvedHandler();

    const { handleActiveFileMetadataChanged } = view.tabManager.getActiveTab().ui.fileContextManager;
    expect(handleActiveFileMetadataChanged).toHaveBeenNthCalledWith(1, file);
    expect(handleActiveFileMetadataChanged).toHaveBeenNthCalledWith(2, file);
    expect(handleActiveFileMetadataChanged).toHaveBeenNthCalledWith(3, null);
  });

  it('keeps the history menu open when clicking its search input', () => {
    const { view } = createEscapeHarness({ isStreaming: false });
    const searchInput = view.historyDropdown.createEl('input');
    view.historyDropdown.addClass('visible');

    view.wireEventHandlers();

    const documentClickHandler = view.registerDomEvent.mock.calls.find(
      ([, eventName]: unknown[]) => eventName === 'click',
    )?.[2] as ((event: MouseEvent) => void) | undefined;
    expect(documentClickHandler).toBeDefined();

    documentClickHandler?.({ target: searchInput } as unknown as MouseEvent);

    expect(view.historyDropdown.hasClass('visible')).toBe(true);
  });

  it('registers Escape on the Obsidian view scope instead of document keydown capture', () => {
    const { view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();

    expect(view.scope).toBeInstanceOf(Scope);
    expect(view.scope.parent).toBe(view.app.scope);
    expect(view.scope.register).toHaveBeenCalledWith([], 'Escape', expect.any(Function));
    expect(view.registerDomEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      'keydown',
      expect.any(Function),
      { capture: true }
    );
  });

  it('cancels streaming and consumes scoped Escape', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelStreaming).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('closes the history menu from the scoped Escape handler', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });
    view.historyDropdown.addClass('visible');

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(view.historyDropdown.hasClass('visible')).toBe(false);
    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('consumes scoped Escape without cancelling when not streaming', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: false });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('exits inline rename before handling other scoped Escape actions', () => {
    const { cancelInlineRename, cancelStreaming, view } = createEscapeHarness({
      isStreaming: true,
    });
    cancelInlineRename.mockReturnValue(true);
    view.closeSessionSearch = jest.fn();
    view.isSessionSearchActive = true;

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelInlineRename).toHaveBeenCalledTimes(1);
    expect(view.closeSessionSearch).not.toHaveBeenCalled();
    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });




  it('consumes already handled scoped Escape without cancelling again', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({
      key: 'Escape',
      isComposing: false,
      defaultPrevented: true,
    } as KeyboardEvent);

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('commits a provisional preview before cycling modes with Shift+Tab', () => {
    const { view } = createEscapeHarness({ isStreaming: false });
    const canCycle = jest.fn().mockReturnValue(true);
    const cycleMode = jest.fn().mockReturnValue(true);
    const activeTab = {
      conversationId: null,
      lifecycleState: 'provisional',
      providerId: 'claude',
      state: { prePlanPermissionMode: null },
      ui: { permissionToggle: { canCycle, cycleMode } },
    };
    view.tabManager.getActiveTab.mockReturnValue(activeTab);
    const preventDefault = jest.fn();

    view.wireEventHandlers();
    const keydownHandler = view.registerDomEvent.mock.calls.find(
      ([target, event]: [unknown, string]) => target === view.containerEl && event === 'keydown',
    )?.[2] as (event: KeyboardEvent) => void;
    keydownHandler({
      isComposing: false,
      key: 'Tab',
      preventDefault,
      shiftKey: true,
    } as unknown as KeyboardEvent);

    expect(activeTab.lifecycleState).toBe('cold');
    expect(canCycle).toHaveBeenCalledTimes(1);
    expect(cycleMode).toHaveBeenCalledWith(expect.any(Function));
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('leaves Shift+Tab navigation alone when the provider has no mode cycle', () => {
    const { view } = createEscapeHarness({ isStreaming: false });
    const canCycle = jest.fn().mockReturnValue(false);
    const cycleMode = jest.fn();
    const activeTab = {
      conversationId: null,
      lifecycleState: 'provisional',
      providerId: 'claude',
      state: { prePlanPermissionMode: null },
      ui: { permissionToggle: { canCycle, cycleMode } },
    };
    view.tabManager.getActiveTab.mockReturnValue(activeTab);
    const preventDefault = jest.fn();

    view.wireEventHandlers();
    const keydownHandler = view.registerDomEvent.mock.calls.find(
      ([target, event]: [unknown, string]) => target === view.containerEl && event === 'keydown',
    )?.[2] as (event: KeyboardEvent) => void;
    keydownHandler({
      isComposing: false,
      key: 'Tab',
      preventDefault,
      shiftKey: true,
    } as unknown as KeyboardEvent);

    expect(activeTab.lifecycleState).toBe('provisional');
    expect(cycleMode).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('sends from focused composer through scoped Mod+Enter', () => {
    Platform.isMacOS = true;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: true });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('ignores scoped Mod+Enter when composer is not focused', () => {
    Platform.isMacOS = true;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: false });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
