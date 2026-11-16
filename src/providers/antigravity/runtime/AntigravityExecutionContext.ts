import type { ProviderRuntimeHost } from '@/core/providers/ProviderRuntimeHost';
import type { ProviderCliResolutionContext } from '@/core/providers/types';
import type { AcpSubprocessLaunchSpec } from '@/providers/acp';

import { buildAntigravityRuntimeEnv } from './AntigravityRuntimeEnvironment';

/** agy runs on the host only; WSL installations are not supported. */
export async function resolveAntigravityLaunchSpec(
  host: ProviderRuntimeHost,
  args: readonly string[],
  hostCwd = host.workingDirectory,
  ownerContext?: ProviderCliResolutionContext,
): Promise<AcpSubprocessLaunchSpec> {
  const command = await host.resolveCliPath(ownerContext) ?? 'agy';
  return {
    args: [...args],
    command,
    cwd: hostCwd,
    env: buildAntigravityRuntimeEnv(host.environmentText, command),
  };
}
