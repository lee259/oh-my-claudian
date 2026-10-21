import { randomUUID } from 'node:crypto';

import type { ProviderInteractionPort, ProviderSessionConfig } from '../../../core/execution';
import { ManagedCommandRunner, type ManagedCommandTermination } from '../../../core/process/ManagedCommandRunner';
import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { getVaultPath } from '../../../utils/path';
import {
  DefaultOmpAcpSessionKernel,
  type OmpAcpSessionKernel,
  type OmpAcpSessionKernelOptions,
} from '../execution/OmpAcpSessionKernel';
import {
  isOmpRoleSelector,
  normalizeOmpConfigChoices,
  normalizeOmpConfigOptionModels,
  normalizeOmpDiscoveredModels,
  type OmpDiscoveredModel,
} from '../models';
import { resolveOmpRuntimeEnvironment } from '../runtime/OmpRuntimeEnvironment';

const MODEL_COMMAND_TIMEOUT_MS = 20_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;

export interface OmpCatalogCommandRequest {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface OmpCatalogCommandResult {
  exitCode: number | null;
  stdout: string;
  termination?: ManagedCommandTermination;
}

export interface OmpCatalogCommandRunner {
  run(request: OmpCatalogCommandRequest): Promise<OmpCatalogCommandResult>;
}

export interface OmpModelCatalog {
  models: OmpDiscoveredModel[];
  thinking: {
    configId: string;
    currentValue: string | null;
    options: Array<{ description?: string; id: string; name: string }>;
  } | null;
}

export interface OmpModelDiscoveryServiceOptions {
  readonly createKernel?: (options: OmpAcpSessionKernelOptions) => OmpAcpSessionKernel;
  readonly runner?: OmpCatalogCommandRunner;
}

export class OmpModelDiscoveryService {
  private readonly createKernel: (options: OmpAcpSessionKernelOptions) => OmpAcpSessionKernel;
  private readonly runner: OmpCatalogCommandRunner;

  constructor(
    private readonly plugin: ProviderHost,
    options: OmpModelDiscoveryServiceOptions = {},
  ) {
    this.createKernel = options.createKernel
      ?? (kernelOptions => new DefaultOmpAcpSessionKernel(kernelOptions));
    this.runner = options.runner ?? new SpawnOmpCatalogCommandRunner();
  }

  async discover(signal?: AbortSignal): Promise<OmpDiscoveredModel[]> {
    return (await this.discoverCatalog(signal)).models;
  }

  async discoverCatalog(signal?: AbortSignal): Promise<OmpModelCatalog> {
    signal?.throwIfAborted();
    const kernel = this.createKernel({
      approvalMode: 'always-ask',
      config: getOmpMetadataSessionConfig(this.plugin),
      getActiveTurnId: () => null,
      isolateNativeSessions: true,
      onClosed: () => undefined,
      onNotification: () => undefined,
      plugin: this.plugin,
      sessionInstanceId: randomUUID(),
    });
    const abort = (): void => { void kernel.dispose().catch(() => undefined); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await kernel.connect();
      signal?.throwIfAborted();
      const session = await kernel.openSession();
      signal?.throwIfAborted();
      const thinking = normalizeOmpConfigChoices(session.configOptions, 'thought_level');
      const acpModels = normalizeOmpConfigOptionModels(session.configOptions);
      const [models, roles] = await Promise.all([
        this.discoverCliModels(signal).catch(() => acpModels),
        this.readCliCatalog(['config', 'get', 'modelRoles', '--json'], signal)
          .then(parseOmpModelRolesOutput).catch(() => []),
      ]);
      signal?.throwIfAborted();
      return {
        models: [...roles, ...(models.length > 0 ? models : acpModels)],
        thinking: thinking.configId
          ? {
            configId: thinking.configId,
            currentValue: thinking.currentValue,
            options: thinking.options,
          }
          : null,
      };
    } finally {
      signal?.removeEventListener('abort', abort);
      await kernel.dispose();
    }
  }

