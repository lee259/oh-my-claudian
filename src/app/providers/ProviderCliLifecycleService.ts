import { createHash } from 'node:crypto';

import type { ManagedCommandRequest, ManagedCommandResult } from '@/core/process/ManagedCommandRunner';
import type { CliProviderMetadata } from '@/core/providers/cli/CliProviderMetadata';
import { compareVersions, extractVersion, isUpdateAvailable } from '@/core/providers/cli/CliVersionUtils';
import type {
  ProviderCliAction,
  ProviderCliActionPlan,
  ProviderCliLifecyclePort,
  ProviderCliSnapshot,
  ProviderCliTarget,
} from '@/core/providers/cli/ProviderCliLifecycle';
import { sanitizeDiagnosticMessage } from '@/core/providers/ProviderDiagnostics';
import type { ProviderId, ProviderTransitionOwnerContext } from '@/core/providers/types';

interface ProviderEntry {
  providerId: ProviderId;
  displayName: string;
  enabled: boolean;
  metadata: CliProviderMetadata;
}

type Installation = NonNullable<Awaited<ReturnType<ProviderCliLifecycleServiceOptions['resolveInstall']>>>;

export interface ProviderCliLifecycleServiceOptions {
  prepareDetection?(options: { force?: boolean; signal: AbortSignal }): Promise<void>;
  providers(): readonly ProviderEntry[];
  resolveTarget(id: ProviderId, context?: ProviderTransitionOwnerContext): Promise<ProviderCliTarget | null>;
  resolveInstall(id: ProviderId): Promise<{
    command: { command: string; args: string[] };
    environment: NodeJS.ProcessEnv;
    cwd: string;
  } | null>;
  resetResolver(id: ProviderId): Promise<void>;
  latestVersion(packageName: string): Promise<string | null>;
  run(request: ManagedCommandRequest): Promise<ManagedCommandResult>;
  transition<T>(id: ProviderId, work: (context: ProviderTransitionOwnerContext) => Promise<T>): Promise<T>;
  refreshModels(id: ProviderId, context: ProviderTransitionOwnerContext): Promise<void>;
  publishModels(id: ProviderId): Promise<void>;
  now?: () => number;
}

interface PreparedAction {
  fingerprint: string;
  installation: Installation;
}

/** Application-owned installation snapshots and operations; no DOM or provider-native policy. */
export class ProviderCliLifecycleService implements ProviderCliLifecyclePort {
  private readonly snapshots = new Map<ProviderId, ProviderCliSnapshot>();
  private readonly checks = new Map<ProviderId, Promise<ProviderCliSnapshot>>();
  private readonly readinessChecks = new Map<ProviderId, Promise<ProviderCliSnapshot>>();
  private readonly updateTargets = new Map<ProviderId, boolean>();
  private readonly latestVersions = new Map<string, { checkedAt: number; value: Promise<string | null> }>();
  private readonly listeners = new Set<(snapshot: ProviderCliSnapshot) => void>();
  private readonly plans = new WeakMap<ProviderCliActionPlan, PreparedAction>();
  private readonly busy = new Set<ProviderId>();
  private readonly abort = new AbortController();
  private readonly now: () => number;
  private disposed = false;

  constructor(private readonly options: ProviderCliLifecycleServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  getSnapshot(id: ProviderId): ProviderCliSnapshot | null {
    const snapshot = this.snapshots.get(id);
    return snapshot ? { ...snapshot, enabled: this.entry(id).enabled } : null;
  }

  getSnapshots(): readonly ProviderCliSnapshot[] {
    return [...this.snapshots.keys()].map(id => this.getSnapshot(id)!);
  }

  subscribe(listener: (snapshot: ProviderCliSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async check(id: ProviderId, options: { force?: boolean; includeLatestVersion?: boolean } = {}): Promise<ProviderCliSnapshot> {
    this.assertAvailable();
    const current = this.getSnapshot(id);
    if (this.busy.has(id) && current) return Promise.resolve(current);
    if (options.includeLatestVersion === false) return this.checkReadiness(id, options.force === true);
    const pending = this.checks.get(id);
    if (pending) return pending;
    const work = this.inspect(id, options.force === true).finally(() => this.checks.delete(id));
    this.checks.set(id, work);
    return work;
  }

  async checkEnabled(options: { force?: boolean } = {}): Promise<readonly ProviderCliSnapshot[]> {
    const ids = this.options.providers().filter(entry => entry.enabled).map(entry => entry.providerId);
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
      while (index < ids.length && !this.disposed) {
        const id = ids[index++];
        await this.check(id, options).catch(() => undefined);
      }
    }));
    return this.getSnapshots().filter(snapshot => ids.includes(snapshot.providerId));
  }

