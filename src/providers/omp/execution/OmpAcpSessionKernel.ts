import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { ProviderSessionConfig } from '@/core/execution';
import { getProviderAdditionalArguments } from '@/core/providers/ProviderAdditionalArguments';
import { ProviderDiagnosticStreamBuffer } from '@/core/providers/ProviderDiagnosticLog';
import { sanitizeDiagnosticMessage } from '@/core/providers/ProviderDiagnostics';
import { getRuntimeEnvironmentVariables } from '@/core/providers/providerEnvironment';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { resolveAllowedFileOperationPath } from '@/core/storage/pathAccessPolicy';
import { t } from '@/i18n/i18n';
import {
  AcpClientConnection,
  AcpInteractionController,
  AcpJsonRpcTransport,
  type AcpPermissionPresentation,
  type AcpPromptRequest,
  type AcpPromptResponse,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionConfigOption,
  type AcpSessionModelState,
  type AcpSessionNotification,
  AcpSubprocess,
  type AcpWriteTextFileRequest,
} from '@/providers/acp';

import type { OmpApprovalMode } from '../runtime/OmpLaunchSpec';
import { buildOmpLaunchSpec } from '../runtime/OmpLaunchSpec';
import { resolveOmpRuntimeEnvironment } from '../runtime/OmpRuntimeEnvironment';
import { getOmpProviderSettings } from '../settings';

export interface OmpAcpSessionKernelOptions {
  readonly approvalMode: OmpApprovalMode;
  readonly config: ProviderSessionConfig;
  readonly getActiveTurnId: () => string | null;
  readonly onClosed: (error: Error) => void;
  readonly onNotification: (notification: AcpSessionNotification) => void;
  readonly onPermissionDenied?: (toolCallId: string) => void;
  readonly plugin: ProviderHost;
}

export interface OmpNativeSessionInfo {
  readonly configOptions?: AcpSessionConfigOption[] | null;
  readonly models?: AcpSessionModelState | null;
  readonly sessionId: string;
}

export interface OmpAcpSessionKernel {
  connect(): Promise<void>;
  openSession(resumeSessionId?: string): Promise<OmpNativeSessionInfo>;
  setModel(request: { modelId: string; sessionId: string }): Promise<void>;
  setConfigOption(request: {
    configId: string;
    sessionId: string;
    type: 'select';
    value: string;
  }): Promise<void>;
  prompt(request: AcpPromptRequest): Promise<Pick<AcpPromptResponse, 'usage' | 'userMessageId'>>;
  cancel(sessionId: string): void;
  dispose(): Promise<void>;
}

export class DefaultOmpAcpSessionKernel implements OmpAcpSessionKernel {
  private connection: AcpClientConnection | null = null;
  private process: AcpSubprocess | null = null;
  private transport: AcpJsonRpcTransport | null = null;
  private interaction: AcpInteractionController | null = null;
  private disposed = false;

  constructor(private readonly options: OmpAcpSessionKernelOptions) {}

