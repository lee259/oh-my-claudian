import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { ChatMessage, Conversation } from '../../../core/types';

const DSH_HISTORY_STATE_KEY = 'claudianTranscript';
const DSH_HISTORY_SCHEMA_VERSION = 1;

interface DshPersistedTranscript {
  schemaVersion: typeof DSH_HISTORY_SCHEMA_VERSION;
  messages: ChatMessage[];
}

export class DshConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(conversation: Conversation): Promise<void> {
    if (conversation.messages.length > 0) return;
    const transcript = readPersistedTranscript(conversation.providerState?.[DSH_HISTORY_STATE_KEY]);
    if (transcript) conversation.messages = transcript;
  }

  resolveSessionIdForConversation(conversation: { sessionId: string | null } | null): string | null {
    return conversation?.sessionId ?? null;
  }
  isPendingForkConversation(): boolean { return false; }
  buildForkProviderState(): Record<string, unknown> { return {}; }
  buildPersistedProviderState(conversation: Conversation): Record<string, unknown> | undefined {
    const providerState = { ...conversation.providerState };
    if (conversation.messages.length > 0) {
      providerState[DSH_HISTORY_STATE_KEY] = {
        messages: cloneMessages(conversation.messages),
        schemaVersion: DSH_HISTORY_SCHEMA_VERSION,
      } satisfies DshPersistedTranscript;
    }
    return Object.keys(providerState).length > 0 ? providerState : undefined;
  }
}

function readPersistedTranscript(value: unknown): ChatMessage[] | null {
  if (!isRecord(value) || value.schemaVersion !== DSH_HISTORY_SCHEMA_VERSION || !Array.isArray(value.messages)) {
    return null;
  }
  const messages = value.messages;
  if (!messages.every(isChatMessage)) return null;
  return cloneMessages(messages);
}

function cloneMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
    && typeof value.timestamp === 'number'
    && Number.isFinite(value.timestamp);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
