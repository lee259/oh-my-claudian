import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

export const claudeCliMetadata: CliProviderMetadata = {
  binaryName: 'claude',
  displayName: 'Claude Code',
  npmPackage: '@anthropic-ai/claude-code',
  update: {
    command: 'claude',
    args: ['update'],
  },
};