  /** Resolve selectors through OMP's own role grammar, without generating a turn. */
  async resolveRole(
    role: string,
    signal: AbortSignal,
    workingDirectory?: string,
  ): Promise<{ modelId: string; thinking: string | null }> {
    if (!isOmpRoleSelector(role)) throw new Error('Invalid OMP model role');
    const timeout = new AbortController();
    const combined = AbortSignal.any([signal, timeout.signal]);
    combined.throwIfAborted();
    const kernel = this.createKernel({
      approvalMode: 'always-ask',
      config: {
        ...getOmpMetadataSessionConfig(this.plugin),
        ...(workingDirectory ? { vaultWorkingDirectory: workingDirectory } : {}),
      },
      getActiveTurnId: () => null,
      isolateNativeSessions: true,
      modelSelector: role,
      onClosed: () => undefined,
      onNotification: () => undefined,
      plugin: this.plugin,
      sessionInstanceId: randomUUID(),
    });
    let disposal: Promise<void> | undefined;
    const dispose = (): Promise<void> => disposal ??= kernel.dispose();
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const abort = (): void => {
      void dispose().catch(() => undefined);
      rejectAbort(combined.reason);
    };
    combined.addEventListener('abort', abort, { once: true });
    // eslint-disable-next-line obsidianmd/prefer-window-timers -- Provider metadata probes also run outside the renderer.
    const timer = setTimeout(() => timeout.abort(new Error('OMP model role resolution timed out')), MODEL_COMMAND_TIMEOUT_MS);
    const resolve = async (): Promise<{ modelId: string; thinking: string | null }> => {
      await kernel.connect();
      combined.throwIfAborted();
      const session = await kernel.openSession();
      combined.throwIfAborted();
      const model = session.configOptions?.find(option => option.id === 'model');
      const modelId = model?.type === 'select' ? model.currentValue.trim() : '';
      if (!modelId || modelId.startsWith('@')) throw new Error(`OMP did not resolve model role ${role}`);
      const thinking = normalizeOmpConfigChoices(session.configOptions, 'thought_level').currentValue;
      return { modelId, thinking };
    };
    try {
      return await Promise.race([resolve(), aborted]);
    } finally {
      // eslint-disable-next-line obsidianmd/prefer-window-timers -- Match the provider-owned metadata timer.
      clearTimeout(timer);
      combined.removeEventListener('abort', abort);
      await dispose();
    }
  }

  private async discoverCliModels(signal?: AbortSignal): Promise<OmpDiscoveredModel[]> {
    return parseOmpModelsOutput(await this.readCliCatalog(['models', '--json'], signal));
  }

  private async readCliCatalog(args: string[], signal?: AbortSignal): Promise<string> {
    const command = await this.plugin.getResolvedProviderCliPath('omp') ?? 'omp';
    const env = await resolveOmpRuntimeEnvironment(
      process.env,
      getRuntimeEnvironmentVariables(this.plugin.settings, 'omp'),
    );
    const result = await this.runner.run({
      args,
      command,
      cwd: getVaultPath(this.plugin.app) ?? process.cwd(),
      env,
      signal,
      timeoutMs: MODEL_COMMAND_TIMEOUT_MS,
    });
    signal?.throwIfAborted();
    if (result.termination || result.exitCode !== 0) return '';
    return result.stdout;
  }

}

// OMP kind roles serve auxiliary runtimes rather than the chat agent.
const NON_CHAT_ROLES = new Set(['web', 'image', 'speech', 'dictation', 'judge']);

export function parseOmpModelRolesOutput(output: string): OmpDiscoveredModel[] {
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { return []; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const record = parsed as Record<string, unknown>;
  if (record.key !== 'modelRoles' || !record.value || typeof record.value !== 'object' || Array.isArray(record.value)) return [];
  return Object.entries(record.value).flatMap(([role, value]) => {
    if (!isOmpRoleSelector(`@${role}`) || NON_CHAT_ROLES.has(role)) return [];
    if (typeof value !== 'string' || !value.trim()) return [];
    return [{ rawId: `@${role}`, label: `@${role}`, description: value.trim() }];
  });
}

export function parseOmpModelsOutput(output: string): OmpDiscoveredModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  return normalizeOmpCliModels((parsed as Record<string, unknown>).models);
}

function normalizeOmpCliModels(value: unknown): OmpDiscoveredModel[] {
  if (!Array.isArray(value)) return [];
  return normalizeOmpDiscoveredModels(value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const selector = typeof record.selector === 'string' ? record.selector.trim() : '';
    const rawId = selector || (provider && id ? `${provider}/${id}` : id);
    return {
      description: provider && id ? `${provider}/${id}` : undefined,
      label: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : rawId,
      rawId,
    };
  }));
}

export class SpawnOmpCatalogCommandRunner implements OmpCatalogCommandRunner {
  run(request: OmpCatalogCommandRequest): Promise<OmpCatalogCommandResult> {
    return new ManagedCommandRunner().run({
      ...request,
      stdoutLimitBytes: MAX_STDOUT_BYTES,
    });
  }
}

export function getOmpMetadataSessionConfig(plugin: ProviderHost): ProviderSessionConfig {
  const adapter = plugin.app.vault.adapter as { basePath?: unknown };
  return {
    interactionPort: DENY_INTERACTION_PORT,
    lifecycle: 'ephemeral',
    nativePersistence: 'disabled-if-supported',
    vaultWorkingDirectory: typeof adapter.basePath === 'string' && adapter.basePath
      ? adapter.basePath
      : process.cwd(),
  };
}

const DENY_INTERACTION_PORT: ProviderInteractionPort = {
  askUserQuestion: async ({ interactionId }) => ({ answers: null, interactionId }),
  dismissInteraction: () => undefined,
  requestApproval: async ({ interactionId }) => ({ decision: 'deny', interactionId }),
  requestPlanDecision: async ({ interactionId }) => ({ decision: null, interactionId }),
};
