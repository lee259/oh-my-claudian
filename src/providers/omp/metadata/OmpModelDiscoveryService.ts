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
  normalizeOmpConfigChoices,
  normalizeOmpConfigOptionModels,
  normalizeOmpDiscoveredModels,
  type OmpDiscoveredModel,
} from '../models';
import { buildOmpEnvironment } from '../runtime/OmpLaunchSpec';

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
      config: getMetadataSessionConfig(this.plugin),
      getActiveTurnId: () => null,
      onClosed: () => undefined,
      onNotification: () => undefined,
      plugin: this.plugin,
    });
    try {
      await kernel.connect();
      signal?.throwIfAborted();
      const session = await kernel.openSession();
      signal?.throwIfAborted();
      const thinking = normalizeOmpConfigChoices(session.configOptions, 'thought_level');
      const acpModels = normalizeOmpConfigOptionModels(session.configOptions);
      const models = await this.discoverCliModels(signal).catch(() => acpModels);
      return {
        models: models.length > 0 ? models : acpModels,
        thinking: thinking.configId
          ? {
            configId: thinking.configId,
            currentValue: thinking.currentValue,
            options: thinking.options,
          }
          : null,
      };
    } finally {
      await kernel.dispose();
    }
  }

  private async discoverCliModels(signal?: AbortSignal): Promise<OmpDiscoveredModel[]> {
    const command = await this.plugin.getResolvedProviderCliPath('omp') ?? 'omp';
    const result = await this.runner.run({
      args: ['models', '--json'],
      command,
      cwd: getVaultPath(this.plugin.app) ?? process.cwd(),
      env: buildOmpEnvironment(
        process.env,
        getRuntimeEnvironmentVariables(this.plugin.settings, 'omp'),
      ),
      signal,
      timeoutMs: MODEL_COMMAND_TIMEOUT_MS,
    });
    if (result.termination || result.exitCode !== 0) return [];
    return parseOmpModelsOutput(result.stdout);
  }

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

function getMetadataSessionConfig(plugin: ProviderHost): ProviderSessionConfig {
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
