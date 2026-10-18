import { NOOP_TASK_RESULT_INTERPRETER } from '../../core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '../../core/providers/providerConfig';
import { hasStoredConfigNormalization } from '../../core/providers/settings/storedSettings';
import type { ProviderModule } from '../../core/providers/types';
import { ompWorkspaceRegistration } from './app/OmpWorkspaceServices';
import { OMP_PROVIDER_CAPABILITIES } from './capabilities';
import { ompSettingsReconciler } from './env/OmpSettingsReconciler';
import { OmpExecutionBackend } from './execution/OmpExecutionBackend';
import { OmpConversationHistoryService } from './history/OmpConversationHistoryService';
import { ompCliLifecycle } from './runtime/OmpCliLifecycle';
import { getOmpProviderSettings, isOmpProviderEnabled, updateOmpProviderSettings } from './settings';
import { ompChatUIConfig } from './ui/OmpChatUIConfig';

export const ompProviderRegistration: ProviderModule = {
  cliLifecycle: ompCliLifecycle,
  id: 'omp',
  blankTabOrder: 12,
  capabilities: OMP_PROVIDER_CAPABILITIES,
  chatUIConfig: ompChatUIConfig,
  createExecutionBackend: plugin => new OmpExecutionBackend(plugin),
  displayName: 'OMP',
  environmentKeyPatterns: [/^OMP_/i],
  historyService: new OmpConversationHistoryService(),
  isEnabled: isOmpProviderEnabled,
  setEnabled: (settings, enabled) => updateOmpProviderSettings(settings, { enabled }),
  settingsReconciler: ompSettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    normalizeStored(target, stored) {
      const storedConfig = getProviderConfig(stored, 'omp');
      updateOmpProviderSettings(target, getOmpProviderSettings(stored));
      return hasStoredConfigNormalization(
        storedConfig,
        getProviderConfig(target, 'omp'),
      );
    },
  },
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER,
  workspace: ompWorkspaceRegistration,
};
