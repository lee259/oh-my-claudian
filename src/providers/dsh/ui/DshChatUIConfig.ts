import type { ProviderChatUIConfig } from '../../../core/providers/types';
import { DSH_PROVIDER_ICON } from '../../../shared/icons';
import { decodeDshModelId, encodeDshModelId } from '../models';
import { getDshProviderSettings } from '../settings';

export const dshChatUIConfig: ProviderChatUIConfig = {
  getProviderIcon: () => DSH_PROVIDER_ICON,
  getModelOptions(settings) {
    const provider = getDshProviderSettings(settings);
    const discovered = new Map(provider.discoveredModels.map(model => [model.rawId, model]));
    return [...provider.visibleModels].reverse().flatMap(rawId => {
      const model = discovered.get(rawId);
      return model ? [{
        ...(model.description ? { description: model.description } : {}),
        label: model.label,
        value: encodeDshModelId(rawId),
      }] : [];
    });
  },
  getDefaultModel: settings => {
    const rawId = getDshProviderSettings(settings).visibleModels[0];
    return rawId ? encodeDshModelId(rawId) : null;
  },
  ownsModel: model => decodeDshModelId(model) !== null,
  isAdaptiveReasoningModel: (_model, settings) => getDshProviderSettings(settings).reasoning !== null,
  getReasoningOptions: (_model, settings) => getDshProviderSettings(settings).reasoning?.options.map(option => ({
    ...(option.description ? { description: option.description } : {}),
    label: option.name,
    value: option.id,
  })) ?? [],
  getDefaultReasoningValue: (_model, settings) => getDshProviderSettings(settings).reasoning?.currentValue ?? 'high',
  resolvePermissionMode: () => 'normal',
  getContextWindowSize: (_model, customLimits) => customLimits?.dsh ?? 0,
  isDefaultModel: model => decodeDshModelId(model) !== null,
  applyModelDefaults: () => undefined,
  normalizeModelVariant: model => model,
  getCustomModelIds: () => new Set<string>(),
};
