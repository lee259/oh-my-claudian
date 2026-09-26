import type {
  ProviderChatUIConfig,
  ProviderPermissionModeOption,
  ProviderPermissionModeToggleConfig,
} from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { OMP_PROVIDER_ICON } from '../../../shared/icons';
import { buildInitialOmpUsageInfo } from '../execution/OmpExecutionSession';
import {
  decodeOmpModelId,
  encodeOmpModelId,
} from '../models';
import { getOmpProviderSettings } from '../settings';

export const ompChatUIConfig: ProviderChatUIConfig = {
  getProviderIcon() {
    return OMP_PROVIDER_ICON;
  },
  getModelOptions(settings) {
    const provider = getOmpProviderSettings(settings);
    const discovered = new Map(provider.discoveredModels.map(model => [model.rawId, model]));
    return [...provider.visibleModels].reverse().flatMap(rawId => {
      const model = discovered.get(rawId);
      return model ? [{
        description: model.description ?? 'OMP ACP runtime',
        label: model.label,
        value: encodeOmpModelId(rawId),
      }] : [];
    });
  },
  getDefaultModel: settings => {
    const rawId = getOmpProviderSettings(settings).visibleModels[0];
    return rawId ? encodeOmpModelId(rawId) : null;
  },
  ownsModel: model => decodeOmpModelId(model) !== null,
  isAdaptiveReasoningModel: (_model, settings) => getOmpProviderSettings(settings).thinking !== null,
  getReasoningOptions: (_model, settings) => getOmpProviderSettings(settings).thinking?.options.map(option => ({
    ...(option.description ? { description: option.description } : {}),
    label: option.name,
    value: option.id,
  })) ?? [],
  getDefaultReasoningValue: (_model, settings) => getOmpProviderSettings(settings).thinking?.currentValue ?? 'default',
  getInitialUsage(model) {
    return buildInitialOmpUsageInfo(decodeOmpModelId(model) ?? undefined);
  },
  getContextWindowSize: (_model, customLimits) => customLimits?.omp ?? 200_000,
  isDefaultModel: model => decodeOmpModelId(model) !== null,
  applyModelDefaults: () => undefined,
  normalizeModelVariant: model => model,
  getCustomModelIds: () => new Set<string>(),
  getPermissionModeToggle: (): ProviderPermissionModeToggleConfig => ({
    inactiveValue: 'always-ask',
    inactiveLabel: t('settings.omp.alwaysAsk'),
    inactiveDescription: t('chat.composer.modeApprovalDescription'),
    inactiveIcon: 'hand',
    activeValue: 'yolo',
    activeLabel: t('settings.omp.yolo'),
    activeDescription: t('chat.composer.modeFullAccessDescription'),
    activeIcon: 'zap',
    activeIsDangerous: true,
    values: ['always-ask', 'write', 'yolo'],
  }),
  getPermissionModeOptions: (): ProviderPermissionModeOption[] => ([
    {
      value: 'always-ask',
      label: t('settings.omp.alwaysAsk'),
      description: t('chat.composer.modeApprovalDescription'),
      icon: 'hand',
    },
    {
      value: 'write',
      label: t('settings.omp.write'),
      description: t('chat.composer.modeWriteApprovalDescription'),
      icon: 'file-pen-line',
    },
    {
      value: 'yolo',
      label: t('settings.omp.yolo'),
      description: t('chat.composer.modeFullAccessDescription'),
      icon: 'zap',
      isDangerous: true,
    },
  ]),
  resolvePermissionMode(settings) {
    return settings.permissionMode === 'yolo' || settings.permissionMode === 'write'
      ? settings.permissionMode
      : 'always-ask';
  },
  applyPermissionMode(value, settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    const target = settings as Record<string, unknown>;
    target.permissionMode = value === 'yolo' || value === 'write' ? value : 'always-ask';
  },
};
