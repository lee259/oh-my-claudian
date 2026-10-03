import type { ProviderHost } from '../../../core/providers/ProviderHost';
import {
  type CursorAcpSessionKernel,
  type CursorAcpSessionKernelOptions,
  DefaultCursorAcpSessionKernel,
} from '../execution/CursorAcpSessionKernel';
import {
  type CursorDiscoveredModel,
  normalizeCursorDiscoveredModels,
} from '../models';
import {
  getCursorMetadataSessionConfig,
  removeUnusedCursorProbeSession,
} from './CursorMetadataSession';

export interface CursorModelCatalog {
  models: CursorDiscoveredModel[];
}

export interface CursorModelDiscoveryServiceOptions {
  readonly createKernel?: (options: CursorAcpSessionKernelOptions) => CursorAcpSessionKernel;
  readonly removeProbeSession?: (sessionId: string) => Promise<void>;
}

export class CursorModelDiscoveryService {
  private readonly createKernel: (options: CursorAcpSessionKernelOptions) => CursorAcpSessionKernel;
  private readonly removeProbeSession: (sessionId: string) => Promise<void>;

  constructor(
    private readonly plugin: ProviderHost,
    options: CursorModelDiscoveryServiceOptions = {},
  ) {
    this.createKernel = options.createKernel
      ?? (kernelOptions => new DefaultCursorAcpSessionKernel(kernelOptions));
    this.removeProbeSession = options.removeProbeSession
      ?? (sessionId => removeUnusedCursorProbeSession(sessionId));
  }

  async discover(signal?: AbortSignal): Promise<CursorDiscoveredModel[]> {
    return (await this.discoverCatalog(signal)).models;
  }

  async discoverCatalog(signal?: AbortSignal): Promise<CursorModelCatalog> {
    signal?.throwIfAborted();
    const kernel = this.createKernel({
      config: getCursorMetadataSessionConfig(this.plugin),
      getActiveTurnId: () => null,
      onClosed: () => undefined,
      onNotification: () => undefined,
      plugin: this.plugin,
      sessionInstanceId: 'cursor-metadata',
    });
    let sessionId: string | null = null;
    try {
      await kernel.connect();
      signal?.throwIfAborted();
      const session = await kernel.openSession();
      sessionId = session.sessionId;
      signal?.throwIfAborted();
      return {
        models: normalizeCursorDiscoveredModels(session.models?.availableModels),
      };
    } finally {
      await kernel.dispose();
      if (sessionId) await this.removeProbeSession(sessionId);
    }
  }

}
