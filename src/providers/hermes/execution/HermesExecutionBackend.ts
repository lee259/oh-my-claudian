import type {
  ProviderExecutionBackend,
  ProviderExecutionSession,
  ProviderSessionConfig,
} from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';

import type { DefaultHermesAcpSessionKernel} from './HermesAcpSessionKernel';
import { type HermesAcpSessionKernel } from './HermesAcpSessionKernel';
import { HermesExecutionSession } from './HermesExecutionSession';

export interface HermesExecutionBackendOptions {
  readonly createKernel?: (options: ConstructorParameters<typeof DefaultHermesAcpSessionKernel>[0]) => HermesAcpSessionKernel;
}

export class HermesExecutionBackend implements ProviderExecutionBackend {
  readonly providerId = 'hermes' as const;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly options: HermesExecutionBackendOptions = {},
  ) {}

  createSession(config: ProviderSessionConfig): ProviderExecutionSession {
    return new HermesExecutionSession(this.plugin, config, this.options);
  }
}
