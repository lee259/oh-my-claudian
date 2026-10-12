import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { Conversation, ProviderId } from '../../../core/types';
import { getVaultPath } from '../../../utils/path';
import type { FeatureHost } from '../../FeatureHost';
import { ConversationController } from '../controllers/ConversationController';
import type { WelcomeHomeOptions } from '../rendering/WelcomeRenderer';
import { getTabProviderId } from './providerResolution';
import type { TabData } from './types';

export interface TabConversationControllerOptions {
  ensureExecutionInitialized: () => Promise<boolean>;
  getProviderId: () => ProviderId;
  getSelectedModel: () => string | null;
  onConversationBindingChanged: (conversation: Conversation | null) => Promise<void>;
  onNewConversation: () => void;
  onConversationActivated: () => void;
  getWelcomeHomeOptions?: () => WelcomeHomeOptions | undefined;
}

/**
 * Resolves the provider session backing a subagent transcript without warming
 * execution. Cold tabs after plugin reload retain this id on the conversation.
 */
export function resolveSubagentTranscriptSessionId(
  liveProviderSessionId: string | null | undefined,
  conversation: Conversation | null,
): string | null {
  if (liveProviderSessionId) return liveProviderSessionId;
  if (conversation?.sessionId) return conversation.sessionId;
  const providerSessionId = conversation?.providerState?.providerSessionId;
  return typeof providerSessionId === 'string' && providerSessionId.trim().length > 0
    ? providerSessionId
    : null;
}

/**
 * Assembles ConversationController against the tab runtime. Conversation
 * binding remains a hook because provider settings, command catalogs, and
 * execution sessions must change as one tab-owned transaction.
 */
export function createTabConversationController(
  tab: TabData,
  plugin: FeatureHost,
  options: TabConversationControllerOptions,
): ConversationController {
  const { state, services } = tab;
  const subagentHistoryService = ProviderRegistry.createSubagentHistoryService(
    plugin.providerHost,
    getTabProviderId(tab, plugin),
  );
  const loadSubagentConversation = subagentHistoryService?.loadConversation?.bind(
    subagentHistoryService,
  );
  const resolveSessionId = (): string | null => {
    const conversation = tab.conversationId
      ? plugin.getConversationSync(tab.conversationId)
      : null;
    return resolveSubagentTranscriptSessionId(
      tab.executionCoordinator?.snapshot?.providerSessionId,
      conversation,
    );
  };
  return new ConversationController(
    {
      plugin,
      state,
      renderer: tab.session.messagePresentation,
      subagentManager: services.subagentManager,
      getHistoryDropdown: () => null,
      getWelcomeEl: () => tab.session.presentation?.dom.welcomeEl ?? null,
      setWelcomeEl: (el) => { if (tab.session.presentation) tab.session.presentation.dom.welcomeEl = el; },
      getMessagesEl: () => tab.session.messagePresentation.messagesElement,
      getInputEl: () => tab.session.composer,
      restoreMessageToComposer: message => (
        tab.controllers.inputController!.restoreRewoundMessageToComposer(message)
      ),
      getMetadataContext: () => {
        tab.session.captureMetadataContext();
        return tab.session.context.snapshot;
      },
      getFileContextManager: () => tab.ui.fileContextManager,
      getImageContextManager: () => tab.ui.imageContextManager,
      getMcpServerSelector: () => tab.ui.mcpServerSelector,
      getExternalContextSelector: () => tab.ui.externalContextSelector,
      getScopePreview: () => tab.ui.scopePreview,
      clearQueuedMessage: () => tab.controllers.inputController?.clearQueuedMessage(),
      getTitleGenerationService: () => services.titleGenerationService,
      getStatusPanel: () => tab.ui.statusPanel,
      getExecutionCoordinator: () => tab.executionCoordinator,
      ensureExecutionInitialized: options.ensureExecutionInitialized,
      getProviderId: options.getProviderId,
      getWelcomeProviderSummary: () => {
        const providerId = getTabProviderId(tab, plugin);
        return {
          displayName: ProviderRegistry.getProviderDisplayName(providerId),
          capabilities: ProviderRegistry.getCapabilities(providerId),
        };
      },
      getWelcomeHomeOptions: options.getWelcomeHomeOptions,
      getSelectedModel: options.getSelectedModel,
      getInitialUsage: (providerId: ProviderId, model: string) => ProviderRegistry
        .getChatUIConfig(providerId)
        .getInitialUsage?.(model, plugin.settings) ?? null,
      dismissPendingInlinePrompts: () => tab.controllers.inputController?.dismissPendingApproval(),
      awaitBackgroundWork: () => tab.session.awaitBackgroundWork(),
      isDisposed: () => tab.lifecycleState === 'closing',
      ensureExecutionForConversation: options.onConversationBindingChanged,
      resolveTranscriptProviderSessionId: resolveSessionId,
      ...(loadSubagentConversation ? {
        loadSubagentConversation: async (request: {
          subagentId: string;
          providerSessionId?: string;
        }) => {
          const vaultPath = getVaultPath(plugin.app);
          if (!vaultPath) return null;
          // Prefer the session pinned when the transcript opened; fall back to
          // the live resolution for callers that do not pin.
          const providerSessionId = request.providerSessionId ?? resolveSessionId();
          if (!providerSessionId) return null;
          return loadSubagentConversation({
            providerSessionId,
            subagentId: request.subagentId,
            vaultPath,
          });
        },
      } : {}),
    },
    {
      onNewConversation: options.onNewConversation,
      onConversationLoaded: options.onConversationActivated,
      onConversationSwitched: options.onConversationActivated,
    },
  );
}
