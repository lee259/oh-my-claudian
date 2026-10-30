import { NOOP_TASK_RESULT_INTERPRETER } from '@/core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '@/core/providers/providerConfig';
import { hasStoredConfigNormalization } from '@/core/providers/settings/storedSettings';
import type { ProviderModule } from '@/core/providers/types';

import { hermesWorkspaceRegistration } from './app/HermesWorkspaceServices';
import { HERMES_PROVIDER_CAPABILITIES } from './capabilities';
import { hermesSettingsReconciler } from './env/HermesSettingsReconciler';
import { HermesExecutionBackend } from './execution/HermesExecutionBackend';
import { HermesConversationHistoryService } from './history/HermesConversationHistoryService';
import { hermesCliLifecycle } from './runtime/HermesCliLifecycle';
import { getHermesProviderSettings, updateHermesProviderSettings } from './settings';
import { hermesChatUIConfig } from './ui/HermesChatUIConfig';
export const hermesProviderRegistration: ProviderModule = {
  id: 'hermes', displayName: 'Hermes', blankTabOrder: 12,
  capabilities: HERMES_PROVIDER_CAPABILITIES, chatUIConfig: hermesChatUIConfig,
  cliLifecycle: hermesCliLifecycle, createExecutionBackend: plugin => new HermesExecutionBackend(plugin),
  historyService: new HermesConversationHistoryService(),
  environmentKeyPatterns: [/^HERMES_/i],
  isEnabled: settings => getHermesProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateHermesProviderSettings(settings, { enabled }),
  settingsReconciler: hermesSettingsReconciler,
  settingsStorage: { hostScopedFields: ['cliPathsByHost'], normalizeStored(target, stored) {
    const config = getProviderConfig(stored, 'hermes');
    updateHermesProviderSettings(target, getHermesProviderSettings(stored));
    return hasStoredConfigNormalization(config, getProviderConfig(target, 'hermes'));
  } },
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER, workspace: hermesWorkspaceRegistration,
};
