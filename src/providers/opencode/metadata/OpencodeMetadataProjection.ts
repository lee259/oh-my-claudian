import type { ProviderHost } from '@/core/providers/ProviderHost';
import type {
  AcpSessionConfigOption,
  AcpSessionModelState,
  AcpSessionModeState,
} from '@/providers/acp';
import {
  extractAcpSessionModelState,
  extractAcpSessionModeState,
  extractAcpSessionThoughtLevelState,
} from '@/providers/acp';

import {
  normalizeOpencodeDiscoveredModels,
  normalizeOpencodeModelVariants,
  resolveOpencodeBaseModelRawId,
} from '../models';
import { normalizeOpencodeAvailableModes } from '../modes';
import {
  getOpencodeProviderSettings,
  updateOpencodeProviderSettings,
} from '../settings';

export interface OpencodeMetadataProjectionInput {
  readonly configOptions?: AcpSessionConfigOption[] | null;
  readonly currentModeId?: string | null;
  readonly models?: AcpSessionModelState | null;
  readonly modes?: AcpSessionModeState | null;
  readonly selectedRawModelId?: string | null;
}

export async function projectOpencodeMetadata(
  plugin: ProviderHost,
  input: OpencodeMetadataProjectionInput,
  signal?: AbortSignal,
): Promise<boolean> {
  const modelState = extractAcpSessionModelState({
    configOptions: input.configOptions,
    models: input.models,
  });
  const discoveredModels = normalizeOpencodeDiscoveredModels(
    modelState.availableModels.map((model) => ({
      ...(model.description ? { description: model.description } : {}),
      label: model.name,
      rawId: model.id,
    })),
  );
  const modeState = extractAcpSessionModeState({
    configOptions: input.configOptions,
    modes: input.modes,
  });
  const availableModes = normalizeOpencodeAvailableModes(
    modeState.availableModes,
  );
  const thoughtState = extractAcpSessionThoughtLevelState({
    configOptions: input.configOptions,
  });
  const thinkingOptions = normalizeOpencodeModelVariants(
    thoughtState.availableLevels.map((level) => ({
      ...(level.description ? { description: level.description } : {}),
      label: level.name,
      value: level.id,
    })),
  );
  const current = getOpencodeProviderSettings(plugin.settings);
  const selectedMode = availableModes.some(mode => mode.id === current.selectedMode)
    ? current.selectedMode
    : [input.currentModeId, modeState.currentModeId]
      .find((modeId): modeId is string => Boolean(
        modeId && availableModes.some(mode => mode.id === modeId),
      ))
      ?? null;
  const rawModelId = input.selectedRawModelId
    ?? modelState.currentModelId
    ?? null;
  // Early startup snapshots can be empty. Keep the last usable catalog until a non-empty
  // replacement arrives, and do not publish a settings change when the projection is unchanged.
  const hasModels = discoveredModels.length > 0;
  const hasModes = availableModes.length > 0;
  const baseRawModelId = rawModelId
    ? resolveOpencodeBaseModelRawId(
      rawModelId,
      discoveredModels.length > 0 ? discoveredModels : current.discoveredModels,
    )
    : null;
  const nextThinking = { ...current.thinkingOptionsByModel };
  if (baseRawModelId && thinkingOptions.length > 0) {
    nextThinking[baseRawModelId] = thinkingOptions;
  }
  const modelsChanged = hasModels && !sameUnordered(discoveredModels, current.discoveredModels);
  const modesChanged = hasModes && !sameUnordered(availableModes, current.availableModes);
  const selectedModeChanged = selectedMode !== null && selectedMode !== current.selectedMode;
  const thinkingChanged = baseRawModelId !== null
    && thinkingOptions.length > 0
    && !sameJson(nextThinking, current.thinkingOptionsByModel);
  if (!modelsChanged && !modesChanged && !selectedModeChanged && !thinkingChanged) return false;

  signal?.throwIfAborted();
  await plugin.mutateSettings((settings) => {
    signal?.throwIfAborted();
    updateOpencodeProviderSettings(settings, {
      ...(modesChanged ? { availableModes } : {}),
      ...(selectedModeChanged && selectedMode ? { selectedMode } : {}),
      ...(modelsChanged ? { discoveredModels } : {}),
      ...(thinkingChanged
        ? { thinkingOptionsByModel: nextThinking }
        : {}),
    });
  });
  plugin.notifyProviderChatOptionsChanged('opencode');
  return true;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function sameUnordered(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  const serialize = (values: readonly unknown[]) => values.map(stableStringify).sort();
  return sameJson(serialize(left), serialize(right));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
