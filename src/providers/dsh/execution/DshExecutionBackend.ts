import type { ProviderExecutionBackend, ProviderExecutionSession, ProviderSessionConfig } from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';

import { DshExecutionSession, type DshExecutionSessionOptions } from './DshExecutionSession';

export class DshExecutionBackend implements ProviderExecutionBackend {
  readonly providerId = 'dsh' as const;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly options: DshExecutionSessionOptions = {},
  ) {}

  createSession(config: ProviderSessionConfig): ProviderExecutionSession {
    return new DshExecutionSession(this.plugin, config, this.options);
  }
}
