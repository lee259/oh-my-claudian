import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProviderSessionConfig } from '@/core/execution';
import { buildHostCliEnvironment } from '@/core/providers/cli/HostCliLifecycleAdapter';
import type { ProviderHost } from '@/core/providers/ProviderHost';

import { DefaultHermesAcpSessionKernel, type HermesAcpSessionKernel, type HermesAcpSessionKernelOptions } from '../execution/HermesAcpSessionKernel';
import { resolveHermesHome } from '../history/HermesHistoryStore';
import { type HermesDiscoveredModel, normalizeHermesDiscoveredModels } from '../models';

type Isolation = { home: string; dispose(): Promise<void> };
interface Options {
  createKernel?: (options: HermesAcpSessionKernelOptions) => HermesAcpSessionKernel;
  isolate?: (environment: NodeJS.ProcessEnv) => Promise<Isolation>;
}
export class HermesModelDiscoveryService {
  constructor(private readonly plugin: ProviderHost, private readonly options: Options = {}) {}
  async discover(signal?: AbortSignal): Promise<HermesDiscoveredModel[]> {
    signal?.throwIfAborted();
    const environment = buildHostCliEnvironment(this.plugin, 'hermes');
    const isolated = await (this.options.isolate ?? isolateHermesHome)(environment);
    const adapter = this.plugin.app.vault.adapter as { basePath?: unknown };
    const config: ProviderSessionConfig = {
      interactionPort: {
        askUserQuestion: async ({ interactionId }) => ({ answers: null, interactionId }),
        dismissInteraction: () => undefined,
        requestApproval: async ({ interactionId }) => ({ decision: 'deny', interactionId }),
        requestPlanDecision: async ({ interactionId }) => ({ decision: null, interactionId }),
      },
      lifecycle: 'ephemeral', nativePersistence: 'disabled-if-supported',
      vaultWorkingDirectory: typeof adapter.basePath === 'string' && adapter.basePath ? adapter.basePath : process.cwd(),
    };
    let kernel: HermesAcpSessionKernel | undefined;
    const abort = () => { void kernel?.dispose().catch(() => undefined); };
    try {
    kernel = (this.options.createKernel ?? (options => new DefaultHermesAcpSessionKernel(options)))({
      config, environmentOverrides: { HERMES_HOME: isolated.home }, getActiveTurnId: () => null,
      onClosed: () => undefined, onNotification: () => undefined, plugin: this.plugin, sessionInstanceId: 'hermes-model-discovery',
    });
    signal?.addEventListener('abort', abort, { once: true });
      signal?.throwIfAborted();
      await kernel.connect();
      signal?.throwIfAborted();
      const session = await kernel.openSession();
      signal?.throwIfAborted();
      return normalizeHermesDiscoveredModels(session.models?.availableModels);
    } finally {
      signal?.removeEventListener('abort', abort);
      try { await kernel?.dispose(); } finally { await isolated.dispose(); }
    }
  }
}

async function isolateHermesHome(environment: NodeJS.ProcessEnv): Promise<Isolation> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-hermes-models-'));
  try {
    const source = resolveHermesHome({ environment, hostPlatform: process.platform });
    for (const name of ['config.yaml', '.env', 'auth.json', 'provider_models_cache.json', 'models_dev_cache.json']) {
      try { await fs.copyFile(path.join(source, name), path.join(home, name)); await fs.chmod(path.join(home, name), 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return { home, dispose: () => fs.rm(home, { recursive: true, force: true }) };
  } catch (error) { await fs.rm(home, { recursive: true, force: true }); throw error; }
}
