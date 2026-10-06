import type {
  ProviderChatUIConfig,
  ProviderPermissionModeOption,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { OPENCODE_PROVIDER_ICON } from '../../../shared/icons';
import { maybeGetOpencodeWorkspaceServices } from '../app/OpencodeWorkspaceServices';
import { OpencodeMetadataService } from '../metadata/OpencodeMetadataService';
import {
  buildOpencodeBaseModels,
  decodeOpencodeModelId,
  encodeOpencodeModelId,
  isOpencodeModelSelectionId,
  OPENCODE_DEFAULT_THINKING_LEVEL,
  resolveOpencodeBaseModelRawId,
  resolveOpencodeDefaultThinkingLevel,
} from '../models';
import {
  isOpencodeBuildModeId,
  isOpencodePlanModeId,
  resolveOpencodePermissionMode,
} from '../modes';
import { getOpencodeProviderSettings, updateOpencodeProviderSettings } from '../settings';

const DEFAULT_CONTEXT_WINDOW = 200_000;
const OPENCODE_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Ask',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

export const opencodeChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const opencodeSettings = getOpencodeProviderSettings(settings);
    const applyAlias = (rawId: string, option: ProviderUIOption): ProviderUIOption => {
      const alias = opencodeSettings.modelAliases[rawId];
      return alias ? { ...option, label: alias } : option;
    };
    const discoveredModels = new Map(buildOpencodeBaseModels(opencodeSettings.discoveredModels).map((model) => [
      encodeOpencodeModelId(model.rawId),
      applyAlias(model.rawId, {
        description: model.description ?? 'ACP runtime',
        label: model.label,
        value: encodeOpencodeModelId(model.rawId),
      }),
    ]));
    const seenValues = new Set<string>();
    const options: ProviderUIOption[] = [];
    for (const rawModelId of [...opencodeSettings.visibleModels].reverse()) {
      const encodedModelId = encodeOpencodeModelId(rawModelId);
      const discoveredOption = discoveredModels.get(encodedModelId);
      if (discoveredOption) {
        pushOption(options, seenValues, encodedModelId, discoveredOption);
      }
    }

    return options;
  },

  getDefaultModel(settings: Record<string, unknown>): string | null {
    const opencodeSettings = getOpencodeProviderSettings(settings);
    const discoveredModelIds = new Set(
      buildOpencodeBaseModels(opencodeSettings.discoveredModels).map((model) => model.rawId),
    );
    const rawModelId = opencodeSettings.visibleModels.find((modelId) => discoveredModelIds.has(modelId));
    return rawModelId ? encodeOpencodeModelId(rawModelId) : null;
  },

  ownsModel(model: string): boolean {
    return isOpencodeModelSelectionId(model);
  },

  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean {
    return getOpencodeThinkingOptions(model, settings).length > 0;
  },

  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    return getOpencodeThinkingOptions(model, settings)
      .map((variant) => ({
        description: variant.description,
        label: variant.label,
        value: variant.value,
      }));
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeOpencodeModelId(model);
    if (!rawModelId) {
      return OPENCODE_DEFAULT_THINKING_LEVEL;
    }

    const opencodeSettings = getOpencodeProviderSettings(settings);
    const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, opencodeSettings.discoveredModels);
    return getDefaultThinkingLevelForModel(baseRawId, settings);
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isOpencodeModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeOpencodeModelId(model);
    if (!rawModelId) {
      settingsBag.effortLevel = OPENCODE_DEFAULT_THINKING_LEVEL;
      return;
    }

    const opencodeSettings = getOpencodeProviderSettings(settingsBag);
    const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, opencodeSettings.discoveredModels);
    settingsBag.model = encodeOpencodeModelId(baseRawId);
    settingsBag.effortLevel = getDefaultThinkingLevelForModel(baseRawId, settingsBag);
  },

  async prepareModelMetadata(model: string, _settings: Record<string, unknown>, context): Promise<void> {
    const rawModelId = decodeOpencodeModelId(model);
    if (!rawModelId) {
      return;
    }

    const opencodeSettings = getOpencodeProviderSettings(context.plugin.settings);
    const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, opencodeSettings.discoveredModels);
    if (baseRawId && opencodeSettings.thinkingOptionsByModel[baseRawId]) {
      return;
    }

    const workspaceService = maybeGetOpencodeWorkspaceServices()?.metadataService;
    const metadataService = workspaceService
      ?? new OpencodeMetadataService(context.plugin);
    try {
      await metadataService.warmModelMetadata(model);
    } catch {
      // Metadata warmup is opportunistic; the first real turn can still discover it.
    } finally {
      if (!workspaceService) await metadataService.dispose();
    }
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeOpencodeModelId(model);
    if (!rawModelId) {
      return;
    }

    const opencodeSettings = getOpencodeProviderSettings(settingsBag);
    const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, opencodeSettings.discoveredModels);
    const supportedValues = new Set(
      (opencodeSettings.thinkingOptionsByModel[baseRawId] ?? []).map((variant) => variant.value),
    );
    const nextPreferredThinkingByModel = {
      ...opencodeSettings.preferredThinkingByModel,
    };

    if (!value || value === OPENCODE_DEFAULT_THINKING_LEVEL || !supportedValues.has(value)) {
      delete nextPreferredThinkingByModel[baseRawId];
    } else {
      nextPreferredThinkingByModel[baseRawId] = value;
    }

    updateOpencodeProviderSettings(settingsBag, {
      preferredThinkingByModel: nextPreferredThinkingByModel,
    });
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeOpencodeModelId(model);
    if (!rawModelId) {
      return model;
    }

    const opencodeSettings = getOpencodeProviderSettings(settings);
    const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, opencodeSettings.discoveredModels);
    return encodeOpencodeModelId(baseRawId);
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return {
      ...OPENCODE_PERMISSION_MODE_TOGGLE,
      inactiveDescription: t('chat.composer.modeApprovalDescription'),
      inactiveIcon: 'hand',
      activeDescription: t('chat.composer.modeFullAccessDescription'),
      activeIcon: 'zap',
      activeIsDangerous: true,
      planDescription: t('chat.composer.modePlanGenericDescription'),
      planIcon: 'clipboard-list',
    };
  },

  getPermissionModeOptions(settings): ProviderPermissionModeOption[] {
    const opencodeSettings = getOpencodeProviderSettings(settings);
    return opencodeSettings.availableModes.map((mode) => {
      const builtin = getOpenCodeBuiltinModePresentation(mode.id);
      return {
        description: builtin?.description ?? mode.description ?? undefined,
        icon: isOpencodePlanModeId(mode.id) ? 'clipboard-list' : 'code',
        ...(isOpencodePlanModeId(mode.id) ? { isPlanMode: true } : {}),
        label: builtin?.label ?? mode.name,
        value: mode.id,
      };
    });
  },

  resolvePermissionModeOption(settings): string | null {
    const selectedMode = getOpencodeProviderSettings(settings).selectedMode;
    return getOpencodeProviderSettings(settings).availableModes.some(mode => mode.id === selectedMode)
      ? selectedMode
      : null;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    const opencodeSettings = getOpencodeProviderSettings(settings);
    if (isOpencodePlanModeId(opencodeSettings.selectedMode)) return 'plan';
    return resolveOpencodePermissionMode(opencodeSettings.selectedMode);
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const opencodeSettings = getOpencodeProviderSettings(settingsBag);
    if (!opencodeSettings.availableModes.some(mode => mode.id === value)) return;
    if (isOpencodePlanModeId(value)) settingsBag.permissionMode = 'plan';
    else if (settingsBag.permissionMode === 'plan') settingsBag.permissionMode = 'normal';
    updateOpencodeProviderSettings(settingsBag, { selectedMode: value });
  },

  getProviderIcon() {
    return OPENCODE_PROVIDER_ICON;
  },
};

