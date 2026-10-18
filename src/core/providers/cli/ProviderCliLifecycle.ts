import type { ManagedCommandResult } from '@/core/process/ManagedCommandRunner';

import type { ProviderHost } from '../ProviderHost';
import type { ProviderId, ProviderTransitionOwnerContext } from '../types';
import type { CliCommand, CliProviderMetadata } from './CliProviderMetadata';

export interface ProviderCliTarget {
  /** Provider-owned installation identity; never published to the UI. */
  installationIdentity?: string;
  updateHint?: string;
  path: string;
  versionCommand: CliCommand;
  updateCommand: CliCommand | null;
  environment: NodeJS.ProcessEnv;
  cwd: string;
  identityCommand?: CliCommand;
  identityPattern?: RegExp;
}

export interface ProviderCliLifecycleAdapter {
  metadata: CliProviderMetadata;
  resolveTarget(
    host: ProviderHost,
    context?: ProviderTransitionOwnerContext,
  ): Promise<ProviderCliTarget | null>;
  resolveInstallCommand(host: ProviderHost): Promise<{
    command: CliCommand;
    environment: NodeJS.ProcessEnv;
    cwd: string;
  } | null>;
}

export type ProviderCliAction = 'install' | 'update';

export interface ProviderCliOperation {
  action: ProviderCliAction;
  status: 'running' | 'verified' | 'failed';
  /** Native updater reply, independent of Claudian's result verification. */
  commandResult?: ManagedCommandResult;
  verificationError?: string;
  errorSource?: 'upstream' | 'process' | 'verification' | 'local';
  error?: string;
  warning?: string;
}

/** Installation state only; a valid version is not proof of authentication. */
export interface ProviderCliSnapshot {
  updateHint?: string;
  providerId: ProviderId;
  displayName: string;
  enabled: boolean;
  status: 'checking' | 'missing' | 'broken' | 'ready';
  path: string | null;
  version: string | null;
  latestVersion: string | null;
  error: string | null;
  checkedAt: number;
  canInstall: boolean;
  canUpdate: boolean;
  operation?: ProviderCliOperation;
}

/** An opaque, single-use plan; commands shown here are exactly those executed. */
export interface ProviderCliActionPlan {
  providerId: ProviderId;
  action: ProviderCliAction;
  command: CliCommand;
  targetVersion: string | null;
  path: string | null;
}

export interface ProviderCliLifecyclePort {
  getSnapshot(providerId: ProviderId): ProviderCliSnapshot | null;
  getSnapshots(): readonly ProviderCliSnapshot[];
  subscribe(listener: (snapshot: ProviderCliSnapshot) => void): () => void;
  /** Set includeLatestVersion to false for execution readiness without update discovery. */
  check(providerId: ProviderId, options?: { force?: boolean; includeLatestVersion?: boolean }): Promise<ProviderCliSnapshot>;
  checkEnabled(options?: { force?: boolean }): Promise<readonly ProviderCliSnapshot[]>;
  prepareAction(providerId: ProviderId, action: ProviderCliAction): Promise<ProviderCliActionPlan>;
  executeAction(plan: ProviderCliActionPlan): Promise<ProviderCliSnapshot>;
}
