import type {
  ProviderChatUIConfig,
  ProviderPermissionModeOption,
  ProviderPermissionModeToggleConfig,
} from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { CURSOR_PROVIDER_ICON } from '../../../shared/icons';
import { buildInitialCursorUsageInfo } from '../execution/CursorExecutionSession';
import { CursorModelDiscoveryService } from '../metadata/CursorModelDiscoveryService';
import {
  decodeCursorModelId,
  encodeCursorModelId,
  getCursorModelReasoning,
} from '../models';
import { getCursorProviderSettings, updateCursorProviderSettings } from '../settings';

export const cursorChatUIConfig: ProviderChatUIConfig = {
  getProviderIcon() {
    return CURSOR_PROVIDER_ICON;
  },
  getModelOptions(settings) {
    const provider = getCursorProviderSettings(settings);
    const discovered = new Map(provider.discoveredModels.map(model => [model.rawId, model]));
    return [...provider.visibleModels].reverse().flatMap(rawId => {
      const model = discovered.get(rawId);
      return model ? [{
        description: model.description ?? 'Cursor ACP runtime',
        label: model.label,
        value: encodeCursorModelId(rawId),
      }] : [];
    });
  },
  getDefaultModel: settings => {
    const rawId = getCursorProviderSettings(settings).visibleModels[0];
    return rawId ? encodeCursorModelId(rawId) : null;
  },
  ownsModel: model => decodeCursorModelId(model) !== null,
  isAdaptiveReasoningModel: (model, settings) => getModelReasoning(model, settings) !== undefined,
  getReasoningOptions: (model, settings) => getModelReasoning(model, settings)?.options ?? [],
  getDefaultReasoningValue: (model, settings) => getModelReasoning(model, settings)?.currentValue ?? 'default',
  async prepareModelMetadata(model, _settings, { plugin }) {
    const rawId = decodeCursorModelId(model);
    const selected = getCursorProviderSettings(plugin.settings).discoveredModels.find(entry => entry.rawId === rawId);
    if (!selected || selected.reasoning !== undefined) return;
    try {
      const catalog = await new CursorModelDiscoveryService(plugin).discoverCatalog();
      await plugin.mutateSettings(settings => {
        const current = getCursorProviderSettings(settings);
        const discoveredModels = current.discoveredModels.map(entry => {
          const metadata = catalog.models.find(model => model.rawId.split('[')[0] === entry.rawId.split('[')[0]);
          return metadata?.reasoning !== undefined ? { ...entry, reasoning: metadata.reasoning } : entry;
        });
        updateCursorProviderSettings(settings, { discoveredModels, catalogTimestamp: Date.now() });
      });
    } catch {
      // Older/offline runtimes keep their cached catalog usable.
    }
  },
  getInitialUsage(model) {
    return buildInitialCursorUsageInfo(decodeCursorModelId(model) ?? undefined);
  },
  getContextWindowSize: () => 200_000,
  isDefaultModel: model => decodeCursorModelId(model) !== null,
  applyModelDefaults(model, settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    const target = settings as Record<string, unknown>;
    target.effortLevel = getModelReasoning(model, target)?.currentValue ?? 'default';
  },
  applyModelProjectionDefaults: () => undefined,
  normalizeModelVariant: model => model,
  getCustomModelIds: () => new Set<string>(),
  getPermissionModeToggle: (): ProviderPermissionModeToggleConfig => ({
    inactiveValue: 'normal',
    inactiveLabel: t('settings.cursor.agent'),
    inactiveDescription: t('chat.composer.modeAgentDescription'),
    inactiveIcon: 'code',
    activeValue: 'ask',
    activeLabel: t('settings.cursor.ask'),
    activeDescription: t('chat.composer.modeAskDescription'),
    activeIcon: 'message-circle-question',
    activeIsDangerous: false,
    planValue: 'plan',
    planLabel: t('settings.cursor.plan'),
    planDescription: t('chat.composer.modePlanGenericDescription'),
    planIcon: 'clipboard-list',
  }),
  getPermissionModeOptions: (): ProviderPermissionModeOption[] => ([
    {
      value: 'normal',
      label: t('settings.cursor.agent'),
      description: t('chat.composer.modeAgentDescription'),
      icon: 'code',
    },
    {
      value: 'ask',
      label: t('settings.cursor.ask'),
      description: t('chat.composer.modeAskDescription'),
      icon: 'message-circle-question',
    },
    {
      value: 'plan',
      label: t('settings.cursor.plan'),
      description: t('chat.composer.modePlanGenericDescription'),
      icon: 'clipboard-list',
      isPlanMode: true,
    },
  ]),
  resolvePermissionMode(settings) {
    return settings.permissionMode === 'plan' || settings.permissionMode === 'ask'
      ? settings.permissionMode
      : 'normal';
  },
  applyPermissionMode(value, settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    const target = settings as Record<string, unknown>;
    target.permissionMode = value === 'plan' || value === 'ask' ? value : 'normal';
  },
};

function getModelReasoning(model: string, settings: Record<string, unknown>) {
  const rawId = decodeCursorModelId(model);
  return rawId ? getCursorModelReasoning(rawId, getCursorProviderSettings(settings).discoveredModels) : undefined;
}
