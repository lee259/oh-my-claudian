import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

/**
 * OMP (Oh My Pi) CLI. The install method is provider-documented rather than
 * a stable public npm package, so install/update are intentionally omitted;
 * version probing still works through the binary name.
 */
export const ompCliMetadata: CliProviderMetadata = {
  binaryName: 'omp',
  displayName: 'OMP',
};
