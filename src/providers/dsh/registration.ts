import { NOOP_TASK_RESULT_INTERPRETER } from '../../core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '../../core/providers/providerConfig';
import { assessProviderReadiness } from '../../core/providers/ProviderReadiness';
import { hasStoredConfigNormalization } from '../../core/providers/settings/storedSettings';
import type { ProviderModule } from '../../core/providers/types';
import { dshWorkspaceRegistration } from './app/DshWorkspaceServices';
import { DSH_PROVIDER_CAPABILITIES } from './capabilities';
import { dshSettingsReconciler } from './env/DshSettingsReconciler';
import { DshExecutionBackend } from './execution/DshExecutionBackend';
import { DshConversationHistoryService } from './history/DshConversationHistoryService';
import { getDshProviderSettings, updateDshProviderSettings } from './settings';
import { dshChatUIConfig } from './ui/DshChatUIConfig';

export const dshProviderRegistration: ProviderModule = {
  id: 'dsh',
  blankTabOrder: 14,
  capabilities: DSH_PROVIDER_CAPABILITIES,
  chatUIConfig: dshChatUIConfig,
  settingsTabLabel: 'DSH',
  collectDiagnostics: async (context) => {
    const settings = getDshProviderSettings(context.settings);
    const cliPath = context.resolveCliPath ? await context.resolveCliPath() : null;
    return {
      readiness: assessProviderReadiness({
        cliPath,
        discoveredModelCount: settings.discoveredModels.length,
        enabled: settings.enabled,
        selectedModelCount: settings.visibleModels.length,
      }),
      environment: {
        cliPathConfigured: Boolean(cliPath),
        workingDirectoryAvailable: true,
      },
    };
  },
  createExecutionBackend: plugin => new DshExecutionBackend(plugin),
  displayName: 'DeepSeek Harness',
  environmentKeyPatterns: [/^DEEPSEEK_/i, /^DSH_/i],
  historyService: new DshConversationHistoryService(),
  isEnabled: settings => getDshProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateDshProviderSettings(settings, { enabled }),
  settingsReconciler: dshSettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    normalizeStored(target, stored) {
      const storedConfig = getProviderConfig(stored, 'dsh');
      updateDshProviderSettings(target, getDshProviderSettings(stored));
      return hasStoredConfigNormalization(storedConfig, getProviderConfig(target, 'dsh'));
    },
  },
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER,
  workspace: dshWorkspaceRegistration,
};
