import { getRuntimeEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { ProviderUIOption } from '../../core/providers/types';
import {
  type ClaudeModelEnvType,
  getModelsFromEnvironment,
} from './env/claudeModelEnv';
import { getClaudeUserSettingsModelEnvironment } from './env/claudeUserSettingsEnv';
import { formatCustomModelLabel } from './modelLabels';
import { encodeClaudeModelSelectionId, toClaudeRuntimeModelId } from './modelSelection';
import { isClaudeModelTier } from './modelTiers';
import { getClaudeProviderSettings } from './settings';
import { DEFAULT_CLAUDE_MODELS, normalizeLegacyClaudeModelAlias } from './types/models';

export interface ClaudeModelOption extends ProviderUIOption {
  environmentTypes?: readonly ClaudeModelEnvType[];
}

function parseConfiguredCustomModelIds(value: string): string[] {
  const modelIds: string[] = [];
  const seen = new Set<string>();

  for (const line of value.split(/\r?\n/)) {
    const modelId = line.trim();
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    modelIds.push(modelId);
  }

  return modelIds;
}

function normalizeCustomModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const aliases: Record<string, string> = {};
  for (const [rawModelId, rawAlias] of Object.entries(value)) {
    if (typeof rawAlias !== 'string') {
      continue;
    }

    const modelId = rawModelId.trim();
    const alias = rawAlias.trim();
    if (modelId && alias) {
      aliases[modelId] = alias;
    }
  }

  return aliases;
}

export function getClaudeModelOptions(settings: Record<string, unknown>): ClaudeModelOption[] {
  const customModelAliases = normalizeCustomModelAliases(settings.customModelAliases);
  const userModelEnvironment = getClaudeUserSettingsModelEnvironment();
  const modelAliases = {
    ...userModelEnvironment.displayNames,
    ...customModelAliases,
  };
  const customModels = getModelsFromEnvironment(
    {
      ...userModelEnvironment.env,
      ...getRuntimeEnvironmentVariables(settings, 'claude'),
    },
    modelAliases,
  );
  const claudeSettings = getClaudeProviderSettings(settings);
  const discoveredModels = claudeSettings.discoveredModels;
  if (customModels.length > 0) {
    const settingsConfiguredModelIds = new Set(Object.values(userModelEnvironment.env));
    return customModels.map((model) => ({
      ...model,
      label: customModelAliases[toClaudeRuntimeModelId(model.value)]
        ?? userModelEnvironment.displayNames[model.value]
        ?? discoveredModels.find(discovered => (
          discovered.value === toClaudeRuntimeModelId(model.value)
          || discovered.resolvedModel === toClaudeRuntimeModelId(model.value)
        ))?.label
        ?? (settingsConfiguredModelIds.has(model.value) ? model.value : model.label),
      value: encodeClaudeModelSelectionId(model.value),
    }));
  }

  const models = DEFAULT_CLAUDE_MODELS.map(model => {
    const runtimeModel = toClaudeRuntimeModelId(model.value);
    const discovered = discoveredModels.find(candidate => (
      candidate.value === runtimeModel
      || candidate.resolvedModel === runtimeModel
      || normalizeLegacyClaudeModelAlias(candidate.value)
        === normalizeLegacyClaudeModelAlias(runtimeModel)
    ));
    return discovered
      ? { ...model, label: customModelAliases[runtimeModel] ?? discovered.label,
        description: discovered.description || model.description }
      : model;
  });

  const seenModelIds = new Set(models.map(model =>
    normalizeLegacyClaudeModelAlias(toClaudeRuntimeModelId(model.value))
  ));
  for (const discovered of discoveredModels) {
    const runtimeModel = toClaudeRuntimeModelId(discovered.value);
    const normalizedModelId = normalizeLegacyClaudeModelAlias(runtimeModel);
    if (seenModelIds.has(normalizedModelId)) continue;
    seenModelIds.add(normalizedModelId);
    models.push({
      value: encodeClaudeModelSelectionId(runtimeModel),
      label: customModelAliases[runtimeModel] ?? discovered.label,
      description: discovered.description || 'Claude Code model',
    });
  }

  for (const configuredModelId of parseConfiguredCustomModelIds(claudeSettings.customModels)) {
    const modelId = toClaudeRuntimeModelId(configuredModelId);
    const normalizedModelId = normalizeLegacyClaudeModelAlias(modelId);
    if (seenModelIds.has(normalizedModelId)) {
      continue;
    }

    seenModelIds.add(normalizedModelId);
    models.push({
      value: encodeClaudeModelSelectionId(modelId),
      label: customModelAliases[modelId] ?? formatCustomModelLabel(modelId),
      description: 'Custom model',
    });
  }

  return models;
}

