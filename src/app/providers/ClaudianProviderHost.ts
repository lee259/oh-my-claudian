import type { App } from 'obsidian';

import type { SharedAppStorage } from '../../core/bootstrap/storage';
import type {
  ProviderExecutionLifecycleRegistry,
  ProviderExecutionTransitionScope,
} from '../../core/execution';
import type { ProviderHost } from '../../core/providers/ProviderHost';
import type {
  ProviderCliResolutionContext,
  ProviderId,
} from '../../core/providers/types';
import type { ClaudianSettings } from '../../core/types';
import type { EnvironmentScope } from '../../core/types/settings';

interface ClaudianProviderHostDependencies {
  readonly app: App;
  readonly executionLifecycleRegistry: ProviderExecutionLifecycleRegistry;
  readonly settings: ClaudianSettings;
  readonly storage: SharedAppStorage;
  readonly manifest?: { version?: string };

  saveSettings(): Promise<void>;
  mutateSettings(
    mutation: (settings: ClaudianSettings) => void | Promise<void>,
  ): Promise<void>;
  mutateSettingsConditionally(
    mutation: (settings: ClaudianSettings) => boolean | Promise<boolean>,
  ): Promise<void>;
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
  normalizeModelVariantSettings(): boolean;
  getActiveEnvironmentVariables(providerId: ProviderId): string;
  getEnvironmentVariablesForScope(scope: EnvironmentScope): string;
  applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void>;
  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void>;
  applyProviderRuntimeSettings(
    providerIds: ProviderId[],
    mutation: (settings: ClaudianSettings) => void | Promise<void>,
    onApplied?: () => void | Promise<void>,
  ): Promise<void>;
  getResolvedProviderCliPath(
    providerId: ProviderId,
    context?: ProviderCliResolutionContext,
  ): Promise<string | null>;
  runProviderExecutionTransition<T>(
    providerIds: ProviderId[],
    mutation: (scope: ProviderExecutionTransitionScope) => Promise<T>,
    parentScope?: ProviderExecutionTransitionScope,
  ): Promise<T>;
  notifyProviderChatOptionsChanged(providerId: ProviderId): void;
}

/** Delegates provider-facing capabilities to the application composition root. */
export class ClaudianProviderHost implements ProviderHost {
  constructor(private readonly plugin: ClaudianProviderHostDependencies) {}

  get app() {
    return this.plugin.app;
  }

  get executionLifecycleRegistry() {
    return this.plugin.executionLifecycleRegistry;
  }

  get settings() {
    return this.plugin.settings;
  }

  get storage() {
    return this.plugin.storage;
  }

  get manifest() {
    return this.plugin.manifest;
  }

  saveSettings(): Promise<void> {
    return this.plugin.saveSettings();
  }

  mutateSettings(
    mutation: (settings: ClaudianSettings) => void | Promise<void>,
  ): Promise<void> {
    return this.plugin.mutateSettings(mutation);
  }

  mutateSettingsConditionally(
    mutation: (settings: ClaudianSettings) => boolean | Promise<boolean>,
  ): Promise<void> {
    return this.plugin.mutateSettingsConditionally(mutation);
  }

  loadData(): Promise<unknown> {
    return this.plugin.loadData();
  }

  saveData(data: unknown): Promise<void> {
    return this.plugin.saveData(data);
  }

  normalizeModelVariantSettings(): boolean {
    return this.plugin.normalizeModelVariantSettings();
  }

  getActiveEnvironmentVariables(providerId: ProviderId): string {
    return this.plugin.getActiveEnvironmentVariables(providerId);
  }

  getEnvironmentVariablesForScope(scope: EnvironmentScope): string {
    return this.plugin.getEnvironmentVariablesForScope(scope);
  }

  applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void> {
    return this.plugin.applyEnvironmentVariables(scope, envText);
  }

  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    return this.plugin.applyEnvironmentVariablesBatch(updates);
  }

  applyProviderRuntimeSettings(
    providerIds: ProviderId[],
    mutation: (settings: ClaudianSettings) => void | Promise<void>,
    onApplied?: () => void | Promise<void>,
  ): Promise<void> {
    return this.plugin.applyProviderRuntimeSettings(providerIds, mutation, onApplied);
  }

  async getResolvedProviderCliPath(
    providerId: ProviderId,
    context?: ProviderCliResolutionContext,
  ): Promise<string | null> {
    return this.plugin.getResolvedProviderCliPath(providerId, context);
  }

  runProviderExecutionTransition<T>(
    providerIds: ProviderId[],
    mutation: (scope: ProviderExecutionTransitionScope) => Promise<T>,
    parentScope?: ProviderExecutionTransitionScope,
  ): Promise<T> {
    if (!parentScope) {
      return this.plugin.runProviderExecutionTransition(providerIds, mutation);
    }
    return this.plugin.runProviderExecutionTransition(
      providerIds,
      mutation,
      parentScope,
    );
  }

  notifyProviderChatOptionsChanged(providerId: ProviderId): void {
    void this.plugin.notifyProviderChatOptionsChanged(providerId);
  }
}
