import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';

export const dshSettingsReconciler: ProviderSettingsReconciler = {
  invalidateConversationSessions(conversations: Conversation[]): Conversation[] {
    return conversations.filter(conversation => conversation.providerId === 'dsh');
  },
  reconcileModelWithEnvironment: () => ({ changed: false, invalidatedConversations: [] }),
  normalizeModelVariantSettings: () => false,
};
