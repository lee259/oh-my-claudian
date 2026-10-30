import type { ConversationInputRecord } from '@/core/bootstrap/ConversationInputLedgerStorage';
import type { ProviderConversationHistoryService, ProviderHistoryPathContext } from '@/core/providers/types';
import type { ChatMessage, Conversation } from '@/core/types';

import { loadHermesSessionMessages } from './HermesHistoryStore';

export class HermesConversationHistoryService implements ProviderConversationHistoryService {
  matchesLossyUserInput(message: ChatMessage, record: ConversationInputRecord): boolean {
    if (message.role !== 'user' || record.state !== 'accepted' || record.providerUserMessageId
      || record.images.length === 0 || (message.images?.length ?? 0) !== 0) return false;
    const normalize = (value: string) => value.replace(/\r\n?/g, '\n').normalize('NFC');
    const text = normalize(record.canonicalText);
    const expected = [text, ...record.images.map(() => '[screenshot]')].join('\n');
    return normalize(message.content) === expected;
  }

  async hydrateConversationHistory(conversation: Conversation, _vaultPath: string | null, context?: ProviderHistoryPathContext): Promise<void> {
    if (!conversation.sessionId || conversation.messages.length > 0) return;
    conversation.messages = await loadHermesSessionMessages(conversation.sessionId, context);
  }
  resolveSessionIdForConversation(conversation: Conversation | null): string | null { return conversation?.sessionId ?? null; }
  isPendingForkConversation(): boolean { return false; }
  buildForkProviderState(): Record<string, unknown> { return {}; }
  buildPersistedProviderState(conversation: Conversation): Record<string, unknown> | undefined { return conversation.providerState; }
}
