import { Notice } from 'obsidian';

import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ProviderSettingsTabRendererContext } from '@/core/providers/types';
import { t } from '@/i18n/i18n';
import { renderProviderModelPicker } from '@/shared/settings/ProviderModelPicker';

import type { ClaudeWorkspaceServices } from '../app/ClaudeWorkspaceServices';
import { findClaudeCatalogOption, getClaudeModelCatalog, getClaudeModelOptions, resolveClaudeModelEnvironmentTypePreference } from '../modelOptions';
import { toClaudeRuntimeModelId } from '../modelSelection';
import { getClaudeProviderSettings, updateClaudeProviderSettings } from '../settings';
import { claudeChatUIConfig } from './ClaudeChatUIConfig';

export function renderClaudeModelPicker(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
  workspace: ClaudeWorkspaceServices,
  reconcile: (settings: Record<string, unknown>) => void,
  onChanged: () => void,
) {
  const settings = context.plugin.settings as unknown as Record<string, unknown>;
  return renderProviderModelPicker({
    container,
    providerName: 'Claude Code',
    modifier: 'claude',
    emptyCatalogText: t('settings.modelPicker.emptyCatalog', { provider: 'Claude Code' }),
    loadingCatalogText: t('settings.modelPicker.loadingCatalog', { provider: 'Claude Code' }),
    failedCatalogText: t('settings.modelPicker.stale', { provider: 'Claude Code' }),
    getState() {
      const catalog = getClaudeModelCatalog(settings);
      const current = getClaudeProviderSettings(settings);
      const available = getClaudeModelOptions(settings);
      const defaultId = claudeChatUIConfig.getDefaultModel?.(settings) ?? null;
      const selected = current.visibleModels === null
        ? available.map(option => option.value)
        : current.visibleModels.map(id => findClaudeCatalogOption(catalog, current.discoveredModels, id)?.value ?? id);
      const selectedIds = defaultId && selected.includes(defaultId)
        ? [defaultId, ...selected.filter(id => id !== defaultId)]
        : selected;
      const aliases = settings.customModelAliases as Record<string, string> ?? {};
      return {
        aliases: Object.fromEntries(catalog.flatMap(option => {
          const alias = aliases[toClaudeRuntimeModelId(option.value)];
          return alias ? [[option.value, alias]] : [];
        })),
        defaultModelId: defaultId,
        discoveredCount: current.discoveredModels.length,
        models: catalog.map(option => ({ id: option.value, name: option.label, description: option.description })),
        selectionMode: current.visibleModels === null ? 'all' : 'explicit',
        selectedIds: [...new Set(selectedIds)],
      };
    },
    async loadCatalog() {
      const result = await workspace.refreshModelCatalog?.();
      if (result?.diagnostics) {
        new Notice(t('settings.modelRefreshFailed', { provider: 'Claude Code', error: result.diagnostics }));
        return 'failed';
      }
      context.notifyProviderModelOptionsChanged('claude');
      onChanged();
      return getClaudeModelCatalog(settings).length ? 'loaded' : 'empty';
    },
    async onSelectedIdsChange(selectedIds) {
      await context.plugin.mutateSettings(bag => {
        const modelOptions = getClaudeModelCatalog(bag);
        const first = selectedIds[0];
        const preference = first ? resolveClaudeModelEnvironmentTypePreference(modelOptions, first) : null;
        updateClaudeProviderSettings(bag, { visibleModels: selectedIds, ...(first ? { defaultModel: preference ?? first } : {}) });
        reconcile(bag);
        ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(bag);
      });
      context.notifyProviderModelOptionsChanged('claude');
      onChanged();
    },
    async onAliasesChange(aliases) {
      await context.plugin.mutateSettings(bag => {
        const merged = { ...(bag.customModelAliases ?? {}) };
        for (const option of getClaudeModelCatalog(bag)) {
          const key = toClaudeRuntimeModelId(option.value);
          if (aliases[option.value]) merged[key] = aliases[option.value];
          else delete merged[key];
        }
        bag.customModelAliases = merged;
      });
      context.notifyProviderModelOptionsChanged('claude');
      onChanged();
    },
  });
}