  async prepareAction(id: ProviderId, action: ProviderCliAction): Promise<ProviderCliActionPlan> {
    const snapshot = await this.check(id, { force: true });
    if (this.busy.has(id)) throw new Error('A CLI operation is already running.');
    let installation: Installation;
    let installationIdentity: string | undefined;
    if (action === 'update') {
      if (!snapshot.canUpdate || !snapshot.latestVersion) throw new Error('No verified CLI update is available.');
      const target = await this.options.resolveTarget(id);
      if (!target?.updateCommand) throw new Error('The CLI update target is unavailable.');
      installationIdentity = target.installationIdentity;
      installation = { command: target.updateCommand, environment: target.environment, cwd: target.cwd };
    } else {
      if (!snapshot.canInstall) throw new Error('This CLI cannot be installed automatically.');
      const resolved = await this.options.resolveInstall(id);
      if (!resolved) throw new Error('The CLI installer is unavailable.');
      installation = resolved;
    }
    const plan: ProviderCliActionPlan = Object.freeze({
      providerId: id, action, path: snapshot.path,
      targetVersion: snapshot.latestVersion,
      command: Object.freeze({
        command: installation.command.command,
        args: Object.freeze([...installation.command.args]) as unknown as string[],
      }),
    });
    this.plans.set(plan, { installation, fingerprint: this.fingerprint(installation, snapshot.path, installationIdentity) });
    return plan;
  }

  async executeAction(plan: ProviderCliActionPlan): Promise<ProviderCliSnapshot> {
    this.assertAvailable();
    const prepared = this.plans.get(plan);
    if (!prepared) throw new Error('The CLI operation plan is invalid or has already been used.');
    this.plans.delete(plan);
    const id = plan.providerId;
    if (this.busy.has(id)) throw new Error('A CLI operation is already running.');
    this.busy.add(id);
    let snapshot = this.getSnapshot(id)!;
    let commandResult: ManagedCommandResult | undefined;
    let verificationError: string | undefined;
    let errorSource: 'upstream' | 'process' | 'verification' | 'local' = 'local';
    this.publish({ ...snapshot, operation: { action: plan.action, status: 'running' } });
    try {
      snapshot = await this.options.transition(id, async context => {
        this.assertAvailable();
        const target = await this.options.resolveTarget(id, context);
        const installation = plan.action === 'update' && target?.updateCommand
          ? { command: target.updateCommand, environment: target.environment, cwd: target.cwd }
          : plan.action === 'install' ? await this.options.resolveInstall(id) : null;
        if (!installation || this.fingerprint(installation, target?.path ?? null, target?.installationIdentity) !== prepared.fingerprint) {
          throw new Error('The CLI target changed. Check again before confirming this operation.');
        }
        const result = await this.options.run({
          command: installation.command.command, args: installation.command.args,
          env: installation.environment, cwd: installation.cwd,
          signal: this.abort.signal, timeoutMs: 300_000,
          stdoutLimitBytes: 1_048_576, captureStderr: true, outputLimitBehavior: 'truncate',
        });
        commandResult = {
          ...result,
          stdout: this.message(result.stdout),
          ...(result.stderr !== undefined ? { stderr: this.message(result.stderr) } : {}),
          ...(result.error ? { error: this.message(result.error) } : {}),
        };
        this.assertAvailable();
        await this.options.resetResolver(id);
        const after = await this.inspectTarget(id, context);
        snapshot = { ...after, latestVersion: plan.targetVersion };
        if (result.exitCode !== 0 || result.termination) {
          const reply = this.commandReply(commandResult);
          errorSource = reply ? 'upstream' : 'process';
          throw new Error(reply || result.error || result.termination || `CLI exited with code ${result.exitCode}.`);
        }
        if (after.status !== 'ready' || !after.version
          || (plan.action === 'update' && (!plan.targetVersion || compareVersions(after.version, plan.targetVersion) < 0))) {
          verificationError = `CLI verification failed: expected ${plan.targetVersion ?? 'an installed version'}, observed ${after.error ?? after.version ?? 'version unavailable'}.`;
          const reply = this.commandReply(commandResult);
          errorSource = reply ? 'upstream' : 'verification';
          throw new Error(reply || verificationError);
        }
        let warning: string | undefined;
        try {
          await this.options.refreshModels(id, { ...context, signal: this.abort.signal });
        } catch (error) {
          warning = this.message(error);
        }
        return {
          ...after, latestVersion: plan.targetVersion,
          operation: { action: plan.action, status: 'verified', commandResult, ...(warning ? { warning } : {}) },
        };
      });
      this.assertAvailable();
      try {
        await this.options.publishModels(id);
      } catch (error) {
        snapshot.operation = { action: plan.action, status: 'verified', commandResult, warning: this.message(error) };
      }
    } catch (error) {
      snapshot = {
        ...snapshot,
        operation: { action: plan.action, status: 'failed', error: this.message(error), errorSource, commandResult, verificationError },
      };
    } finally {
      this.busy.delete(id);
    }
    this.publish(snapshot);
    return this.getSnapshot(id) ?? snapshot;
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.listeners.clear();
    this.latestVersions.clear();
    this.updateTargets.clear();
  }

