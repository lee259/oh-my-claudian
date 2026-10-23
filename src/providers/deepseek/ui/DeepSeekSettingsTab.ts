import { Notice, Setting } from 'obsidian';

import type { ProviderHost } from '@/core/providers/ProviderHost';
import { assessProviderReadiness } from '@/core/providers/ProviderReadiness';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ProviderSettingsTabRenderer } from '@/core/providers/types';
import { t } from '@/i18n/i18n';
import { DEEPSEEK_PROVIDER_ICON } from '@/shared/icons';
import { renderCliLifecycleSection } from '@/shared/settings/CliLifecycleSection';
import { renderEnvironmentSettingsSection } from '@/shared/settings/EnvironmentSettingsSection';
import { renderHostnameCliPathSetting } from '@/shared/settings/HostnameCliPathSetting';
import { renderProviderEnablementSetting } from '@/shared/settings/ProviderEnablementSetting';
import { renderLastEnabledProviderWarning, renderProviderModelEnablementWarning } from '@/shared/settings/ProviderModelEnablementWarning';
import { renderProviderModelPicker } from '@/shared/settings/ProviderModelPicker';
import { type ProviderReadinessPanelController,renderProviderReadinessPanel } from '@/shared/settings/ProviderReadinessPanel';
import { getHostnameKey } from '@/utils/env';

import { deepseekCliMetadata } from '../runtime/DeepSeekCliLifecycle';
import type { DeepSeekCliResolver } from '../runtime/DeepSeekCliResolver';
import { getDeepSeekDesktopInstallation } from '../runtime/DeepSeekInstallation';
import type { DeepSeekModelCatalog } from '../runtime/DeepSeekModels';
import { type DeepSeekPresetPlugin, parseDeepSeekPresetPlugins, renderDeepSeekPresetPreview } from '../runtime/DeepSeekPresetPlugins';
import { getDeepSeekProviderSettings, updateDeepSeekProviderSettings } from '../settings';

export function createDeepSeekSettingsTabRenderer(workspace: { cliResolver: DeepSeekCliResolver; modelCatalog: DeepSeekModelCatalog }): ProviderSettingsTabRenderer {
  return {
    render(container, context) {
      const host = context.plugin;
      const settings = (): ReturnType<typeof getDeepSeekProviderSettings> => getDeepSeekProviderSettings(host.settings);
      const refreshCatalog = async (): Promise<void> => {
        await workspace.modelCatalog.refresh();
        context.notifyProviderModelOptionsChanged('deepseek');
      };
      const panel: ProviderReadinessPanelController = renderProviderReadinessPanel({ container, icon: DEEPSEEK_PROVIDER_ICON, providerName: 'DeepSeek Harness',
        async getSnapshot() {
          const cliPath = await host.getResolvedProviderCliPath('deepseek');
          panel.setInstallationSummary({ version: host.cliLifecycle?.getSnapshot('deepseek')?.version, path: cliPath, sourceText: cliPath ? t(getDeepSeekDesktopInstallation(cliPath) ? 'settings.deepseek.installation.desktop' : 'settings.deepseek.installation.web') : '' });
          return assessProviderReadiness({ cliPath, cliAvailable: host.cliLifecycle?.getSnapshot('deepseek') ? host.cliLifecycle.getSnapshot('deepseek')?.status === 'ready' : undefined,
            discoveredModelCount: settings().discoveredModels.filter(model => model.available !== false).length,
            selectedModelCount: settings().visibleModels.length, enabled: settings().enabled });
        }, onRefresh: refreshCatalog,
      });
      const management = panel.management;
      management.createEl('p', { cls: 'setting-item-description', text: t('settings.deepseek.installation.desc') });
      const warning = renderLastEnabledProviderWarning(management);
      const modelWarning = renderProviderModelEnablementWarning(container, context, {
        providerId: 'deepseek', providerName: 'DeepSeek Harness', getHasEnabledModels: () => settings().visibleModels.length > 0, getIsEnabled: () => settings().enabled,
      });
      renderProviderEnablementSetting({ container: panel.enablement, description: t('settings.providerEnablement.desc', { provider: 'DeepSeek Harness' }),
        name: t('settings.providerEnablement.name', { provider: 'DeepSeek Harness' }), getValue: () => settings().enabled,
        onChange: async enabled => {
          if (!ProviderSettingsCoordinator.canApplyProviderEnablement(host.settings, 'deepseek', enabled)) { warning.showFor(); return; }
          await host.runProviderExecutionTransition(['deepseek'], async () => host.mutateSettings(settings => {
            ProviderSettingsCoordinator.applyProviderEnablement(settings, 'deepseek', enabled);
          }));
          warning.hide(); modelWarning.context.notifyProviderModelOptionsChanged('deepseek'); await panel.refresh();
        },
      });
      renderHostnameCliPathSetting({ container: management, description: '', name: t('settings.cliPath.genericName'),
        placeholder: process.platform === 'darwin' ? '/Applications/DeepSeek Harness.app' : process.platform === 'win32' ? '%LOCALAPPDATA%\\Programs\\DeepSeek Harness' : '/usr/local/bin/dsh',
        getValue: () => settings().cliPathsByHost[getHostnameKey()] ?? settings().cliPath,
        onChange: async cliPath => {
          await host.applyProviderRuntimeSettings(['deepseek'], settings => { updateDeepSeekProviderSettings(settings, { cliPath }); }, () => workspace.cliResolver.reset());
          await panel.refresh();
        },
      });
      new Setting(container).setName(t('settings.models')).setHeading();
      const picker = renderProviderModelPicker({ container, modifier: 'deepseek', providerName: 'DeepSeek Harness',
        emptyCatalogText: t('settings.deepseek.models.empty'), failedCatalogText: t('settings.deepseek.models.failed'), loadingCatalogText: t('settings.deepseek.models.loading'),
        getState: () => ({ aliases: settings().modelAliases, selectedIds: settings().visibleModels, discoveredCount: settings().discoveredModels.length,
          models: settings().discoveredModels.map(model => ({ id: model.encodedId, name: model.label, description: model.description,
            providerKey: model.provider, providerLabel: model.provider, isAvailable: model.available !== false,
          })),
        }),
        async loadCatalog() { try { await refreshCatalog(); await panel.refresh(); return settings().discoveredModels.length ? 'loaded' : 'empty'; } catch (error) { new Notice(`${t('settings.deepseek.models.failed')} ${error instanceof Error ? error.message : String(error)}`); return 'failed'; } },
        async onAliasesChange(modelAliases) { await host.mutateSettings(settings => { updateDeepSeekProviderSettings(settings, { modelAliases }); }); context.notifyProviderModelOptionsChanged('deepseek'); },
        async onSelectedIdsChange(visibleModels) {
          await host.mutateSettings(settings => { updateDeepSeekProviderSettings(settings, { visibleModels }); });
          modelWarning.context.notifyProviderModelOptionsChanged('deepseek'); await panel.refresh();
        },
      });
      new Setting(container).setName(t('settings.deepseek.preset')).setHeading();
      new Setting(container).setName(t('settings.deepseek.codeMode.name')).setDesc(t('settings.deepseek.codeMode.desc')).addToggle(toggle => {
        toggle.setValue(settings().codeMode).onChange(async codeMode => { await host.mutateSettings(settings => { updateDeepSeekProviderSettings(settings, { codeMode }); }); });
        toggle.toggleEl.setAttribute('aria-label', t('settings.deepseek.codeMode.name'));
      });
      renderPresetPlugins(container, host, settings);
      context.renderHiddenProviderCommandSetting(container, 'deepseek', { name: t('settings.deepseek.hiddenCommands.name'), desc: t('settings.deepseek.hiddenCommands.desc'), placeholder: 'compact\nreview' });
      renderEnvironmentSettingsSection({ container, plugin: host, scope: 'provider:deepseek', heading: t('settings.environment'), name: t('settings.deepseek.environment.name'),
        desc: t('settings.deepseek.environment.desc'), placeholder: 'DSH_HOME=/path/to/.dsh', renderCustomContextLimits: target => context.renderCustomContextLimits(target, 'deepseek'),
      });
      if (host.cliLifecycle) renderCliLifecycleSection({
        container: panel.cliDetail, metadata: deepseekCliMetadata, providerId: 'deepseek', lifecycle: host.cliLifecycle,
        resolveCliPath: () => host.getResolvedProviderCliPath('deepseek'),
        getRuntimeEnvText: () => host.getActiveEnvironmentVariables('deepseek'), app: host.app,
        onCheckAgain: () => panel.refresh(true), onProbe: () => { void panel.refresh(); },
      });
      return { dispose() { picker.dispose(); panel.destroy(); } };
    },
  };
}