export function findClaudeModelOption(
  modelOptions: readonly ClaudeModelOption[],
  model: string,
): ClaudeModelOption | undefined {
  const runtimeModel = toClaudeRuntimeModelId(model);
  const exactOption = modelOptions.find(option =>
    option.value === model || toClaudeRuntimeModelId(option.value) === runtimeModel
  );
  if (exactOption) {
    return exactOption;
  }

  const normalizedRuntimeModel = normalizeLegacyClaudeModelAlias(toClaudeRuntimeModelId(model));
  if (isClaudeModelTier(normalizedRuntimeModel)) {
    const tierOption = modelOptions.find(option =>
      option.environmentTypes?.includes(normalizedRuntimeModel)
    );
    if (tierOption) {
      return tierOption;
    }
  }

  return modelOptions.find(option =>
    normalizeLegacyClaudeModelAlias(toClaudeRuntimeModelId(option.value)) === normalizedRuntimeModel
  );
}

export function findClaudeModelOptionForEnvironmentType(
  modelOptions: readonly ClaudeModelOption[],
  environmentType: ClaudeModelEnvType,
): ClaudeModelOption | undefined {
  const environmentOption = modelOptions.find(option =>
    option.environmentTypes?.includes(environmentType)
  );
  if (environmentOption || environmentType === 'model') {
    return environmentOption;
  }

  return modelOptions.find(option =>
    !option.environmentTypes
    && normalizeLegacyClaudeModelAlias(toClaudeRuntimeModelId(option.value)) === environmentType
  );
}

export function resolveClaudeModelEnvironmentTypePreference(
  modelOptions: readonly ClaudeModelOption[],
  model: string,
  previousEnvironmentType: ClaudeModelEnvType | '' = '',
): ClaudeModelEnvType | null {
  const exactEnvironmentTypes = modelOptions.find(option => option.value === model)
    ?.environmentTypes;
  if (exactEnvironmentTypes) {
    if (
      previousEnvironmentType
      && exactEnvironmentTypes.includes(previousEnvironmentType)
    ) {
      return previousEnvironmentType;
    }
    return exactEnvironmentTypes.length === 1 ? exactEnvironmentTypes[0] : null;
  }

  const runtimeModel = toClaudeRuntimeModelId(model);
  const runtimeEnvironmentTypes = modelOptions.find(option =>
    toClaudeRuntimeModelId(option.value) === runtimeModel
  )?.environmentTypes;
  if (runtimeEnvironmentTypes) {
    if (
      previousEnvironmentType
      && runtimeEnvironmentTypes.includes(previousEnvironmentType)
    ) {
      return previousEnvironmentType;
    }
    return runtimeEnvironmentTypes.length === 1 ? runtimeEnvironmentTypes[0] : null;
  }

  const normalizedModel = normalizeLegacyClaudeModelAlias(runtimeModel);
  if (isClaudeModelTier(normalizedModel)) {
    return normalizedModel;
  }

  const environmentTypes = findClaudeModelOption(modelOptions, model)?.environmentTypes;
  if (!environmentTypes) {
    return null;
  }

  if (
    previousEnvironmentType
    && environmentTypes.includes(previousEnvironmentType)
  ) {
    return previousEnvironmentType;
  }

  return environmentTypes.length === 1 ? environmentTypes[0] : null;
}

export function resolveClaudeModelSelection(
  settings: Record<string, unknown>,
  currentModel: string,
  preferredEnvironmentType?: ClaudeModelEnvType,
): string | null {
  const modelOptions = getClaudeModelOptions(settings);
  if (preferredEnvironmentType) {
    const preferredOption = findClaudeModelOptionForEnvironmentType(
      modelOptions,
      preferredEnvironmentType,
    );
    if (preferredOption) {
      return preferredOption.value;
    }
  }

  if (currentModel) {
    const currentOption = findClaudeModelOption(modelOptions, currentModel);
    if (currentOption) {
      return currentOption.value;
    }
  }

  const lastModel = getClaudeProviderSettings(settings).lastModel;
  if (lastModel) {
    const lastOption = findClaudeModelOption(modelOptions, lastModel);
    if (lastOption) {
      return lastOption.value;
    }
  }

  return modelOptions[0]?.value ?? null;
}
