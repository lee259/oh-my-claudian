import type { ProviderConversationHistoryService } from '../../../core/providers/types';

export class DshConversationHistoryService implements ProviderConversationHistoryService {
  hydrateConversationHistory(): Promise<void> { return Promise.resolve(); }
  resolveSessionIdForConversation(): string | null { return null; }
  isPendingForkConversation(): boolean { return false; }
  buildForkProviderState(): Record<string, unknown> { return {}; }
  buildPersistedProviderState(): Record<string, unknown> | undefined { return undefined; }
}
