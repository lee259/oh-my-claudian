import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

/** OMP (Oh My Pi) CLI lifecycle metadata. */
export const ompCliMetadata: CliProviderMetadata = {
  binaryName: 'omp',
  displayName: 'OMP',
  // Used only for the latest-version check; installs keep the official
  // installer because it ships the native binary rather than an npm global.
  npmPackage: '@oh-my-pi/pi-coding-agent',
  install: {
    command: 'bash',
    args: ['-lc', 'curl -fsSL https://omp.sh/install | bash'],
  },
  update: { command: 'omp', args: ['update'] },
  platform: {
    win32: {
      install: {
        command: 'powershell',
        args: ['-NoProfile', '-Command', "irm 'https://omp.sh/install.ps1' | iex"],
      },
    },
  },
};
