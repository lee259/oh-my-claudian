import type { CliProviderMetadata } from '../../../core/providers/cli/CliProviderMetadata';

export const piCliMetadata: CliProviderMetadata = {
  binaryName: 'pi',
  displayName: 'Pi',
  // Package migrated from @mariozechner/pi-coding-agent (last published
  // 0.73.1) to @earendil-works/pi-coding-agent. The registry name drives the
  // latest-version probe AND the npm install/update commands, so both must
  // point at the current package. Keep PiSubprocess's PI_PACKAGE_NAME in sync.
  npmPackage: '@earendil-works/pi-coding-agent',
};