function getDefaultThinkingLevelForModel(
  baseRawId: string,
  settings: Record<string, unknown>,
): string {
  const opencodeSettings = getOpencodeProviderSettings(settings);
  return resolveOpencodeDefaultThinkingLevel(
    opencodeSettings.thinkingOptionsByModel[baseRawId] ?? [],
    opencodeSettings.preferredThinkingByModel[baseRawId],
  );
}

function getOpencodeThinkingOptions(
  model: string,
  settings: Record<string, unknown>,
): ProviderReasoningOption[] {
  const rawModelId = decodeOpencodeModelId(model);
  if (!rawModelId) {
    return [];
  }

  const opencodeSettings = getOpencodeProviderSettings(settings);
  const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, opencodeSettings.discoveredModels);
  return opencodeSettings.thinkingOptionsByModel[baseRawId] ?? [];
}

function getOpenCodeBuiltinModePresentation(id: string): { description: string; label: string } | null {
  if (isOpencodePlanModeId(id)) {
    return {
      description: t('chat.composer.modeOpenCodePlanDescription'),
      label: t('chat.composer.plan'),
    };
  }
  if (isOpencodeBuildModeId(id)) {
    return {
      description: t('chat.composer.modeOpenCodeBuildDescription'),
      label: t('chat.composer.modeOpenCodeBuild'),
    };
  }
  return null;
}

function pushOption(
  target: ProviderUIOption[],
  seenValues: Set<string>,
  value: string,
  option: ProviderUIOption,
): void {
  if (seenValues.has(value)) {
    return;
  }

  seenValues.add(value);
  target.push(option);
}
