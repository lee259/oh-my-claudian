import * as fs from 'node:fs';
import * as path from 'node:path';

import { Notice, Setting } from 'obsidian';

import { assessProviderReadiness } from '../../../core/providers/ProviderReadiness';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderSettingsTabRenderer,
  ProviderSettingsTabRendererContext,
} from '../../../core/providers/types';
import type { ClaudianSettings } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { ANTIGRAVITY_PROVIDER_ICON } from '../../../shared/icons';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { renderHostnameCliPathSetting } from '../../../shared/settings/HostnameCliPathSetting';
import { renderProviderEnablementSetting } from '../../../shared/settings/ProviderEnablementSetting';
import {
  renderLastEnabledProviderWarning,
  renderProviderModelEnablementWarning,
} from '../../../shared/settings/ProviderModelEnablementWarning';
import {
  type ProviderModelPickerModel,
  type ProviderModelPickerState,
  renderProviderModelPicker,
} from '../../../shared/settings/ProviderModelPicker';
import { renderProviderReadinessPanel } from '../../../shared/settings/ProviderReadinessPanel';
import { getHostnameKey } from '../../../utils/env';
import { normalizeConfiguredCliPath } from '../../../utils/path';
import type { AntigravityWorkspaceServices } from '../app/AntigravityWorkspaceServices';
import type { AntigravityModel } from '../models';
import {
  ANTIGRAVITY_PROVIDER_ID,
  getAntigravityProviderSettings,
  updateAntigravityProviderSettings,
} from '../settings';

const DISPLAY_NAME = 'Antigravity';

export const antigravitySettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const hostnameKey = getHostnameKey();
    const workspace = getAntigravityWorkspaceServices();

    const refreshModelCatalog = async (): Promise<'empty' | 'failed' | 'loaded'> => {
      const result = await workspace.refreshModelCatalog();
      if (result.diagnostics) {
        new Notice(t('settings.modelDiscoveryFailed', {
          provider: DISPLAY_NAME,
          error: result.diagnostics,
        }));
        return 'failed';
      }
      modelWarning.context.notifyProviderModelOptionsChanged(ANTIGRAVITY_PROVIDER_ID);
      return (getAntigravityProviderSettings(settingsBag).currentCatalog?.models.length ?? 0) > 0
        ? 'loaded'
        : 'empty';
    };

    const readinessPanel = renderProviderReadinessPanel({
      container,
      icon: ANTIGRAVITY_PROVIDER_ICON,
      providerName: DISPLAY_NAME,
      async getSnapshot() {
        const current = getAntigravityProviderSettings(settingsBag);
        const selected = current.visibleModels ?? current.currentCatalog?.models.map(model => model.rawId) ?? [];
        return assessProviderReadiness({
          cliAvailable: context.plugin.cliLifecycle?.getSnapshot(ANTIGRAVITY_PROVIDER_ID)
            ? context.plugin.cliLifecycle.getSnapshot(ANTIGRAVITY_PROVIDER_ID)?.status === 'ready'
            : undefined,
          cliPath: await context.plugin.getResolvedProviderCliPath(ANTIGRAVITY_PROVIDER_ID),
          discoveredModelCount: current.currentCatalog?.models.length ?? 0,
          enabled: current.enabled,
          selectedModelCount: selected.length,
        });
      },
      async onRefresh() {
        await refreshModelCatalog();
      },
    });
    const management = readinessPanel.management;

    renderProviderEnablementSetting({
      container: readinessPanel.enablement,
      description: t('settings.antigravity.enableDesc'),
      getValue: () => getAntigravityProviderSettings(settingsBag).enabled,
      name: t('settings.providerEnablement.name', { provider: DISPLAY_NAME }),
      onChange: async (enabled) => {
        if (!ProviderSettingsCoordinator.canApplyProviderEnablement(
          settingsBag,
          ANTIGRAVITY_PROVIDER_ID,
          enabled,
        )) {
          lastProviderWarning.showFor();
          return;
        }
        let accepted = true;
        await context.plugin.runProviderExecutionTransition(
          [ANTIGRAVITY_PROVIDER_ID],
          async () => context.plugin.mutateSettings((settings) => {
            accepted = ProviderSettingsCoordinator.applyProviderEnablement(
              settings,
              ANTIGRAVITY_PROVIDER_ID,
              enabled,
            );
          }),
        );
        if (accepted) lastProviderWarning.hide();
        else lastProviderWarning.showFor();
        modelWarning.context.notifyProviderModelOptionsChanged(ANTIGRAVITY_PROVIDER_ID);
        await readinessPanel.refresh();
      },
    });

    const lastProviderWarning = renderLastEnabledProviderWarning(management);
    const modelWarning = renderProviderModelEnablementWarning(management, context, {
      getHasEnabledModels: () => {
        const current = getAntigravityProviderSettings(settingsBag);
        return (current.visibleModels ?? current.currentCatalog?.models ?? []).length > 0;
      },
      getIsEnabled: () => getAntigravityProviderSettings(settingsBag).enabled,
      providerId: ANTIGRAVITY_PROVIDER_ID,
      providerName: DISPLAY_NAME,
    });

    renderHostnameCliPathSetting({
      container: management,
      description: t('settings.antigravity.cliPathDesc'),
      getValue: () => {
        const current = getAntigravityProviderSettings(settingsBag);
        return current.cliPathsByHost[hostnameKey] ?? current.cliPath ?? '';
      },
      name: t('settings.cliPath.genericName'),
      onChange: async (value) => {
        const current = getAntigravityProviderSettings(settingsBag);
        const cliPathsByHost = { ...current.cliPathsByHost };
        if (value) cliPathsByHost[hostnameKey] = value;
        else delete cliPathsByHost[hostnameKey];
        await context.plugin.applyProviderRuntimeSettings(
          [ANTIGRAVITY_PROVIDER_ID],
          (settings: ClaudianSettings) => {
            updateAntigravityProviderSettings(settings, { cliPath: '', cliPathsByHost });
          },
          () => workspace.cliResolver.reset(),
        );
        modelWarning.context.notifyProviderModelOptionsChanged(ANTIGRAVITY_PROVIDER_ID);
        await readinessPanel.refresh();
      },
      placeholder: process.platform === 'win32'
        ? 'C:\\Users\\you\\AppData\\Local\\agy\\agy.exe'
        : '~/.local/bin/agy',
      validate: validateCliPath,
    });

    new Setting(container)
      .setName(t('settings.models'))
      .setDesc(t('settings.antigravity.modelsDesc'))
      .setHeading();
    renderAntigravityModelPicker(
      container,
      modelWarning.context,
      settingsBag,
      async () => {
        const result = await refreshModelCatalog();
        await readinessPanel.refresh();
        return result;
      },
      () => readinessPanel.refresh(),
    );

    renderEnvironmentSettingsSection({
      container,
      desc: t('settings.antigravity.environment.desc'),
      heading: t('settings.environment'),
      name: t('settings.antigravity.environment.name'),
      placeholder: 'GEMINI_API_KEY=your-key',
      plugin: context.plugin,
      renderCustomContextLimits: target => context.renderCustomContextLimits(
        target,
        ANTIGRAVITY_PROVIDER_ID,
      ),
      scope: `provider:${ANTIGRAVITY_PROVIDER_ID}`,
    });
  },
};

