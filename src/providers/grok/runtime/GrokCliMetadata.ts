import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

/** Grok Build CLI lifecycle metadata. */
export const grokCliMetadata: CliProviderMetadata = {
  binaryName: 'grok',
  displayName: 'Grok',
  install: {
    command: 'bash',
    args: ['-lc', 'curl -fsSL https://x.ai/cli/install.sh | bash'],
  },
  platform: {
    win32: {
      install: {
        command: 'powershell',
        args: ['-NoProfile', '-Command', "irm 'https://x.ai/cli/install.ps1' | iex"],
      },
    },
  },
};
