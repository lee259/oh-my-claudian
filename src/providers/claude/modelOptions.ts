import { getRuntimeEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { ProviderUIOption } from '../../core/providers/types';
import {
  type ClaudeModelEnvType,
  getModelsFromEnvironment,
} from './env/claudeModelEnv';
import { getClaudeUserSettingsModelEnvironment } from './env/claudeUserSettingsEnv';
import type { ClaudeDiscoveredModel } from './modelCatalog';
import { formatCustomModelLabel } from './modelLabels';
import { encodeClaudeModelSelectionId, toClaudeRuntimeModelId } from './modelSelection';
import { isClaudeModelTier } from './modelTiers';
import { getClaudeProviderSettings } from './settings';
import { DEFAULT_CLAUDE_MODELS, normalizeLegacyClaudeModelAlias } from './types/models';

export interface ClaudeModelOption extends ProviderUIOption {
  environmentTypes?: readonly ClaudeModelEnvType[];
  resolvedFromCatalog?: boolean;
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

interface ParsedClaudeModelFamily {
  tier: string;
  version: number[];
  oneMillion: boolean;
}

function parseClaudeModelFamily(model: string): ParsedClaudeModelFamily | undefined {
  const runtimeModel = toClaudeRuntimeModelId(model).trim().toLowerCase();
  const oneMillion = runtimeModel.endsWith('[1m]');
  const baseModel = oneMillion ? runtimeModel.slice(0, -'[1m]'.length) : runtimeModel;
  const match = /^(?:claude-)?(haiku|sonnet|opus|fable)(?:-(\d+(?:-\d+)*))?$/.exec(baseModel);
  if (!match) return undefined;

  const components = match[2]?.split('-') ?? [];
  if (components.at(-1)?.length === 8) components.pop();
  return {
    tier: match[1],
    version: components.map(Number),
    oneMillion,
  };
}

function compareClaudeVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Resolve a family selection to an identity currently reported by Claude's SDK. */
function findDiscoveredFamilyModel(
  discoveredModels: readonly ClaudeDiscoveredModel[],
  model: string,
): ClaudeDiscoveredModel | undefined {
  const runtimeModel = toClaudeRuntimeModelId(model);
  const exact = discoveredModels.find(candidate => candidate.value === runtimeModel);
  if (exact) return exact;

  const wanted = parseClaudeModelFamily(runtimeModel);
  if (!wanted) return undefined;

  const candidates = discoveredModels.flatMap(candidate => {
    const identities = [candidate.resolvedModel, candidate.value]
      .filter((identity): identity is string => Boolean(identity))
      .map(parseClaudeModelFamily)
      .filter((identity): identity is ParsedClaudeModelFamily => identity?.tier === wanted.tier);
    if (identities.length === 0) return [];
    const versioned = identities.find(identity => identity.version.length > 0);
    return [{
      candidate,
      identity: versioned ?? identities[0],
    }];
  });

  return candidates.reduce<typeof candidates[number] | undefined>((best, current) => {
    if (!best) return current;
    const versionOrder = compareClaudeVersions(current.identity.version, best.identity.version);
    if (versionOrder > 0) return current;
    if (versionOrder === 0 && best.identity.oneMillion && !current.identity.oneMillion) {
      return current;
    }
    return best;
  }, undefined)?.candidate;
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
    const discovered = findDiscoveredFamilyModel(discoveredModels, runtimeModel);
    return discovered
      ? {
        ...model,
        value: discovered.value === runtimeModel
          ? model.value
          : encodeClaudeModelSelectionId(discovered.value),
        resolvedFromCatalog: discovered.value !== runtimeModel,
        label: customModelAliases[runtimeModel] ?? discovered.label,
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

  const aliasOption = modelOptions.find(option =>
    normalizeLegacyClaudeModelAlias(toClaudeRuntimeModelId(option.value)) === normalizedRuntimeModel
  );
  if (aliasOption) return aliasOption;

  const requestedFamily = parseClaudeModelFamily(runtimeModel);
  return requestedFamily
    ? modelOptions.find(option =>
      option.resolvedFromCatalog
      && parseClaudeModelFamily(option.value)?.tier === requestedFamily.tier
    )
    : undefined;
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
