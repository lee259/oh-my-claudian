import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

/** Cursor Agent CLI (`agent`) lifecycle metadata. */
export const cursorCliMetadata: CliProviderMetadata = {
  binaryName: 'agent',
  displayName: 'Cursor',
  install: {
    command: 'bash',
    args: ['-lc', 'curl -fsSL https://cursor.com/install | bash'],
  },
  platform: {
    win32: {
      install: {
        command: 'powershell',
        args: ['-NoProfile', '-Command', "irm 'https://cursor.com/install?win32=true' | iex"],
      },
    },
  },
};
