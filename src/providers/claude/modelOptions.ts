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
import {
  CLAUDE_MODEL_TIER_DEFINITIONS,
  type ClaudeModelTier,
  isClaudeModelTier,
} from './modelTiers';
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
  const customModels = getModelsFromEnvironment(
    {
      ...userModelEnvironment.env,
      ...getRuntimeEnvironmentVariables(settings, 'claude'),
    },
    customModelAliases,
  );
  const claudeSettings = getClaudeProviderSettings(settings);
  const discoveredModels = claudeSettings.discoveredModels;
  if (customModels.length > 0) {
    const tierTargets = new Map<string, ClaudeModelTier[]>();
    for (const [tier, modelId] of Object.entries(userModelEnvironment.env)) {
      const definition = CLAUDE_MODEL_TIER_DEFINITIONS.find(
        candidate => candidate.environmentKey === tier,
      );
      if (!definition || !modelId) {
        continue;
      }
      const tiers = tierTargets.get(modelId) ?? [];
      tiers.push(definition.id);
      tierTargets.set(modelId, tiers);
    }
    const sharedTierTargets = new Map<string, ClaudeModelTier[]>();
    for (const [modelId, tiers] of tierTargets) {
      if (tiers.length > 1) {
        sharedTierTargets.set(modelId, tiers);
      }
    }
    const options: ClaudeModelOption[] = [];
    for (const model of customModels) {
      const sharedTiers = sharedTierTargets.get(model.value);
      if (sharedTiers) {
        for (const tier of sharedTiers) {
          const definition = CLAUDE_MODEL_TIER_DEFINITIONS.find(candidate => candidate.id === tier);
          if (!definition) {
            continue;
          }
          const discovered = findDiscoveredFamilyModel(discoveredModels, tier);
          options.push({
            value: encodeClaudeModelSelectionId(tier),
            label: customModelAliases[tier]
              ?? customModelAliases[model.value]
              ?? discoveredModels.find(candidate => candidate.value === model.value)?.label
              ?? model.value,
            description: discovered?.description || `${model.description} (${tier})`,
            environmentTypes: [tier],
          });
        }
        continue;
      }

      options.push({
        ...model,
        label: customModelAliases[toClaudeRuntimeModelId(model.value)]
          ?? discoveredModels.find(discovered => discovered.value === model.value)?.label
          ?? discoveredModels.find(discovered => (
            model.environmentTypes?.some(type => type === discovered.value)
          ))?.label
          ?? discoveredModels.find(discovered => (
            discovered.value !== 'default' && discovered.resolvedModel === model.value
          ))?.label
          ?? model.label,
        value: encodeClaudeModelSelectionId(model.value),
      });
    }

    const seenModelIds = new Set(options.map(option =>
      normalizeLegacyClaudeModelAlias(toClaudeRuntimeModelId(option.value))
    ));
    const visibleModelIds = claudeSettings.visibleModels?.map(toClaudeRuntimeModelId) ?? null;
    for (const discovered of discoveredModels) {
      const modelId = toClaudeRuntimeModelId(discovered.value);
      const discoveredIdentities = [modelId, discovered.resolvedModel]
        .filter((identity): identity is string => Boolean(identity))
        .map(toClaudeRuntimeModelId);
      const isVisible = visibleModelIds === null || visibleModelIds.some(visibleId =>
        discoveredIdentities.includes(visibleId)
        || findDiscoveredFamilyModel(discoveredModels, visibleId)?.value === discovered.value
      );
      if (!isVisible) {
        continue;
      }

      const normalizedModelId = normalizeLegacyClaudeModelAlias(modelId);
      if (seenModelIds.has(normalizedModelId)) {
        continue;
      }

      seenModelIds.add(normalizedModelId);
      options.push({
        value: encodeClaudeModelSelectionId(modelId),
        label: customModelAliases[modelId] ?? discovered.label,
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
      options.push({
        value: encodeClaudeModelSelectionId(modelId),
        label: customModelAliases[modelId] ?? formatCustomModelLabel(modelId),
        description: 'Custom model',
      });
    }

    return options;
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