  private async inspect(id: ProviderId, force: boolean): Promise<ProviderCliSnapshot> {
    const snapshot = await this.checkReadiness(id, force, false);
    if (this.busy.has(id)) return this.getSnapshot(id) ?? snapshot;
    const owner = this.snapshots.get(id);
    const latestVersion = await this.latest(id, this.entry(id).metadata, snapshot.version, force);
    this.assertAvailable();
    // A newer probe or operation owns publication after it replaces this snapshot.
    if (this.snapshots.get(id) !== owner) return this.getSnapshot(id) ?? snapshot;
    const canUpdate = (this.updateTargets.get(id) ?? false) && isUpdateAvailable(snapshot.version, latestVersion);
    if (owner?.status !== 'checking' && owner?.latestVersion === latestVersion && owner?.canUpdate === canUpdate) {
      return this.getSnapshot(id) ?? snapshot;
    }
    this.publish({ ...snapshot, latestVersion, canUpdate });
    return this.getSnapshot(id) ?? snapshot;
  }

  private async checkReadiness(id: ProviderId, force: boolean, publishResult = true): Promise<ProviderCliSnapshot> {
    const current = this.getSnapshot(id);
    if (this.busy.has(id) && current) return current;
    const pending = this.readinessChecks.get(id);
    if (pending) return pending;
    if (!force && current && current.status !== 'checking'
      && this.now() - current.checkedAt < 30_000) return current;
    const work = this.inspectReadiness(id, force, publishResult).finally(() => this.readinessChecks.delete(id));
    this.readinessChecks.set(id, work);
    return work;
  }

  private async inspectReadiness(id: ProviderId, reset: boolean, publishResult: boolean): Promise<ProviderCliSnapshot> {
    const previous = this.getSnapshot(id);
    const entry = this.entry(id);
    this.publish({
      providerId: id, displayName: entry.displayName, enabled: entry.enabled,
      status: 'checking', path: previous?.path ?? null, version: previous?.version ?? null,
      latestVersion: previous?.latestVersion ?? null, error: null, checkedAt: 0,
      canInstall: false, canUpdate: false, operation: previous?.operation,
    });
    await this.options.prepareDetection?.({ force: reset, signal: this.abort.signal });
    this.assertAvailable();
    await this.options.resetResolver(id);
    const snapshot = await this.inspectTarget(id);
    this.assertAvailable();
    snapshot.latestVersion = previous?.latestVersion ?? null;
    snapshot.operation = previous?.operation;
    if (publishResult) {
      this.publish(snapshot);
      return this.getSnapshot(id) ?? snapshot;
    }
    snapshot.canUpdate = snapshot.canUpdate && isUpdateAvailable(snapshot.version, snapshot.latestVersion);
    return snapshot;
  }

