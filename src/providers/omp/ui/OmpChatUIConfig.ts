import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
} from '../../../core/providers/types';
import { decodeOmpModelId, encodeOmpModelId } from '../models';
import { getOmpProviderSettings } from '../settings';

const PERMISSION_MODE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Read-only',
  activeValue: 'yolo',
  activeLabel: 'All tools',
};

export const ompChatUIConfig: ProviderChatUIConfig = {
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
  isAdaptiveReasoningModel: () => false,
  getReasoningOptions: () => [{ label: 'Default', value: 'default' }],
  getDefaultReasoningValue: () => 'default',
  getContextWindowSize: (_model, customLimits) => customLimits?.omp ?? 200_000,
  isDefaultModel: model => decodeOmpModelId(model) !== null,
  applyModelDefaults: () => undefined,
  normalizeModelVariant: model => model,
  getCustomModelIds: () => new Set<string>(),
  getPermissionModeToggle: (): ProviderPermissionModeToggleConfig => PERMISSION_MODE,
};
