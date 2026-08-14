import type { ProviderWorkspaceRegistration, ProviderWorkspaceServices } from '../../../core/providers/types';
import { DshCliResolver } from '../runtime/DshCliResolver';
import { dshSettingsTabRenderer } from '../ui/DshSettingsTab';

export interface DshWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: DshCliResolver;
}

export const dshWorkspaceRegistration: ProviderWorkspaceRegistration<DshWorkspaceServices> = {
  initialize: async () => ({
    cliResolver: new DshCliResolver(),
    settingsTabRenderer: dshSettingsTabRenderer,
  }),
};
