import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getHermesProviderSettings, updateHermesProviderSettings } from '../settings';

export function invalidateHermesModelCatalog(settings: Record<string, unknown>): boolean {
  const current = getHermesProviderSettings(settings);
  if (!current.discoveredModels.some(model => model.available !== false)) return false;
  updateHermesProviderSettings(settings, { discoveredModels: current.discoveredModels.map(model => ({ ...model, available: false })), catalogTimestamp: 0 });
  return true;
}

export const hermesSettingsReconciler: ProviderSettingsReconciler = {
  handleEnvironmentChange: invalidateHermesModelCatalog,
  invalidateConversationSessions(conversations: Conversation[]): Conversation[] {
    return conversations.filter(conversation => conversation.providerId === 'hermes');
  },

  reconcileModelWithEnvironment(settings, _conversations) {
    const current = getHermesProviderSettings(settings);
    if (!current.environmentHash) return { changed: false, invalidatedConversations: [] };
    updateHermesProviderSettings(settings, { environmentHash: current.environmentHash });
    return { changed: false, invalidatedConversations: [] };
  },

  normalizeModelVariantSettings(): boolean { return false; },
};
