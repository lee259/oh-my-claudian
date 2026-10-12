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
import { ConversationRuntime } from '../sessions/ConversationRuntime';
import { createEmptyPresentationUI } from '../sessions/RuntimePresentation';
import { ConversationHeaderView } from '../ui/ConversationHeaderView';
import type { TabCreateOptions, TabData, TabDOMElements } from './types';
import { generateTabId } from './types';

export interface TabRuntimeFactoryHooks {
  onStreamingStateChanged?: (tab: TabData, isStreaming: boolean) => void;
}

export function createConversationRuntime(options: Pick<TabCreateOptions, 'plugin' | 'conversation' | 'tabId' | 'draftModel' | 'lifecycleState'>): ConversationRuntime {
  const { plugin, conversation, tabId } = options;
  const id = tabId ?? generateTabId();
  const isBound = !!conversation?.id;
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
  const runtime = new ConversationRuntime({
    id, lifecycleState: options.lifecycleState ?? 'cold', draftModel,
    providerId: initialProviderId, conversationId: conversation?.id ?? null,
  });
  if (conversation) runtime.context.capture({
    currentNote: conversation.currentNote, externalContextPaths: conversation.externalContextPaths ?? [],
    enabledMcpServers: conversation.enabledMcpServers ?? [],
  });
  return runtime;
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
    containerEl,
    conversation,
    onStreamingChanged,
    onWorkChanged,
    onRewindingChanged,
    onAttentionChanged,
    onConversationIdChanged,
  } = options;

  const session = options.runtime ?? createConversationRuntime(options);
  if (session.presentation) throw new Error('The conversation runtime is already presented.');
  const state = session.state;
  const presentationEpoch = Symbol('runtime-presentation');
  const contentEl = containerEl.createDiv({ cls: 'claudian-tab-content claudian-hidden' });
  const dom = buildTabDOM(contentEl, options.getWelcomeHomeOptions, conversation?.title ?? '聊天',
    !session.conversationId && state.messages.length === 0, session.conversationId);
  state.queueIndicatorEl = dom.queueIndicatorEl;
  const tab: TabData = {
    session,
    presentationEpoch,
    get id() { return session.id; },
    get lifecycleState() { return session.lifecycleState; },
    set lifecycleState(value) { session.lifecycleState = value; },
    get hydrationState() { return session.hydrationState; },
    set hydrationState(value) { session.hydrationState = value; },
    get draftModel() { return session.draftModel; },
    set draftModel(value) { session.draftModel = value; },
    get providerId() { return session.providerId; },
    set providerId(value) { session.providerId = value; },
    get conversationId() { return session.conversationId; },
    set conversationId(value) { session.conversationId = value; },
    get executionCoordinator() { return session.executionCoordinator; },
    set executionCoordinator(coordinator) { session.setExecutionCoordinator(coordinator); },
    get providerCatalogResolver() { return session.presentation?.hooks?.getProviderCatalog ?? null; },
    set providerCatalogResolver(value) {
      if (session.presentation) {
        session.presentation.hooks ??= {};
        session.presentation.hooks.getProviderCatalog = value ?? undefined;
      }
    },
    get captureReviewableSettlement() { return session.presentation?.captureReviewableSettlement ?? (outcome => session.captureReviewableSettlement(outcome)); },
    state,
    controllers: {
      get selectionController() { return session.presentation?.controllers.selectionController ?? null; },
      set selectionController(value) { if (session.presentation) session.presentation.controllers.selectionController = value; },
      get browserSelectionController() { return session.presentation?.controllers.browserSelectionController ?? null; },
      set browserSelectionController(value) { if (session.presentation) session.presentation.controllers.browserSelectionController = value; },
      get canvasSelectionController() { return session.presentation?.controllers.canvasSelectionController ?? null; },
      set canvasSelectionController(value) { if (session.presentation) session.presentation.controllers.canvasSelectionController = value; },
      get navigationController() { return session.presentation?.controllers.navigationController ?? null; },
      set navigationController(value) { if (session.presentation) session.presentation.controllers.navigationController = value; },
      get conversationController() { return session.controllers.conversationController; },
      set conversationController(value) { session.controllers.conversationController = value; },
      get streamController() { return session.controllers.streamController; },
      set streamController(value) { session.controllers.streamController = value; },
      get inputController() { return session.controllers.inputController; },
      set inputController(value) { session.controllers.inputController = value; },
    },
    services: session.services,
    get ui() { return session.presentation?.ui ?? session.emptyUI; },
    get dom() {
      if (!session.presentation) throw new Error('The conversation runtime has no presentation.');
      return session.presentation.dom;
    },
    get renderer() { return session.presentation?.renderer ?? null; },
    set renderer(value) { if (session.presentation) session.presentation.renderer = value; },
  };

  session.presentation = {
    epoch: presentationEpoch,
    isActive: options.isActive,
    getActivationRevision: options.getActivationRevision,
    captureReviewableSettlement: options.captureReviewableSettlement,
    dom, ui: createEmptyPresentationUI(), renderer: null, viewHost: null,
    controllers: { selectionController: null, browserSelectionController: null, canvasSelectionController: null, navigationController: null },
  };

  dom.eventCleanups.push(session.bindPresentationCallbacks('host', {
    onWorkChanged,
    onRewindingStateChanged: onRewindingChanged,
    onAttentionChanged,
    onConversationChanged: onConversationIdChanged,
    onStreamingStateChanged: (isStreaming) => {
      onStreamingChanged?.(isStreaming);
      hooks.onStreamingStateChanged?.(tab, isStreaming);
    },
  }));
  return tab;
}

function buildTabDOM(
  contentEl: HTMLElement,
  getWelcomeHomeOptions?: TabCreateOptions['getWelcomeHomeOptions'],
  conversationTitle = t('chat.home.title'),
  isHome = false,
  conversationId: string | null = null,
): TabDOMElements {
  const homeOptions = getWelcomeHomeOptions?.();
  const conversationHeaderHostEl = contentEl.createDiv({
    cls: 'claudian-conversation-header-host',
  });
  const conversationHeaderRoot = createPreactRoot(conversationHeaderHostEl);
  const updateConversationHeader = (
    title: string,
    showHomeHeader = false,
    currentConversationId: string | null = conversationId,
  ): void => {
    conversationHeaderRoot.render(h(ConversationHeaderView, {
      title,
      isHome: showHomeHeader,
      onBack: homeOptions?.onBack,
      onOpenHistory: homeOptions?.onOpenHistory,
      onOpenSettings: homeOptions?.onOpenSettings,
      onNewConversation: homeOptions?.onNewConversation,
      onRenameConversation: currentConversationId && homeOptions?.onRequestRenameConversation
        ? () => homeOptions.onRequestRenameConversation?.(currentConversationId, title)
        : undefined,
      onArchiveConversation: currentConversationId && homeOptions?.onArchiveConversation
        ? () => homeOptions.onArchiveConversation?.(currentConversationId)
        : undefined,
      isRunning: currentConversationId
        ? homeOptions?.isConversationRunning?.(currentConversationId) ?? false
        : undefined,
    }));
  };
  updateConversationHeader(conversationTitle, isHome, conversationId);

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
