import { reportBackgroundTurnCompletionDrop } from '../../core/execution/BackgroundTurnCompletionDrop';
import { buildSystemPrompt } from '../../core/prompt/mainAgent';
import { NOOP_TASK_RESULT_INTERPRETER } from '../../core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '../../core/providers/providerConfig';
import { hasStoredConfigNormalization } from '../../core/providers/settings/storedSettings';
import type { ProviderModule } from '../../core/providers/types';
import {
  antigravityWorkspaceRegistration,
  getAntigravityWorkspaceServices,
} from './app/AntigravityWorkspaceServices';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from './capabilities';
import { getAntigravityMigratedVisibleModelIds } from './config';
import { antigravitySettingsReconciler } from './env/AntigravitySettingsReconciler';
import { AntigravityExecutionBackend } from './execution/AntigravityExecutionBackend';
import { AntigravityConversationHistoryService } from './history/AntigravityConversationHistoryService';
import {
  ANTIGRAVITY_PROVIDER_ID,
  getAntigravityProviderSettings,
  updateAntigravityProviderSettings,
} from './settings';
import { antigravityChatUIConfig } from './ui/AntigravityChatUIConfig';

export const antigravityProviderRegistration: ProviderModule = {
  id: ANTIGRAVITY_PROVIDER_ID,
  blankTabOrder: 14,
  capabilities: ANTIGRAVITY_PROVIDER_CAPABILITIES,
  chatUIConfig: antigravityChatUIConfig,
  createExecutionBackend: plugin => new AntigravityExecutionBackend(plugin.getRuntimeHost(ANTIGRAVITY_PROVIDER_ID), {
    buildDefaultPrompt: vaultPath => buildSystemPrompt({
      customPrompt: plugin.settings.systemPrompt,
      mediaFolder: plugin.settings.mediaFolder,
      userName: plugin.settings.userName,
      vaultPath,
    }, {
      capabilities: { obsidianVaultTool: Boolean(plugin.obsidianWorkspaceToolBridge) },
      toolGuidanceProfile: 'provider-native',
    }),
    modelSink: getAntigravityWorkspaceServices().modelCatalogOwner,
    obsidianWorkspaceToolBridge: plugin.obsidianWorkspaceToolBridge,
    onBackgroundTurnCompletionDropped: report =>
      reportBackgroundTurnCompletionDrop(plugin.diagnosticLog, report),
  }),
  displayName: 'Antigravity',
  environmentKeyPatterns: [/^AGY_/i, /^ANTIGRAVITY_/i, /^GEMINI_/i],
  historyService: new AntigravityConversationHistoryService(),
  isEnabled: settings => getAntigravityProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateAntigravityProviderSettings(settings, { enabled }),
  settingsReconciler: antigravitySettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost', 'catalogsByHost', 'selectedModelsByHost'],
    normalizeStored(target, stored) {
      const storedConfig = getProviderConfig(stored, ANTIGRAVITY_PROVIDER_ID);
      const current = getAntigravityProviderSettings(stored);
      updateAntigravityProviderSettings(target, { ...current, visibleModels: getAntigravityMigratedVisibleModelIds(current) });
      return hasStoredConfigNormalization(storedConfig, getProviderConfig(target, ANTIGRAVITY_PROVIDER_ID));
    },
  },
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER,
  workspace: antigravityWorkspaceRegistration,
};
