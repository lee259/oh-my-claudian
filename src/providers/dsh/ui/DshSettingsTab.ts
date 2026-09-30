import { Notice, Setting } from 'obsidian';

import { deriveProviderModelCatalogStatus } from '../../../core/providers/modelCatalog';
import { assessProviderReadiness } from '../../../core/providers/ProviderReadiness';
import type {
  ProviderSettingsTabRenderer,
} from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { DSH_PROVIDER_ICON } from '../../../shared/icons';
import { renderCliLifecycleSection } from '../../../shared/settings/CliLifecycleSection';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { renderHostnameCliPathSetting } from '../../../shared/settings/HostnameCliPathSetting';
import { renderProviderEnablementSetting } from '../../../shared/settings/ProviderEnablementSetting';
import {
  type ProviderModelPickerModel,
  type ProviderModelPickerState,
  renderProviderModelPicker,
} from '../../../shared/settings/ProviderModelPicker';
import { renderProviderReadinessPanel } from '../../../shared/settings/ProviderReadinessPanel';
import { getHostnameKey } from '../../../utils/env';
import { maybeGetDshWorkspaceServices } from '../app/DshWorkspaceServices';
import { parseDshModelRoute } from '../models';
import { dshCliMetadata } from '../runtime/DshCliMetadata';
import { getDshProviderSettings, updateDshProviderSettings } from '../settings';

export const dshSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settings = context.plugin.settings as unknown as Record<string, unknown>;
    const workspace = maybeGetDshWorkspaceServices();
    const hostnameKey = getHostnameKey();
    let refreshCliInstallationSummary = async (): Promise<void> => {};

    const readinessPanel = renderProviderReadinessPanel({
      container,
      icon: DSH_PROVIDER_ICON,
      providerName: 'DeepSeek Harness',
      async getSnapshot() {
        const provider = getDshProviderSettings(settings);
        return assessProviderReadiness({
          cliPath: typeof context.plugin.getResolvedProviderCliPath === 'function'
            ? await context.plugin.getResolvedProviderCliPath('dsh')
            : null,
          discoveredModelCount: provider.discoveredModels.length,
          enabled: provider.enabled,
          selectedModelCount: provider.visibleModels.length,
        });
      },
      async onRefresh() {
        const result = await workspace?.refreshModelCatalog?.();
        if (!result || result.diagnostics) {
          new Notice(result?.diagnostics ?? t('settings.dsh.workspaceNotInitialized'));
        }
        context.notifyProviderModelOptionsChanged('dsh');
      },
    });

    const setupDescription = readinessPanel.management.createDiv({ cls: 'claudian-sp-settings-desc' });
    setupDescription.createEl('p', {
      cls: 'setting-item-description',
      text: t('settings.dsh.setupIntro'),
    });
    setupDescription.createEl('p', {
      cls: 'setting-item-description',
      text: t('settings.dsh.previewNote'),
    });

    renderProviderEnablementSetting({
      container: readinessPanel.enablement,
      description: t('settings.providerEnablement.desc', { provider: 'DeepSeek Harness' }),
      getValue: () => getDshProviderSettings(settings).enabled,
      name: t('settings.providerEnablement.name', { provider: 'DeepSeek Harness' }),
      onChange: async enabled => {
        await context.plugin.mutateSettings(target => { updateDshProviderSettings(target, { enabled }); });
        await readinessPanel.refresh();
        context.notifyProviderModelOptionsChanged('dsh');
      },
    });

    renderEnvironmentSettingsSection({
      container: readinessPanel.management,
      plugin: context.plugin,
      scope: 'provider:dsh',
      heading: 'Runtime environment',
      name: 'DeepSeek Harness environment variables',
      desc: 'Use DEEPSEEK_API_KEY, or credentials already configured in your DSH home.',
      placeholder: 'DEEPSEEK_API_KEY=your-key',
    });

    renderHostnameCliPathSetting({
      container: readinessPanel.management,
      description: 'Leave blank to use the installed dsh command from PATH.',
      getValue: () => getDshProviderSettings(settings).cliPathsByHost[hostnameKey]
        || getDshProviderSettings(settings).cliPath,
      name: 'dsh command path',
      onChange: async value => {
        const provider = getDshProviderSettings(settings);
        const cliPathsByHost = { ...provider.cliPathsByHost };
        if (value) cliPathsByHost[hostnameKey] = value;
        else delete cliPathsByHost[hostnameKey];
        await context.plugin.applyProviderRuntimeSettings(
          ['dsh'],
          target => { updateDshProviderSettings(target, { cliPathsByHost }); },
          () => workspace?.cliResolver.reset(),
        );
        await refreshCliInstallationSummary();
        await readinessPanel.refresh();
      },
      placeholder: process.platform === 'win32' ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\dsh.cmd' : '/usr/local/bin/dsh',
    });

    const lifecycle = renderCliLifecycleSection({
      container: readinessPanel.cliDetail,
      metadata: dshCliMetadata,
      resolveCliPath: () => context.plugin.getResolvedProviderCliPath('dsh'),
      getRuntimeEnvText: () => context.plugin.getActiveEnvironmentVariables('dsh'),
      app: context.plugin.app,
      onCliChanged: async () => {
        workspace?.cliResolver.reset();
        await readinessPanel.refresh();
      },
      onCheckAgain: () => readinessPanel.refresh(true),
      onProbe: (info, cliPath) => {
        readinessPanel.setInstallationSummary({
          version: info.version ?? '',
          sourceText: getDshProviderSettings(settings).cliPathsByHost[hostnameKey]
            ? t('settings.cliInstallation.customPath')
            : t('settings.cliInstallation.automaticPath'),
          path: cliPath,
        });
      },
    });
    refreshCliInstallationSummary = lifecycle?.refresh ?? refreshCliInstallationSummary;

    new Setting(container).setName('Models').setHeading();
    renderDshModelPicker(container, context, settings);
  },
};

