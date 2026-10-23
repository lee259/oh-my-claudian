import type { ProviderExecutionBackend,  ProviderSessionConfig } from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { SlashCommand } from '@/core/types';

import type { DeepSeekHost } from '../runtime/DeepSeekHost';
import { DeepSeekExecutionSession } from './DeepSeekExecutionSession';

export class DeepSeekExecutionBackend implements ProviderExecutionBackend {
  readonly providerId = 'deepseek';
  constructor(private readonly host: ProviderHost, private readonly deepseek: () => DeepSeekHost, private readonly commandCatalog?: { setCommandSnapshot(commands: SlashCommand[]): void }) {}
  createSession(config: ProviderSessionConfig): DeepSeekExecutionSession {
    return new DeepSeekExecutionSession(this.host, config, this.deepseek(), this.commandCatalog);
  }
}
