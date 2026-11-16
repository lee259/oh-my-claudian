import type {
  ProviderExecutionBackend,
  ProviderExecutionSession,
  ProviderSessionConfig,
} from '../../../core/execution';
import type { ObsidianWorkspaceToolBridge } from '../../../core/obsidian/ObsidianWorkspaceToolBridge';
import type { ProviderRuntimeHost } from '../../../core/providers/ProviderRuntimeHost';
import {
  AntigravityExecutionSession,
  type AntigravityExecutionSessionOptions,
} from './AntigravityExecutionSession';

export interface AntigravityExecutionBackendOptions extends AntigravityExecutionSessionOptions {
  readonly obsidianWorkspaceToolBridge?: ObsidianWorkspaceToolBridge;
}

export class AntigravityExecutionBackend implements ProviderExecutionBackend {
  readonly providerId = 'antigravity' as const;

  constructor(
    private readonly host: ProviderRuntimeHost,
    private readonly options: AntigravityExecutionBackendOptions = {},
  ) {}

  createSession(config: ProviderSessionConfig): ProviderExecutionSession {
    return new AntigravityExecutionSession(this.host, config, this.options);
  }
}
