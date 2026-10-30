import type { ProviderSessionConfig } from '@/core/execution';
import { buildHostCliEnvironment } from '@/core/providers/cli/HostCliLifecycleAdapter';
import { getProviderAdditionalArguments } from '@/core/providers/ProviderAdditionalArguments';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import {
  AcpClientConnection, AcpInteractionController, AcpJsonRpcTransport,   type AcpPromptRequest, type AcpPromptResponse, type AcpSessionModelState, type AcpSessionNotification,
AcpSubprocess,
} from '@/providers/acp';

import { buildHermesLaunchSpec } from '../runtime/HermesLaunchSpec';

export interface HermesAcpSessionKernelOptions {
  config: ProviderSessionConfig;
  environmentOverrides?: NodeJS.ProcessEnv;
  getActiveTurnId: () => string | null;
  onClosed: (error: Error) => void;
  onNotification: (notification: AcpSessionNotification) => void;
  plugin: ProviderHost;
  sessionInstanceId: string;
}
export interface HermesNativeSessionInfo { sessionId: string; models?: AcpSessionModelState | null }
export interface HermesAcpSessionKernel {
  connect(): Promise<void>;
  openSession(resumeSessionId?: string): Promise<HermesNativeSessionInfo>;
  setModel(request: { modelId: string; sessionId: string }): Promise<void>;
  setMode(request: { modeId: string; sessionId: string }): Promise<void>;
  prompt(request: AcpPromptRequest): Promise<Pick<AcpPromptResponse, 'usage' | 'userMessageId' | 'stopReason'>>;
  cancel(sessionId: string): void;
  dispose(): Promise<void>;
}
export class DefaultHermesAcpSessionKernel implements HermesAcpSessionKernel {
  private connection: AcpClientConnection | null = null;
  private subprocess: AcpSubprocess | null = null;
  private transport: AcpJsonRpcTransport | null = null;
  private interaction: AcpInteractionController | null = null;
  private disposed = false;
  constructor(private readonly options: HermesAcpSessionKernelOptions) {}
  async connect(): Promise<void> {
    if (this.disposed) throw new Error('Hermes ACP kernel is disposed');
    if (this.connection) return;
    const command = await this.options.plugin.getResolvedProviderCliPath('hermes');
    if (this.disposed) throw new Error('Hermes ACP kernel is disposed');
    if (!command) throw new Error('Hermes CLI was not found. Configure its path in settings.');
    const spec = buildHermesLaunchSpec({ command, cwd: this.options.config.vaultWorkingDirectory,
      env: { ...buildHostCliEnvironment(this.options.plugin, 'hermes', command), ...this.options.environmentOverrides },
      additionalArguments: getProviderAdditionalArguments(this.options.plugin.settings, 'hermes') });
    const subprocess = new AcpSubprocess(spec);
    this.subprocess = subprocess;
    subprocess.onClose(error => { if (!this.disposed) this.options.onClosed(error ?? new Error('Hermes ACP process closed')); });
    subprocess.start();
    const transport = new AcpJsonRpcTransport({ input: subprocess.stdout, output: subprocess.stdin,
      onClose: listener => subprocess.onClose(listener) });
    this.transport = transport;
    this.interaction = new AcpInteractionController({ getTurnId: this.options.getActiveTurnId,
      interactionPort: this.options.config.interactionPort, sessionInstanceId: this.options.sessionInstanceId });
    const connection = new AcpClientConnection({ clientInfo: { name: 'claudian', version: this.options.plugin.manifest?.version ?? '0.0.0' },
      delegate: { onSessionNotification: notification => this.options.onNotification(notification),
        requestPermission: request => this.interaction?.requestPermission(request) ?? Promise.resolve({ outcome: { outcome: 'cancelled' } }) }, transport });
    this.connection = connection;
    transport.start();
    const result = await connection.initialize();
    if (result.agentInfo?.name !== 'hermes-agent') throw new Error('Configured executable is not Hermes Agent.');
    if (this.disposed) throw new Error('Hermes ACP kernel is disposed');
  }
  async openSession(resumeSessionId?: string): Promise<HermesNativeSessionInfo> {
    if (!this.connection) throw new Error('Hermes ACP kernel is not connected');
    const request = { cwd: this.options.config.vaultWorkingDirectory, mcpServers: [] };
    if (resumeSessionId) {
      const result = await this.connection.loadSession({ ...request, sessionId: resumeSessionId });
      return { sessionId: result.sessionId ?? resumeSessionId, models: result.models };
    }
    return this.connection.newSession(request);
  }
  async setModel(request: { modelId: string; sessionId: string }): Promise<void> {
    if (!this.connection) throw new Error('Hermes ACP kernel is not connected');
    await this.connection.setModel(request);
  }
  async setMode(request: { modeId: string; sessionId: string }): Promise<void> {
    if (!this.connection) throw new Error('Hermes ACP kernel is not connected');
    await this.connection.setMode(request);
  }
  prompt(request: AcpPromptRequest): Promise<Pick<AcpPromptResponse, 'usage' | 'userMessageId' | 'stopReason'>> {
    if (!this.connection) throw new Error('Hermes ACP kernel is not connected');
    return this.connection.prompt(request);
  }
  cancel(sessionId: string): void { this.connection?.cancel({ sessionId }); }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.interaction?.dispose(); this.connection?.dispose(); this.transport?.dispose();
    await this.subprocess?.shutdown();
    this.connection = null; this.transport = null; this.subprocess = null;
  }
}
