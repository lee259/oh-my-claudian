import type { ProviderSessionConfig } from '@/core/execution';
import { getRuntimeEnvironmentVariables } from '@/core/providers/providerEnvironment';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  type AcpPromptRequest,
  type AcpPromptResponse,
  type AcpSessionNotification,
  AcpSubprocess,
} from '@/providers/acp';

import { buildDshLaunchSpec } from '../runtime/DshLaunchSpec';
import { getDshProviderSettings } from '../settings';

export interface DshAcpSessionKernelOptions {
  readonly config: ProviderSessionConfig;
  readonly getActiveTurnId: () => string | null;
  readonly onClosed: (error: Error) => void;
  readonly onNotification: (notification: AcpSessionNotification) => void;
  readonly plugin: ProviderHost;
}

export interface DshNativeSessionInfo {
  readonly sessionId: string;
}

export interface DshAcpSessionKernel {
  connect(): Promise<void>;
  openSession(): Promise<DshNativeSessionInfo>;
  prompt(request: AcpPromptRequest): Promise<Pick<AcpPromptResponse, 'usage' | 'userMessageId'>>;
  cancel(sessionId: string): void;
  dispose(): Promise<void>;
}

export class DefaultDshAcpSessionKernel implements DshAcpSessionKernel {
  private connection: AcpClientConnection | null = null;
  private process: AcpSubprocess | null = null;
  private transport: AcpJsonRpcTransport | null = null;
  private disposed = false;

  constructor(private readonly options: DshAcpSessionKernelOptions) {}

  async connect(): Promise<void> {
    if (this.disposed) throw new Error('dsh ACP kernel is disposed');
    if (this.connection) return;
    const settings = getDshProviderSettings(this.options.plugin.settings);
    const command = ((await this.options.plugin.getResolvedProviderCliPath('dsh')) ?? settings.cliPath) || 'dsh';
    const launchSpec = buildDshLaunchSpec({
      args: settings.args,
      command,
      cwd: this.options.config.vaultWorkingDirectory,
      env: {
        ...process.env,
        ...getRuntimeEnvironmentVariables(this.options.plugin.settings, 'dsh'),
      },
      model: settings.model,
    });
    const subprocess = new AcpSubprocess(launchSpec);
    subprocess.onClose(error => {
      if (!this.disposed) this.options.onClosed(error ?? new Error('dsh ACP process closed'));
    });
    subprocess.start();
    this.process = subprocess;
    const transport = new AcpJsonRpcTransport({
      input: subprocess.stdout,
      onClose: listener => subprocess.onClose(listener),
      output: subprocess.stdin,
    });
    this.transport = transport;
    const connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian',
        version: this.options.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        onSessionNotification: notification => this.options.onNotification(notification),
      },
      transport,
    });
    this.connection = connection;
    transport.start();
    await connection.initialize();
  }

  async openSession(): Promise<DshNativeSessionInfo> {
    if (!this.connection) throw new Error('dsh ACP kernel is not connected');
    const response = await this.connection.newSession({
      cwd: this.options.config.vaultWorkingDirectory,
      mcpServers: [],
    });
    return { sessionId: response.sessionId };
  }

  prompt(request: AcpPromptRequest): Promise<Pick<AcpPromptResponse, 'usage' | 'userMessageId'>> {
    if (!this.connection) throw new Error('dsh ACP kernel is not connected');
    return this.connection.prompt(request);
  }

  cancel(sessionId: string): void { this.connection?.cancel({ sessionId }); }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.connection?.dispose();
    this.transport?.dispose();
    await this.process?.shutdown();
    this.connection = null;
    this.transport = null;
    this.process = null;
  }
}
