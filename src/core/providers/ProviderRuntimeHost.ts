import type {
  ProviderCliResolutionContext,
  ProviderId,
} from './types';

/** Selection data a provider configuration decoder may use to retain referenced models. */
export interface ProviderSelectionInputs {
  readonly referencedModelIds: readonly string[];
}

/**
 * Provider-scoped runtime view used by provider-owned configuration and metadata
 * services. It exposes committed settings only; callers never mutate the host.
 */
export interface ProviderRuntimeHost {
  readonly config: Readonly<Record<string, unknown>>;
  readonly selection: ProviderSelectionInputs;
  readonly environmentText: string;
  readonly clientVersion?: string;
  readonly workingDirectory: string;

  resolveCliPath(context?: ProviderCliResolutionContext): Promise<string | null>;
  updateConfig(
    mutation: (
      config: Record<string, unknown>,
      selection: ProviderSelectionInputs,
    ) => boolean | Promise<boolean>,
  ): Promise<boolean>;
  notifyChatOptionsChanged(): void;
}

export type ProviderRuntimeHostProviderId = ProviderId;
