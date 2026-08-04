import type { ProviderInteractionPort, ProviderSessionConfig } from '../../../core/execution';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import {
  DefaultOmpAcpSessionKernel,
  type OmpAcpSessionKernel,
  type OmpAcpSessionKernelOptions,
} from '../execution/OmpAcpSessionKernel';
import {
  normalizeOmpConfigOptionModels,
  type OmpDiscoveredModel,
} from '../models';

export interface OmpModelDiscoveryServiceOptions {
  readonly createKernel?: (options: OmpAcpSessionKernelOptions) => OmpAcpSessionKernel;
}

export class OmpModelDiscoveryService {
  private readonly createKernel: (options: OmpAcpSessionKernelOptions) => OmpAcpSessionKernel;

  constructor(
    private readonly plugin: ProviderHost,
    options: OmpModelDiscoveryServiceOptions = {},
  ) {
    this.createKernel = options.createKernel
      ?? (kernelOptions => new DefaultOmpAcpSessionKernel(kernelOptions));
  }

  async discover(signal?: AbortSignal): Promise<OmpDiscoveredModel[]> {
    signal?.throwIfAborted();
    const kernel = this.createKernel({
      config: getMetadataSessionConfig(this.plugin),
      getActiveTurnId: () => null,
      onClosed: () => undefined,
      onNotification: () => undefined,
      plugin: this.plugin,
    });
    try {
      await kernel.connect();
      signal?.throwIfAborted();
      const session = await kernel.openSession();
      signal?.throwIfAborted();
      const models = normalizeOmpConfigOptionModels(session.configOptions);
      return models;
    } finally {
      await kernel.dispose();
    }
  }

}

function getMetadataSessionConfig(plugin: ProviderHost): ProviderSessionConfig {
  const adapter = plugin.app.vault.adapter as { basePath?: unknown };
  return {
    interactionPort: DENY_INTERACTION_PORT,
    lifecycle: 'ephemeral',
    nativePersistence: 'disabled-if-supported',
    vaultWorkingDirectory: typeof adapter.basePath === 'string' && adapter.basePath
      ? adapter.basePath
      : process.cwd(),
  };
}

const DENY_INTERACTION_PORT: ProviderInteractionPort = {
  askUserQuestion: async ({ interactionId }) => ({ answers: null, interactionId }),
  dismissInteraction: () => undefined,
  requestApproval: async ({ interactionId }) => ({ decision: 'deny', interactionId }),
  requestPlanDecision: async ({ interactionId }) => ({ decision: null, interactionId }),
};
