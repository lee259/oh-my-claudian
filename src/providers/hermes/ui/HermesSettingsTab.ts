import * as fs from 'node:fs';

import { Notice, Setting } from 'obsidian';

import { deriveProviderModelCatalogStatus } from '../../../core/providers/modelCatalog';
import { assessProviderReadiness } from '../../../core/providers/ProviderReadiness';
import type {
  ProviderSettingsTabRenderer,
} from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { HERMES_PROVIDER_ICON } from '../../../shared/icons';
import { renderCliLifecycleSection } from '../../../shared/settings/CliLifecycleSection';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { renderHostnameCliPathSetting } from '../../../shared/settings/HostnameCliPathSetting';
import { renderProviderAdditionalArgumentsSetting } from '../../../shared/settings/ProviderAdditionalArgumentsSetting';
import { renderProviderEnablementSetting } from '../../../shared/settings/ProviderEnablementSetting';
import {
  type ProviderModelPickerModel,
  type ProviderModelPickerState,
  renderProviderModelPicker,
} from '../../../shared/settings/ProviderModelPicker';
import { renderProviderReadinessPanel } from '../../../shared/settings/ProviderReadinessPanel';
import { getHostnameKey } from '../../../utils/env';
import { normalizeConfiguredCliPath } from '../../../utils/path';
import { maybeGetHermesWorkspaceServices } from '../app/HermesWorkspaceServices';
import { invalidateHermesModelCatalog } from '../env/HermesSettingsReconciler';
import { normalizeHermesVisibleModels } from '../models';
import { hermesCliMetadata } from '../runtime/HermesCliLifecycle';
import {
  getHermesProviderSettings,
  updateHermesProviderSettings,
} from '../settings';

export const hermesSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settings = context.plugin.settings as unknown as Record<string, unknown>;
    const workspace = maybeGetHermesWorkspaceServices();
    const hostnameKey = getHostnameKey();
    let refreshCliInstallationSummary = async (): Promise<void> => {};
    const readinessPanel = renderProviderReadinessPanel({
      container,
      icon: HERMES_PROVIDER_ICON,
      providerName: 'Hermes',
      async getSnapshot() {
        const provider = getHermesProviderSettings(settings);
        return assessProviderReadiness({
          cliAvailable: context.plugin.cliLifecycle?.getSnapshot('hermes')
            ? context.plugin.cliLifecycle.getSnapshot('hermes')?.status === 'ready' : undefined,
          cliPath: typeof context.plugin.getResolvedProviderCliPath === 'function'
            ? await context.plugin.getResolvedProviderCliPath('hermes')
            : null,
          discoveredModelCount: provider.discoveredModels.filter(model => model.available !== false).length,
          enabled: provider.enabled,
          selectedModelCount: provider.visibleModels.filter(id => provider.discoveredModels.some(model => model.rawId === id && model.available !== false)).length,
        });
      },
      async onRefresh() {
        const result = await workspace?.refreshModelCatalog?.();
        if (result?.diagnostics) {
          new Notice(t('settings.hermes.discoveryFailed', { error: result.diagnostics }));
        }
        context.notifyProviderModelOptionsChanged('hermes');
      },
    });
    const management = readinessPanel.management;
    renderProviderEnablementSetting({
      container: readinessPanel.enablement,
      description: t('settings.hermes.enableDesc'),
      getValue: () => getHermesProviderSettings(settings).enabled,
      name: t('settings.hermes.enable'),
      onChange: async enabled => {
        await context.plugin.mutateSettings(target => {
          updateHermesProviderSettings(target, { enabled });
        });
        await readinessPanel.refresh();
        context.notifyProviderModelOptionsChanged('hermes');
      },
    });
    renderHostnameCliPathSetting({
      container: management,
      description: t('settings.hermes.cliPathDesc'),
      getValue: () => getHermesProviderSettings(settings).cliPathsByHost[hostnameKey] || '',
      name: t('settings.hermes.cliPath'),
      onChange: async value => {
        const provider = getHermesProviderSettings(settings);
        const cliPathsByHost = { ...provider.cliPathsByHost };
        if (value) cliPathsByHost[hostnameKey] = value;
        else delete cliPathsByHost[hostnameKey];
        await context.plugin.applyProviderRuntimeSettings(
          ['hermes'],
          target => {
            updateHermesProviderSettings(target, { cliPathsByHost });
            invalidateHermesModelCatalog(target);
          },
          () => workspace?.cliResolver.reset(),
        );
        await refreshCliInstallationSummary();
        context.notifyProviderModelOptionsChanged('hermes');
      },
      placeholder: process.platform === 'win32'
        ? 'C:\\Users\\you\\.local\\bin\\hermes.exe'
        : '/Users/you/.local/bin/hermes',
      validate: validateCliPath,
    });
    const cliLifecycle = renderCliLifecycleSection({
      providerId: 'hermes',
      lifecycle: context.plugin.cliLifecycle,
      container: readinessPanel.cliDetail,
      metadata: hermesCliMetadata,
      resolveCliPath: () => context.plugin.getResolvedProviderCliPath('hermes'),
      getRuntimeEnvText: () => context.plugin.getActiveEnvironmentVariables('hermes'),
      app: context.plugin.app,
      onCliChanged: async () => { await readinessPanel.refresh(); },
      onCheckAgain: () => readinessPanel.refresh(true),
      onProbe: (info, cliPath) => {
        const current = getHermesProviderSettings(settings);
        void readinessPanel.refresh();
        readinessPanel.setInstallationSummary({
          version: info.version ?? '',
          sourceText: t(current.cliPathsByHost[hostnameKey] || current.cliPath
            ? 'settings.cliInstallation.customPath'
            : 'settings.cliInstallation.automaticPath'),
          path: cliPath,
        });
      },
    });
    refreshCliInstallationSummary = cliLifecycle?.refresh ?? refreshCliInstallationSummary;
    new Setting(container).setName(t('settings.hermes.models')).setHeading();
    renderHermesModelPicker(container, context, settings, () => readinessPanel.refresh());
    renderEnvironmentSettingsSection({
      container,
      desc: t('settings.hermes.environmentDesc'),
      heading: t('settings.environment'),
      name: t('settings.hermes.environmentName'),
      placeholder: 'HERMES_HOME=/path/to/hermes',
      usePreactEnvironmentField: true,
      usePreactSnippetList: true,
      plugin: context.plugin,
      scope: 'provider:hermes',
    });
    renderProviderAdditionalArgumentsSetting(container, context.plugin, 'hermes');
  },
};

