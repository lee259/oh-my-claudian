import type { ProviderChatUIConfig, ProviderId } from '../../../core/providers/types';

export interface TabReasoningSettingsSnapshot extends Record<string, unknown> {
  effortLevel: string;
  model: string;
  thinkingBudget: string;
}

export function resolveTabReasoningSettings<T extends TabReasoningSettingsSnapshot>(
  settings: T,
  providerId: ProviderId,
  selections: Map<string, string>,
  uiConfig: ProviderChatUIConfig,
): T {
  const key = `${providerId}:${settings.model}`;
  const adaptive = uiConfig.isAdaptiveReasoningModel(settings.model, settings);
  const options = uiConfig.getReasoningOptions(settings.model, settings);
  if (options.length === 0) return settings;

  const persistedSelection = adaptive ? settings.effortLevel : settings.thinkingBudget;
  const selected = selections.get(key) ?? persistedSelection;
  const reasoning = options.some(option => option.value === selected)
    ? selected
    : uiConfig.getDefaultReasoningValue(settings.model, settings);

  selections.set(key, reasoning);
  if (adaptive) settings.effortLevel = reasoning;
  else settings.thinkingBudget = reasoning;
  return settings;
}