function renderAntigravityModelPicker(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
  settingsBag: Record<string, unknown>,
  loadCatalog: () => Promise<'empty' | 'failed' | 'loaded'>,
  refreshReadiness: () => Promise<void>,
): void {
  const getState = (): ProviderModelPickerState => {
    const current = getAntigravityProviderSettings(settingsBag);
    const models = current.currentCatalog?.models ?? [];
    const selectedIds = getSelectedIds(current);
    return {
      aliases: current.modelAliases,
      discoveredCount: models.length,
      models: buildAntigravityPickerModels(models, selectedIds),
      selectedIds,
    };
  };

  renderProviderModelPicker({
    checkCatalogFreshnessWhenCached: true,
    container,
    emptyCatalogText: t('settings.antigravity.emptyCatalog'),
    failedCatalogText: t('settings.antigravity.failedCatalog'),
    getState,
    initiallyOpen: (getAntigravityProviderSettings(settingsBag).currentCatalog?.models.length ?? 0) === 0,
    loadCatalog,
    loadingCatalogText: t('settings.antigravity.loadingCatalog'),
    modifier: 'antigravity',
    async onAliasesChange(modelAliases) {
      await context.plugin.mutateSettings((settings) => {
        updateAntigravityProviderSettings(settings, { modelAliases });
      });
      context.notifyProviderModelOptionsChanged(ANTIGRAVITY_PROVIDER_ID);
    },
    async onSelectedIdsChange(selectedIds) {
      const current = getAntigravityProviderSettings(settingsBag);
      const allowed = new Set((current.currentCatalog?.models ?? []).map(model => model.rawId));
      const normalized = selectedIds.filter(id => allowed.has(id));
      if (sameList(current.visibleModels ?? [], normalized)) return;
      await context.plugin.mutateSettings((settings) => {
        updateAntigravityProviderSettings(settings, { visibleModels: normalized });
      });
      context.notifyProviderModelOptionsChanged(ANTIGRAVITY_PROVIDER_ID);
      await refreshReadiness();
    },
    providerName: DISPLAY_NAME,
    searchPlaceholder: t('settings.antigravity.searchPlaceholder'),
  });
}

function getSelectedIds(current: ReturnType<typeof getAntigravityProviderSettings>): string[] {
  if (current.visibleModels !== null) return [...current.visibleModels];
  return current.currentCatalog?.models.map(model => model.rawId) ?? [];
}

function buildAntigravityPickerModels(
  catalogModels: readonly AntigravityModel[],
  selectedIds: readonly string[],
): ProviderModelPickerModel[] {
  const models: ProviderModelPickerModel[] = catalogModels.map(model => ({
    id: model.rawId,
    isAvailable: true,
    name: model.displayName,
  }));
  const catalogIds = new Set(catalogModels.map(model => model.rawId));
  for (const rawId of selectedIds) {
    if (catalogIds.has(rawId)) continue;
    models.push({
      description: 'Selected model',
      id: rawId,
      isAvailable: false,
      name: rawId,
      unavailableMessage: `Not currently reported by ${DISPLAY_NAME}`,
    });
  }
  return models;
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateCliPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const expanded = normalizeConfiguredCliPath(trimmed);
  if (!path.posix.isAbsolute(expanded) && !path.win32.isAbsolute(expanded)) {
    return t('settings.cliPath.validation.mustBeAbsolute');
  }
  try {
    if (!fs.existsSync(expanded)) return t('settings.cliPath.validation.notExist');
    if (!fs.statSync(expanded).isFile()) return t('settings.cliPath.validation.notFile');
    if (process.platform !== 'win32') fs.accessSync(expanded, fs.constants.X_OK);
  } catch {
    return process.platform === 'win32'
      ? t('settings.cliPath.validation.notAccessible')
      : t('settings.cliPath.validation.notExecutable');
  }
  return null;
}

function getAntigravityWorkspaceServices(): AntigravityWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices(
    ANTIGRAVITY_PROVIDER_ID,
  ) as AntigravityWorkspaceServices;
}
