import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

/**
 * Cursor Agent CLI (`agent`). The CLI ships with the Cursor desktop app, so
 * there is no standalone npm install path; install/update are intentionally
 * omitted, while version probing still works through the binary name.
 */
export const cursorCliMetadata: CliProviderMetadata = {
  binaryName: 'agent',
  displayName: 'Cursor',
};
