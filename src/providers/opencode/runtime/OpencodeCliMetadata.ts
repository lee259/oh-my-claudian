import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

export const opencodeCliMetadata: CliProviderMetadata = {
  binaryName: 'opencode',
  displayName: 'OpenCode',
  npmPackage: 'opencode-ai',
  installerUrl: 'https://opencode.ai/install',
  update: {
    command: 'opencode',
    args: ['upgrade'],
  },
};
