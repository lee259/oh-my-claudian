import type { ProviderChatUIConfig } from '../../../core/providers/types';
import { DSH_PROVIDER_ICON } from '../../../shared/icons';
import { buildInitialDshUsageInfo } from '../execution/DshExecutionSession';
import { decodeDshModelId, encodeDshModelId } from '../models';
import { getDshProviderSettings } from '../settings';

export const dshChatUIConfig: ProviderChatUIConfig = {
  getProviderIcon: () => DSH_PROVIDER_ICON,
  getModelOptions(settings) {
    const model = getDshProviderSettings(settings).model.trim();
    return model ? [{ description: 'DeepSeek Harness ACP model', label: model, value: encodeDshModelId(model) }] : [];
  },
  getDefaultModel: settings => {
    const model = getDshProviderSettings(settings).model.trim();
    return model ? encodeDshModelId(model) : null;
  },
  ownsModel: model => decodeDshModelId(model) !== null,
  isAdaptiveReasoningModel: () => false,
  getReasoningOptions: () => [],
  getDefaultReasoningValue: () => 'default',
  getInitialUsage: model => buildInitialDshUsageInfo(decodeDshModelId(model) ?? undefined),
  getContextWindowSize: () => 200_000,
  isDefaultModel: model => decodeDshModelId(model) !== null,
  applyModelDefaults: () => undefined,
  normalizeModelVariant: model => model,
  getCustomModelIds: () => new Set<string>(),
};
