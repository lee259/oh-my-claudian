import { setIcon } from 'obsidian';
import { h } from 'preact';

import {
  resolveNewConversationModel,
} from '../../../core/providers/conversationModel';
import { getEnabledProviderForModel } from '../../../core/providers/modelRouting';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { createPreactRoot } from '../../../shared/ui/PreactRoot';
import { createWelcomeElement } from '../rendering/WelcomeRenderer';
import { SubagentManager } from '../services/SubagentManager';
import { ChatState } from '../state/ChatState';
import { ConversationHeaderView } from '../ui/ConversationHeaderView';
import { TabSession } from './TabSession';
import type { TabCreateOptions, TabData, TabDOMElements } from './types';
import { generateTabId } from './types';

export interface TabRuntimeFactoryHooks {
  onStreamingStateChanged?: (tab: TabData, isStreaming: boolean) => void;
}

/**
 * Owns allocation of the provider-neutral runtime shell for one tab.
 * Provider execution, controllers, and feature UI are initialized separately.
 */
export function createTabRuntime(
  options: TabCreateOptions,
  hooks: TabRuntimeFactoryHooks = {},
): TabData {
  const {
    plugin,
    containerEl,
    conversation,
    tabId,
    onStreamingChanged,
    onWorkChanged,
    onRewindingChanged,
    onAttentionChanged,
    onConversationIdChanged,
  } = options;

  const id = tabId ?? generateTabId();
  const contentEl = containerEl.createDiv({ cls: 'claudian-tab-content claudian-hidden' });
  const state = new ChatState({
    onStreamingStateChanged: onStreamingChanged,
    onRewindingStateChanged: onRewindingChanged,
    onAttentionChanged,
    onConversationChanged: onConversationIdChanged,
  });
  const subagentManager = new SubagentManager(() => {});
  const isBound = !!conversation?.id;
  const dom = buildTabDOM(
    contentEl,
    options.getWelcomeHomeOptions,
    conversation?.title ?? '聊天',
    !isBound && state.messages.length === 0,
  );
  state.queueIndicatorEl = dom.queueIndicatorEl;

  const restoredDraftModel = typeof options.draftModel === 'string'
    ? options.draftModel.trim()
    : '';
  const newConversationModel = !isBound && !restoredDraftModel
    ? resolveNewConversationModel(plugin.settings)
    : null;
  const draftModel = isBound
    ? null
    : (restoredDraftModel || newConversationModel?.model || null);
  const initialProviderId = conversation?.providerId
    ?? newConversationModel?.providerId
    ?? (draftModel
      ? getEnabledProviderForModel(draftModel, plugin.settings)
      : DEFAULT_CHAT_PROVIDER_ID);
  const session = new TabSession({
    id,
    lifecycleState: options.lifecycleState ?? 'cold',
    draftModel,
    providerId: initialProviderId,
    conversationId: conversation?.id ?? null,
  }, onWorkChanged);
  const tab: TabData = {
    session,
    get id() { return session.id; },
    get lifecycleState() { return session.lifecycleState; },
    set lifecycleState(value) { session.lifecycleState = value; },
    hydrationState: isBound ? 'idle' : 'ready',
    get draftModel() { return session.draftModel; },
    set draftModel(value) { session.draftModel = value; },
    get providerId() { return session.providerId; },
    set providerId(value) { session.providerId = value; },
    get conversationId() { return session.conversationId; },
    set conversationId(value) { session.conversationId = value; },
    get executionCoordinator() { return session.executionCoordinator; },
    set executionCoordinator(coordinator) { session.setExecutionCoordinator(coordinator); },
    providerCatalogResolver: null,
    captureReviewableSettlement: options.captureReviewableSettlement ?? null,
    state,
    controllers: {
      selectionController: null,
      browserSelectionController: null,
      canvasSelectionController: null,
      conversationController: null,
      streamController: null,
      inputController: null,
      navigationController: null,
    },
    services: {
      subagentManager,
      instructionRefineService: null,
      titleGenerationService: null,
    },
    ui: {
      contextTray: null,
      scopePreview: null,
      fileContextManager: null,
      imageContextManager: null,
      modelSelector: null,
      modeSelector: null,
      thinkingBudgetSelector: null,
      externalContextSelector: null,
      mcpServerSelector: null,
      permissionToggle: null,
      serviceTierToggle: null,
      refreshComposerLocale: null,
      slashCommandDropdown: null,
      instructionModeManager: null,
      bangBashModeManager: null,
      contextUsageMeter: null,
      statusPanel: null,
      navigationSidebar: null,
      promptSuggestion: null,
    },
    dom,
    renderer: null,
  };

  state.callbacks = {
    ...state.callbacks,
    onStreamingStateChanged: (isStreaming) => {
      onStreamingChanged?.(isStreaming);
      hooks.onStreamingStateChanged?.(tab, isStreaming);
    },
  };
  return tab;
}