function renderDshModelPicker(
  container: HTMLElement,
  context: Parameters<ProviderSettingsTabRenderer['render']>[1],
  settings: Record<string, unknown>,
): void {
  const getState = (): ProviderModelPickerState => {
    const provider = getDshProviderSettings(settings);
    return {
      aliases: {},
      catalogRefreshedAt: provider.catalogTimestamp || undefined,
      catalogStatus: deriveProviderModelCatalogStatus({
        modelCount: provider.discoveredModels.length,
        refreshedAt: provider.catalogTimestamp || undefined,
      }),
      defaultModelId: provider.visibleModels[0],
      discoveredCount: provider.discoveredModels.length,
      models: provider.discoveredModels.map(toPickerModel),
      selectionMode: 'explicit',
      selectedIds: provider.visibleModels,
    };
  };

  renderProviderModelPicker({
    container,
    emptyCatalogText: t('settings.dsh.noModels'),
    failedCatalogText: t('settings.dsh.catalogFailed'),
    getState,
    async loadCatalog() {
      const result = await maybeGetDshWorkspaceServices()?.refreshModelCatalog?.();
      if (!result || result.diagnostics) {
        new Notice(result?.diagnostics ?? t('settings.dsh.workspaceNotInitialized'));
        return 'failed';
      }
      context.notifyProviderModelOptionsChanged('dsh');
      return getDshProviderSettings(settings).discoveredModels.length > 0 ? 'loaded' : 'empty';
    },
    loadingCatalogText: t('settings.dsh.loadingModels'),
    modifier: 'dsh',
    onAliasesChange: async () => undefined,
    async onSelectedIdsChange(visibleModels) {
      const provider = getDshProviderSettings(settings);
      await context.plugin.mutateSettings(target => {
        updateDshProviderSettings(target, {
          visibleModels: visibleModels.filter(id => provider.discoveredModels.some(model => model.rawId === id)),
        });
      });
      context.notifyProviderModelOptionsChanged('dsh');
    },
    providerName: 'DeepSeek Harness',
  });
}

function toPickerModel(model: ReturnType<typeof getDshProviderSettings>['discoveredModels'][number]): ProviderModelPickerModel {
  const route = parseDshModelRoute(model.rawId);
  const [providerId, ...modelParts] = route ? [route.providerId, route.modelId] : model.rawId.split('/');
  return {
    ...(model.description ? { description: model.description } : {}),
    id: model.rawId,
    isAvailable: true,
    name: model.label || modelParts.join('/') || model.rawId,
    ...(providerId ? { providerKey: providerId, providerLabel: formatProviderLabel(providerId) } : {}),
  };
}

function formatProviderLabel(value: string): string {
  return value.split(/[-_]/u).map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(' ');
}
