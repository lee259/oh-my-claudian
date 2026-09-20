import type {
  ProviderExecutionBackend,
  ProviderExecutionLifecycleRegistry,
  ProviderInteractionPort,
  ProviderNativePersistence,
} from '../execution';

export interface AuxiliaryExecutionContext {
  readonly backend: ProviderExecutionBackend;
  readonly interactionPort: ProviderInteractionPort;
  readonly lifecycleRegistry: ProviderExecutionLifecycleRegistry;
  readonly nativePersistence: ProviderNativePersistence;
  readonly vaultWorkingDirectory: string;
}