  private async inspectTarget(id: ProviderId, context?: ProviderTransitionOwnerContext): Promise<ProviderCliSnapshot> {
    const entry = this.entry(id);
    const snapshot: ProviderCliSnapshot = {
      providerId: id, displayName: entry.displayName, enabled: entry.enabled,
      status: 'missing', path: null, version: null, latestVersion: null,
      error: null, checkedAt: this.now(), canInstall: false, canUpdate: false,
    };
    try {
      const target = await this.options.resolveTarget(id, context);
      if (!target) {
        this.updateTargets.set(id, false);
        snapshot.canInstall = Boolean(await this.options.resolveInstall(id));
        return snapshot;
      }
      snapshot.path = target.path;
      snapshot.updateHint = target.updateHint;
      const probe = async (command: ProviderCliTarget['versionCommand'], identity = false) => this.options.run({
        command: command.command, args: command.args, cwd: target.cwd, env: target.environment,
        signal: this.abort.signal, timeoutMs: 15_000,
        stdoutLimitBytes: identity ? 65_536 : 8192, captureStderr: true,
        ...(identity ? { outputLimitBehavior: 'truncate' as const } : {}),
      });
      if (target.identityCommand && target.identityPattern) {
        const identity = await probe(target.identityCommand, true);
        if (identity.exitCode !== 0 || identity.termination) {
          throw new Error(identity.error || this.commandReply(identity) || identity.termination || `CLI help exited with code ${identity.exitCode}.`);
        }
        if (!target.identityPattern.test(identity.stdout + (identity.stderr ?? ''))) {
          throw new Error('The configured executable does not match this provider.');
        }
      }
      const result = await probe(target.versionCommand);
      const output = result.stdout.trim() || result.stderr?.trim() || '';
      if (result.exitCode !== 0 || result.termination || !/\d+\.\d+\.\d+/u.test(output)) {
        throw new Error(result.termination ?? (output.slice(0, 200) || 'The CLI returned no valid version.'));
      }
      snapshot.status = 'ready';
      snapshot.version = extractVersion(output);
      snapshot.canUpdate = Boolean(target.updateCommand);
    } catch (error) {
      snapshot.status = 'broken';
      snapshot.error = this.message(error);
    }
    snapshot.checkedAt = this.now();
    this.updateTargets.set(id, snapshot.canUpdate);
    return snapshot;
  }

  private async latest(id: ProviderId, metadata: CliProviderMetadata, version: string | null, force: boolean): Promise<string | null> {
    const major = version ? Number(version.split('.')[0]) : null;
    const packageName = (major === null ? null : metadata.latestVersionNpmPackagesByMajor?.[major]) ?? metadata.npmPackage;
    if (!packageName && !metadata.latestRelease) return null;
    const cacheKey = metadata.latestRelease ? `provider:${id}` : `npm:${packageName}`;
    const cached = this.latestVersions.get(cacheKey);
    if (!force && cached && this.now() - cached.checkedAt < 15 * 60_000) return cached.value;
    const value = (metadata.latestRelease ? metadata.latestRelease() : this.options.latestVersion(packageName!)).catch(() => null);
    this.latestVersions.set(cacheKey, { checkedAt: this.now(), value });
    return value;
  }

  private publish(snapshot: ProviderCliSnapshot): void {
    if (this.disposed) return;
    snapshot.canUpdate = snapshot.canUpdate && isUpdateAvailable(snapshot.version, snapshot.latestVersion);
    const published = Object.freeze({
      ...snapshot,
      ...(snapshot.operation ? { operation: Object.freeze({ ...snapshot.operation }) } : {}),
    });
    this.snapshots.set(snapshot.providerId, published);
    for (const listener of this.listeners) {
      try { listener(published); }
      catch { /* A presentation failure must not change the operation's outcome. */ }
    }
  }

  private entry(id: ProviderId): ProviderEntry {
    const entry = this.options.providers().find(value => value.providerId === id);
    if (!entry) throw new Error('This provider has no CLI lifecycle adapter.');
    return entry;
  }

  private fingerprint(installation: Installation, path: string | null, identity?: string): string {
    return createHash('sha256').update(JSON.stringify({ ...installation, path, identity })).digest('hex');
  }

  private commandReply(result: ManagedCommandResult): string {
    return [result.stderr?.trim(), result.stdout.trim()].filter(Boolean).join('\n');
  }

  private message(error: unknown): string {
    return sanitizeDiagnosticMessage(error instanceof Error ? error.message : String(error));
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('CLI lifecycle service has been disposed.');
  }
}
