import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

/** Cursor Agent CLI lifecycle metadata; prefer its unambiguous executable name. */
export const cursorCliMetadata: CliProviderMetadata = {
  binaryName: 'cursor-agent',
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
