import type { ProviderConversationHistoryService } from '@/core/providers/types';
import type { Conversation } from '@/core/types';

export class CursorConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(): Promise<void> {
    // Cursor sessions resume through ACP. Native transcript replay is not part of the MVP.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(): boolean {
    return false;
  }

  buildForkProviderState(): Record<string, unknown> {
    return {};
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    return conversation.providerState;
  }
}
