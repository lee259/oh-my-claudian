import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { Conversation, ProviderId } from '../../../core/types';
import { getVaultPath } from '../../../utils/path';
import type { FeatureHost } from '../../FeatureHost';
import { ConversationController } from '../controllers/ConversationController';
import { getTabProviderId } from './providerResolution';
import type { TabData } from './types';

export interface TabConversationControllerOptions {
  ensureExecutionInitialized: () => Promise<boolean>;
  getProviderId: () => ProviderId;
  getSelectedModel: () => string | null;
  onConversationBindingChanged: (conversation: Conversation | null) => Promise<void>;
  onNewConversation: () => void;
  onConversationActivated: () => void;
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
  const { dom, state, services, ui } = tab;
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
      renderer: tab.renderer!,
      subagentManager: services.subagentManager,
      getHistoryDropdown: () => null,
      getWelcomeEl: () => dom.welcomeEl,
      setWelcomeEl: (el) => { dom.welcomeEl = el; },
      getMessagesEl: () => dom.messagesEl,
      getInputEl: () => dom.inputEl,
      restoreMessageToComposer: message => (
        tab.controllers.inputController!.restoreRewoundMessageToComposer(message)
      ),
      getFileContextManager: () => ui.fileContextManager,
      getImageContextManager: () => ui.imageContextManager,
      getMcpServerSelector: () => ui.mcpServerSelector,
      getExternalContextSelector: () => ui.externalContextSelector,
      getScopePreview: () => ui.scopePreview,
      clearQueuedMessage: () => tab.controllers.inputController?.clearQueuedMessage(),
      getTitleGenerationService: () => services.titleGenerationService,
      getStatusPanel: () => ui.statusPanel,
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