function renderHermesModelPicker(
  container: HTMLElement,
  context: Parameters<ProviderSettingsTabRenderer['render']>[1],
  settings: Record<string, unknown>,
  refreshReadiness: () => Promise<void>,
): void {
  const getState = (): ProviderModelPickerState => {
    const provider = getHermesProviderSettings(settings);
    return {
      aliases: {},
      catalogRefreshedAt: provider.catalogTimestamp || undefined,
      catalogStatus: deriveProviderModelCatalogStatus({
        modelCount: provider.discoveredModels.length,
        refreshedAt: provider.catalogTimestamp || undefined,
      }),
      defaultModelId: provider.visibleModels.find(id => provider.discoveredModels.some(model => model.rawId === id && model.available !== false)),
      discoveredCount: provider.discoveredModels.length,
      models: provider.discoveredModels.map(toPickerModel),
      selectionMode: 'explicit',
      selectedIds: provider.visibleModels,
    };
  };
  renderProviderModelPicker({
    container,
    emptyCatalogText: t('settings.hermes.noModels'),
    failedCatalogText: t('settings.hermes.catalogFailed'),
    getState,
    async loadCatalog() {
      const result = await maybeGetHermesWorkspaceServices()?.refreshModelCatalog?.();
      if (!result || result.diagnostics) {
        new Notice(t('settings.hermes.discoveryFailed', {
          error: result?.diagnostics ?? t('settings.hermes.workspaceNotInitialized'),
        }));
        return 'failed';
      }
      context.notifyProviderModelOptionsChanged('hermes');
      await refreshReadiness();
      return getHermesProviderSettings(settings).discoveredModels.length > 0 ? 'loaded' : 'empty';
    },
    loadingCatalogText: t('settings.hermes.loadingModels'),
    modifier: 'hermes',
    onAliasesChange: async () => undefined,
    async onSelectedIdsChange(visibleModels) {
      await context.plugin.mutateSettings(target => {
        const provider = getHermesProviderSettings(target);
        updateHermesProviderSettings(target, {
          visibleModels: normalizeHermesVisibleModels(visibleModels, provider.discoveredModels),
        });
      });
      context.notifyProviderModelOptionsChanged('hermes');
      await refreshReadiness();
    },
    providerName: 'Hermes',
  });
}

function validateCliPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const expandedPath = normalizeConfiguredCliPath(trimmed);
  if (!fs.existsSync(expandedPath)) return 'Path does not exist';
  return fs.statSync(expandedPath).isFile() ? null : 'Path must point to a file';
}

function toPickerModel(
  model: ReturnType<typeof getHermesProviderSettings>['discoveredModels'][number],
): ProviderModelPickerModel {
  const [providerKey, ...modelIdParts] = model.rawId.split(':');
  const providerLabel = modelIdParts.length > 0 && providerKey ? formatProviderLabel(providerKey) : undefined;
  return {
    description: model.description,
    id: model.rawId,
    isAvailable: model.available !== false,
    name: model.label || modelIdParts.join(':') || model.rawId,
    ...(providerKey && providerLabel ? { providerKey, providerLabel } : {}),
  };
}

function formatProviderLabel(providerKey: string): string {
  return providerKey
    .split(/[-_]/u)
    .map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
}
