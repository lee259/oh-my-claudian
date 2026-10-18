import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

export const codexCliMetadata: CliProviderMetadata = {
  binaryName: 'codex',
  displayName: 'Codex',
  npmPackage: '@openai/codex',
  update: {
    command: 'codex',
    args: ['update'],
  },
};
