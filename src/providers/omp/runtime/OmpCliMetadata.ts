import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

/** OMP (Oh My Pi) CLI lifecycle metadata. */
export const ompCliMetadata: CliProviderMetadata = {
  binaryName: 'omp',
  displayName: 'OMP',
  install: {
    command: 'bash',
    args: ['-lc', 'curl -fsSL https://omp.sh/install | bash'],
  },
  platform: {
    win32: {
      install: {
        command: 'powershell',
        args: ['-NoProfile', '-Command', "irm 'https://omp.sh/install.ps1' | iex"],
      },
    },
  },
};
