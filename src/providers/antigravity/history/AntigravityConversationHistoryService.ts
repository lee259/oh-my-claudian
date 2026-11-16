import { mergePersistedProviderState } from '../../../core/providers/providerState';
import type {
  ProviderConversationHistoryService,
  ProviderHistoryPathContext,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import {
  ANTIGRAVITY_PROVIDER_STATE_KEYS,
  buildPersistedAntigravityProviderState,
  parseAntigravityProviderState,
} from '../types';
import { resolveAntigravityStoreRoot } from './AntigravityHistoryPaths';
import {
  loadAntigravityHistory,
  readAntigravityHistoryRevision,
} from './AntigravityHistoryStore';

export class AntigravityConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<void> {
    const state = parseAntigravityProviderState(conversation.providerState);
    const sessionId = conversation.sessionId ?? state.historySessionId;
    const storeRoot = pathContext
      ? resolveAntigravityStoreRoot(pathContext.environment, pathContext.hostPlatform)
      : null;
    if (!sessionId || !storeRoot) return;
    const messages = await loadAntigravityHistory(storeRoot, sessionId);
    if (messages.length === 0) return;
    conversation.messages = messages;
    if (conversation.sessionId && state.nativeConversationContextEstablished === false) {
      conversation.providerState = mergePersistedProviderState(
        conversation.providerState,
        ANTIGRAVITY_PROVIDER_STATE_KEYS,
        buildPersistedAntigravityProviderState({
          ...state,
          nativeConversationContextEstablished: true,
        }) as Record<string, unknown> | undefined,
      );
    }
  }

  async readNativeHistoryRevision(
    conversation: Conversation,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<string | null> {
    if (!conversation.sessionId || !pathContext) return null;
    const storeRoot = resolveAntigravityStoreRoot(
      pathContext.environment,
      pathContext.hostPlatform,
    );
    return storeRoot
      ? readAntigravityHistoryRevision(storeRoot, conversation.sessionId)
      : null;
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(): boolean {
    return false;
  }

  buildForkProviderState(): Record<string, unknown> {
    throw new Error('Antigravity does not support forking conversations.');
  }

  buildPersistedProviderState(conversation: Conversation): Record<string, unknown> | undefined {
    return mergePersistedProviderState(
      conversation.providerState,
      ANTIGRAVITY_PROVIDER_STATE_KEYS,
      buildPersistedAntigravityProviderState(
        parseAntigravityProviderState(conversation.providerState),
      ) as Record<string, unknown> | undefined,
    );
  }
}
