import type { ProviderSessionConfig } from '@/core/execution';
import { getRuntimeEnvironmentVariables } from '@/core/providers/providerEnvironment';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import {
  AcpClientConnection,
  AcpInteractionController,
  AcpJsonRpcTransport,
  type AcpPermissionPresentation,
  type AcpPromptRequest,
  type AcpPromptResponse,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionConfigOption,
  type AcpSessionNotification,
  AcpSubprocess,
  resolveAcpLoadSessionId,
} from '@/providers/acp';
import { getHostnameKey } from '@/utils/env';

import { ensureDshAcpProfilePatch, removeDshAcpProfilePatch } from '../runtime/DshAcpProfilePatch';
import { buildDshLaunchSpec, resolveDshLaunchCommand } from '../runtime/DshLaunchSpec';
import { resolveDshRuntimeEnvironment } from '../runtime/DshRuntimeEnvironment';
import { getConfiguredDshCliPath } from '../settings';

export interface DshAcpSessionKernelOptions {
  readonly config: ProviderSessionConfig;
  readonly getActiveTurnId: () => string | null;
  readonly initialModelId?: string;
  readonly onClosed: (error: Error) => void;
  readonly onNotification: (notification: AcpSessionNotification) => void;
  readonly onPermissionDenied?: (toolCallId: string) => void;
  readonly plugin: ProviderHost;
  readonly sessionInstanceId: string;
}

export interface DshNativeSessionInfo {
  readonly configOptions?: AcpSessionConfigOption[] | null;
  readonly resumed: boolean;
  readonly sessionId: string;
}

export interface DshAcpSessionKernel {
  closeSession(sessionId: string): Promise<void>;
  connect(): Promise<void>;
  openSession(resumeSessionId?: string): Promise<DshNativeSessionInfo>;
  prompt(request: AcpPromptRequest): Promise<Pick<AcpPromptResponse, 'usage' | 'userMessageId'>>;
  setConfigOption(request: { configId: string; sessionId: string; value: string }): Promise<void>;
  cancel(sessionId: string): void;
  dispose(): Promise<void>;
}

export class DefaultDshAcpSessionKernel implements DshAcpSessionKernel {
  private connection: AcpClientConnection | null = null;
  private process: AcpSubprocess | null = null;
  private transport: AcpJsonRpcTransport | null = null;
  private interaction: AcpInteractionController | null = null;
  private profilePatchPath: string | null = null;
  private disposed = false;

  constructor(private readonly options: DshAcpSessionKernelOptions) {}