/** dsh plugin rows, not prose; the UI sentence-case rule only inspects literal text values. */
const PRESET_PLUGINS_EXAMPLE = "- id: tool-todo\n  name: '@deepseek-ai/dsh-tool-todo'\n  config:\n    allowParallelInProgress: true";

/** Additional chat preset rows, validated before saving, and a read-only preview of the preset they extend. */
function renderPresetPlugins(container: HTMLElement, host: ProviderHost, settings: () => ReturnType<typeof getDeepSeekProviderSettings>): void {
  const name = t('settings.deepseek.presetPlugins.name');
  let field!: HTMLTextAreaElement;
  let error: HTMLElement | undefined;
  const setting = new Setting(container).setName(name).setDesc(t('settings.deepseek.presetPlugins.desc'))
    .setClass('claudian-settings-textarea').setClass('claudian-deepseek-preset-plugins')
    .addTextArea(text => {
      text.setPlaceholder(PRESET_PLUGINS_EXAMPLE).setValue(settings().presetPlugins);
      field = text.inputEl;
      field.rows = 6;
      field.spellcheck = false;
      field.setAttribute('aria-label', name);
    });
  const preview = container.createEl('details', { cls: 'claudian-deepseek-preset-preview' });
  preview.createEl('summary', { text: t('settings.deepseek.presetPreview') });
  const code = preview.createEl('pre').createEl('code');
  // A saved value that no longer parses fails at launch instead; the preview then shows Claudian's own rows.
  const refresh = (): void => {
    let additional: DeepSeekPresetPlugin[] = [];
    try { additional = parseDeepSeekPresetPlugins(settings().presetPlugins); } catch { /* reported at launch */ }
    code.setText(renderDeepSeekPresetPreview(additional));
  };
  refresh();
  const showError = (message?: string): void => {
    error?.remove();
    error = undefined;
    if (!message) { field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby'); return; }
    error = setting.controlEl.createDiv({ cls: 'claudian-deepseek-preset-plugins-error', text: message, attr: { role: 'alert', id: 'claudian-deepseek-preset-plugins-error' } });
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', error.id);
  };
  field.addEventListener('change', () => { void commit(field.value); });
  const commit = async (value: string): Promise<void> => {
    try { parseDeepSeekPresetPlugins(value); } catch (cause) { showError(cause instanceof Error ? cause.message : String(cause)); return; }
    showError();
    if (value === settings().presetPlugins) return;
    // The rows are part of the launch overlay, so applying them restarts the shared Host.
    try {
      await host.applyProviderRuntimeSettings(['deepseek'], next => { updateDeepSeekProviderSettings(next, { presetPlugins: value }); });
    } catch (cause) { showError(cause instanceof Error ? cause.message : String(cause)); return; }
    refresh();
  };
}