  async connect(): Promise<void> {
    if (this.disposed) throw new Error('OMP ACP kernel is disposed');
    if (this.connection) return;

    const command = await this.options.plugin.getResolvedProviderCliPath('omp') ?? 'omp';
    const settings = getOmpProviderSettings(this.options.plugin.settings);
    const environment = await resolveOmpRuntimeEnvironment(
      process.env,
      getRuntimeEnvironmentVariables(this.options.plugin.settings, 'omp'),
    );
    const spec = buildOmpLaunchSpec({
      approvalMode: this.options.approvalMode,
      additionalArguments: getProviderAdditionalArguments(this.options.plugin.settings, 'omp'),
      command,
      cwd: this.options.config.vaultWorkingDirectory,
      env: environment,
      settings,
    });
    const subprocess = new AcpSubprocess(spec);
    const stderrDecoder = new StringDecoder('utf8');
    const stderrLogBuffer = new ProviderDiagnosticStreamBuffer();
    const writeStderrDiagnostics = (messages: readonly string[]): void => {
      for (const message of messages) {
        writeOmpDiagnostic(this.options.plugin, {
          event: 'process-stderr',
          message,
          source: 'omp',
        });
      }
    };
    subprocess.onCloseState((state) => {
      writeStderrDiagnostics(stderrLogBuffer.write(stderrDecoder.end()));
      writeStderrDiagnostics(stderrLogBuffer.end());
      void writeOmpDiagnostic(this.options.plugin, {
        event: 'process-exited',
        exitCode: state.code,
        ...(state.error ? { message: state.error.message } : {}),
        signal: state.signal,
        source: 'omp',
      });
    });
    subprocess.onClose((error) => {
      if (this.disposed) return;
      const processError = error ?? new Error('OMP ACP process closed');
      const stderr = sanitizeDiagnosticMessage(subprocess.getStderrSnapshot().trim()).slice(-1_500);
      this.options.onClosed(stderr
        ? new Error(`${processError.message}\nOMP stderr: ${stderr}`, { cause: processError })
        : processError);
    });
    subprocess.start();
    void writeOmpDiagnostic(this.options.plugin, {
      args: spec.args,
      command: spec.command,
      cwd: spec.cwd,
      event: 'process-started',
      source: 'omp',
    });
    subprocess.stderr.on('data', (chunk: Buffer | string) => {
      const message = stderrDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      writeStderrDiagnostics(stderrLogBuffer.write(message));
    });
    this.process = subprocess;
    const transport = new AcpJsonRpcTransport({
      input: subprocess.stdout,
      onClose: (listener) => subprocess.onClose(listener),
      output: subprocess.stdin,
    });
    this.transport = transport;
    this.interaction = new AcpInteractionController({
      getTurnId: this.options.getActiveTurnId,
      interactionPort: this.options.config.interactionPort,
      onPermissionDenied: this.options.onPermissionDenied,
      presentPermission: presentOmpPermission,
      sessionInstanceId: 'omp',
    });
    const connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian',
        version: this.options.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        fileSystem: {
          readTextFile: request => this.readTextFile(request),
          writeTextFile: request => this.writeTextFile(request),
        },
        onSessionNotification: notification => this.options.onNotification(notification),
        requestPermission: request => this.requestPermission(request),
      },
      transport,
    });
    this.connection = connection;
    transport.start();
    await connection.initialize();
  }

  async openSession(resumeSessionId?: string): Promise<OmpNativeSessionInfo> {
    if (!this.connection) throw new Error('OMP ACP kernel is not connected');
    const request = {
      cwd: this.options.config.vaultWorkingDirectory,
      mcpServers: [],
    };
    if (resumeSessionId) {
      const response = await this.connection.loadSession({ ...request, sessionId: resumeSessionId });
      return {
        configOptions: response.configOptions,
        models: response.models,
        sessionId: response.sessionId ?? resumeSessionId,
      };
    }
    const response = await this.connection.newSession(request);
    return {
      configOptions: response.configOptions,
      models: response.models,
      sessionId: response.sessionId,
    };
  }

  async setModel(request: { modelId: string; sessionId: string }): Promise<void> {
    if (!this.connection) throw new Error('OMP ACP kernel is not connected');
    await this.connection.setConfigOption({
      configId: 'model',
      sessionId: request.sessionId,
      type: 'select',
      value: request.modelId,
    });
  }

  async setConfigOption(request: {
    configId: string;
    sessionId: string;
    type: 'select';
    value: string;
  }): Promise<void> {
    if (!this.connection) throw new Error('OMP ACP kernel is not connected');
    await this.connection.setConfigOption(request);
  }

  prompt(request: AcpPromptRequest): Promise<Pick<AcpPromptResponse, 'usage' | 'userMessageId'>> {
    if (!this.connection) throw new Error('OMP ACP kernel is not connected');
    return this.connection.prompt(request);
  }

  cancel(sessionId: string): void {
    this.connection?.cancel({ sessionId });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.interaction?.dispose();
    this.connection?.dispose();
    this.transport?.dispose();
    await this.process?.shutdown();
    this.connection = null;
    this.transport = null;
    this.process = null;
  }

  private async readTextFile(request: AcpReadTextFileRequest): Promise<{ content: string }> {
    const filePath = resolveWorkspacePath(this.options.config.vaultWorkingDirectory, request.path, 'read');
    const content = await fs.readFile(filePath, 'utf8');
    if (request.line === undefined && request.limit === undefined) return { content };
    const lines = content.split(/\r?\n/u);
    const start = Math.max(0, (request.line ?? 1) - 1);
    const end = request.limit == null ? lines.length : start + Math.max(0, request.limit);
    return { content: lines.slice(start, end).join('\n') };
  }

  private async writeTextFile(request: AcpWriteTextFileRequest): Promise<Record<string, never>> {
    const filePath = resolveWorkspacePath(this.options.config.vaultWorkingDirectory, request.path, 'write');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, request.content, 'utf8');
    return {};
  }

  private requestPermission(request: AcpRequestPermissionRequest): Promise<AcpRequestPermissionResponse> {
    return this.interaction?.requestPermission(request)
      ?? Promise.resolve({ outcome: { outcome: 'cancelled' } });
  }
}

function writeOmpDiagnostic(
  plugin: ProviderHost,
  record: Parameters<NonNullable<ProviderHost['diagnosticLog']>['write']>[0],
): void {
  void plugin.diagnosticLog?.write(record).catch(() => undefined);
}

export function resolveWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
  operation: 'read' | 'write' = 'read',
): string {
  try {
    return resolveAllowedFileOperationPath({
      operation,
      requestedPath,
      workspaceRoot,
    });
  } catch {
    throw new Error('OMP file access is limited to the current workspace');
  }
}

function presentOmpPermission(
  request: AcpRequestPermissionRequest,
  _input: Readonly<Record<string, unknown>>,
): AcpPermissionPresentation {
  return {
    description: t('settings.omp.permissionRequest', {
      tool: request.toolCall.title || t('settings.omp.tool'),
    }),
    toolName: request.toolCall.title || t('settings.omp.tool'),
  };
}