  async connect(): Promise<void> {
    if (this.disposed) throw new Error('DeepSeek Harness ACP session is disposed.');
    if (this.connection) return;
    const resolvedCommand = await this.options.plugin.getResolvedProviderCliPath('dsh');
    if (!resolvedCommand) {
      throw new Error('DeepSeek Harness is not installed. Install the dsh CLI in provider settings, then retry.');
    }
    const environment = await resolveDshRuntimeEnvironment(
      process.env,
      getRuntimeEnvironmentVariables(this.options.plugin.settings, 'dsh'),
    );
    const configuredPath = getConfiguredDshCliPath(
      this.options.plugin.settings,
      getHostnameKey(),
    );
    const command = resolveDshLaunchCommand(
      resolvedCommand,
      environment,
      Boolean(configuredPath),
    );
    this.profilePatchPath = this.options.initialModelId
      ? await ensureDshAcpProfilePatch(this.options.initialModelId)
      : null;
    const launchSpec = buildDshLaunchSpec({
      command,
      cwd: this.options.config.vaultWorkingDirectory,
      env: environment,
      ...(this.profilePatchPath ? { profilePatchPath: this.profilePatchPath } : {}),
    });
    const subprocess = new AcpSubprocess(launchSpec);
    subprocess.onClose(error => {
      if (!this.disposed) {
        this.options.onClosed(enrichDshAcpProcessError(error, subprocess.getStderrSnapshot()));
      }
    });
    subprocess.start();
    this.process = subprocess;
    const transport = new AcpJsonRpcTransport({
      input: subprocess.stdout,
      onClose: listener => subprocess.onClose(listener),
      output: subprocess.stdin,
    });
    this.transport = transport;
    this.interaction = new AcpInteractionController({
      getTurnId: this.options.getActiveTurnId,
      interactionPort: this.options.config.interactionPort,
      onPermissionDenied: this.options.onPermissionDenied,
      presentPermission: presentDshPermission,
      sessionInstanceId: this.options.sessionInstanceId,
    });
    const connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian',
        version: this.options.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        onSessionNotification: notification => this.options.onNotification(notification),
        requestPermission: request => this.requestPermission(request),
      },
      transport,
    });
    this.connection = connection;
    transport.start();
    try {
      const result = await connection.initialize();
      const capabilities = result.agentCapabilities?.sessionCapabilities;
      if (!capabilities?.resume || !capabilities.close || !capabilities.list) {
        throw new Error(
          'This DeepSeek Harness ACP runtime cannot list, resume, and close persistent sessions. Update dsh and retry.',
        );
      }
    } catch (error) {
      const enriched = enrichDshAcpProcessError(
        error instanceof Error ? error : new Error(String(error)),
        subprocess.getStderrSnapshot(),
      );
      await this.dispose();
      throw enriched;
    }
  }

  async openSession(resumeSessionId?: string): Promise<DshNativeSessionInfo> {
    const connection = this.connection;
    if (!connection) throw new Error('DeepSeek Harness ACP session is not connected.');
    const request = {
      cwd: this.options.config.vaultWorkingDirectory,
      mcpServers: [],
    };
    if (resumeSessionId) {
      const response = await connection.loadSession({ ...request, sessionId: resumeSessionId });
      return {
        configOptions: response.configOptions,
        resumed: true,
        sessionId: resolveAcpLoadSessionId(response, resumeSessionId),
      };
    }
    const response = await connection.newSession(request);
    return {
      configOptions: response.configOptions,
      resumed: false,
      sessionId: response.sessionId,
    };
  }

  async setConfigOption(request: { configId: string; sessionId: string; value: string }): Promise<void> {
    if (!this.connection) throw new Error('DeepSeek Harness ACP session is not connected.');
    await this.connection.setConfigOption({
      configId: request.configId,
      sessionId: request.sessionId,
      type: 'select',
      value: request.value,
    });
  }

  prompt(request: AcpPromptRequest): Promise<Pick<AcpPromptResponse, 'usage' | 'userMessageId'>> {
    if (!this.connection) throw new Error('DeepSeek Harness ACP session is not connected.');
    return this.connection.prompt(request);
  }

  cancel(sessionId: string): void { this.connection?.cancel({ sessionId }); }

  async closeSession(sessionId: string): Promise<void> {
    await this.connection?.closeSession({ sessionId });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.interaction?.dispose();
    this.connection?.dispose();
    this.transport?.dispose();
    await this.process?.shutdown();
    await removeDshAcpProfilePatch(this.profilePatchPath).catch(() => undefined);
    this.connection = null;
    this.transport = null;
    this.process = null;
  }

  private requestPermission(request: AcpRequestPermissionRequest): Promise<AcpRequestPermissionResponse> {
    return this.interaction?.requestPermission(request)
      ?? Promise.resolve({ outcome: { outcome: 'cancelled' } });
  }
}

export function enrichDshAcpProcessError(error: Error | undefined, stderr: string): Error {
  const baseError = error ?? new Error('DeepSeek Harness ACP process closed.');
  const details = stderr.trim();
  if (!details) return baseError;
  return new Error(`${baseError.message}\nDeepSeek Harness stderr:\n${details}`, { cause: baseError });
}

function presentDshPermission(
  request: AcpRequestPermissionRequest,
  _input: Readonly<Record<string, unknown>>,
): AcpPermissionPresentation {
  const toolName = request.toolCall.title || request.toolCall.kind || 'tool';
  return {
    description: `DeepSeek Harness wants permission to use ${toolName}.`,
    toolName,
  };
}