function buildTabDOM(
  contentEl: HTMLElement,
  getWelcomeHomeOptions?: TabCreateOptions['getWelcomeHomeOptions'],
  conversationTitle = t('chat.home.title'),
  isHome = false,
): TabDOMElements {
  const homeOptions = getWelcomeHomeOptions?.();
  const conversationHeaderHostEl = contentEl.createDiv({
    cls: 'claudian-conversation-header-host',
  });
  const conversationHeaderRoot = createPreactRoot(conversationHeaderHostEl);
  const updateConversationHeader = (title: string, showHomeHeader = false): void => {
    conversationHeaderRoot.render(h(ConversationHeaderView, {
      title,
      isHome: showHomeHeader,
      onBack: homeOptions?.onBack,
      onOpenHistory: homeOptions?.onOpenHistory,
      onOpenSettings: homeOptions?.onOpenSettings,
      onNewConversation: homeOptions?.onNewConversation,
    }));
  };
  updateConversationHeader(conversationTitle, isHome);

  const messagesWrapperEl = contentEl.createDiv({ cls: 'claudian-messages-wrapper' });
  const messagesEl = messagesWrapperEl.createDiv({ cls: 'claudian-messages' });
  const welcomeEl = createWelcomeElement(messagesEl, undefined, undefined, homeOptions);
  const statusPanelContainerEl = contentEl.createDiv({ cls: 'claudian-status-panel-container' });
  const inputComposerEl = contentEl.createDiv({ cls: 'claudian-input-composer' });
  const inputContainerEl = inputComposerEl.createDiv({ cls: 'claudian-input-container' });
  const queueIndicatorEl = inputContainerEl.createDiv({ cls: 'claudian-input-queue-row' });
  const navRowEl = inputContainerEl.createDiv({ cls: 'claudian-input-nav-row' });
  const inputWrapper = inputContainerEl.createDiv({ cls: 'claudian-input-wrapper' });
  const contextRowEl = inputWrapper.createDiv({ cls: 'claudian-context-row' });
  const inputEditorEl = inputWrapper.createDiv({ cls: 'claudian-input-editor' });
  const inputMentionHighlightsEl = inputEditorEl.createDiv({
    cls: 'claudian-input-mention-highlights claudian-input-mention-highlights--empty',
    attr: { 'aria-hidden': 'true' },
  });
  const inputEl = inputEditorEl.createEl('textarea', {
    cls: 'claudian-input',
    attr: {
      placeholder: 'Ask to make changes, @mention files, run /commands',
      rows: '3',
      dir: 'auto',
    },
  });
  const sendButtonEl = inputWrapper.createEl('button', {
    cls: 'claudian-input-send-button',
    attr: {
      type: 'button',
      'aria-label': 'Send message',
      title: 'Send message (enter)',
    },
  });
  setIcon(sendButtonEl, 'arrow-up');

  return {
    contentEl,
    messagesEl,
    welcomeEl,
    conversationHeaderRoot,
    updateConversationHeader,
    statusPanelContainerEl,
    inputComposerEl,
    inputContainerEl,
    queueIndicatorEl,
    inputWrapper,
    inputMentionHighlightsEl,
    inputEl,
    sendButtonEl,
    navRowEl,
    contextRowEl,
    eventCleanups: [],
  };
}
