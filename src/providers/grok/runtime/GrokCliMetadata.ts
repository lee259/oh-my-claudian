import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

/**
 * Grok Build CLI. The official install method is not distributed via a
 * stable public npm package name, so install/update are intentionally
 * omitted; version probing still works through the binary name.
 */
export const grokCliMetadata: CliProviderMetadata = {
  binaryName: 'grok',
  displayName: 'Grok',
};
