import type { ProviderChatUIConfig } from '@/core/providers/types';
import { t } from '@/i18n/i18n';
import { HERMES_PROVIDER_ICON } from '@/shared/icons';

import { decodeHermesModelId, encodeHermesModelId } from '../models';
import { getHermesProviderSettings } from '../settings';

export const hermesChatUIConfig: ProviderChatUIConfig = {
  getProviderIcon: () => HERMES_PROVIDER_ICON,
  getModelOptions(settings) {
    const provider = getHermesProviderSettings(settings);
    const models = new Map(provider.discoveredModels.map(model => [model.rawId, model]));
    return provider.visibleModels.flatMap(id => {
      const model = models.get(id);
      return model && model.available !== false ? [{ value: encodeHermesModelId(id), label: model.label, description: model.description }] : [];
    });
  },
  getDefaultModel: settings => {
    const provider = getHermesProviderSettings(settings);
    const available = new Set(provider.discoveredModels.filter(model => model.available !== false).map(model => model.rawId));
    const selected = provider.visibleModels.find(id => available.has(id));
    return selected ? encodeHermesModelId(selected) : null;
  },
  ownsModel: model => decodeHermesModelId(model) !== null,
  isAdaptiveReasoningModel: () => false,
  getReasoningOptions: () => [],
  getDefaultReasoningValue: () => 'default',
  getContextWindowSize: () => 200_000,
  isDefaultModel: model => decodeHermesModelId(model) !== null,
  applyModelDefaults: () => undefined,
  normalizeModelVariant: model => model,
  getCustomModelIds: () => new Set<string>(),
  getPermissionModeToggle: () => ({
    inactiveValue: 'default', inactiveLabel: t('chat.composer.hermesModeDefault'), inactiveIcon: 'shield-check',
    activeValue: 'dont_ask', activeLabel: t('chat.composer.hermesModeDontAsk'), activeIcon: 'zap', activeIsDangerous: true,
    values: ['accept_edits'],
  }),
  getPermissionModeOptions: () => [
    { value: 'default', label: t('chat.composer.hermesModeDefault'), description: t('chat.composer.hermesModeDefaultDescription'), icon: 'shield-check' },
    { value: 'accept_edits', label: t('chat.composer.hermesModeAcceptEdits'), description: t('chat.composer.hermesModeAcceptEditsDescription'), icon: 'file-check' },
    { value: 'dont_ask', label: t('chat.composer.hermesModeDontAsk'), description: t('chat.composer.hermesModeDontAskDescription'), icon: 'zap', isDangerous: true },
  ],
  resolvePermissionMode: settings => ['default', 'accept_edits', 'dont_ask'].includes(String(settings.permissionMode)) ? String(settings.permissionMode) : 'default',
  applyPermissionMode(value, settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    (settings as Record<string, unknown>).permissionMode = ['default', 'accept_edits', 'dont_ask'].includes(value) ? value : 'default';
  },
};
