import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import {
  type ProviderDiagnosticLogRecord,
  ProviderDiagnosticStreamBuffer,
} from '../../../core/providers/ProviderDiagnosticLog';
import type { StreamChunk } from '../../../core/types';
import {
  PiExtensionUiBridge,
  type PiExtensionUiRenderer,
} from '../runtime/PiExtensionUiBridge';
import type { PiLaunchSpec } from '../runtime/PiLaunchSpec';
import { PI_OBSIDIAN_MCP_EXTENSION_SOURCE } from '../runtime/PiObsidianMcpExtension';
import {
  type PiRpcRecord,
  PiRpcTransport,
} from '../runtime/PiRpcTransport';
import { PiSubprocess } from '../runtime/PiSubprocess';
import { isPiTreeResponse, PI_TREE_EXTENSION_SOURCE, requestPiTree } from '../runtime/PiTreeBridge';

export interface PiExecutionKernelCallbacks {
  onDiagnostic?(record: ProviderDiagnosticLogRecord): void;
  onClose(error?: Error): void;
  onEvent(event: PiRpcRecord): void;
  onExtensionChunk(chunk: StreamChunk): void;
  onExtensionRequest(request: PiRpcRecord): void;
}

export interface PiExecutionKernel {
  readonly launchSpec: PiLaunchSpec;
  getStderrSnapshot(): string;
  request<T>(
    type: string,
    payload?: Record<string, unknown>,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T>;
  send(record: PiRpcRecord): void;
  shutdown(): Promise<void>;
  start(): void;
}

export type PiExecutionKernelFactory = (
  launchSpec: PiLaunchSpec,
  callbacks: PiExecutionKernelCallbacks,
  extensionUiRenderer: PiExtensionUiRenderer | null,
) => PiExecutionKernel;

export class PiRpcSessionKernel implements PiExecutionKernel {
  private readonly subprocess: PiSubprocess;
  private transport: PiRpcTransport | null = null;
  private extensionBridge: PiExtensionUiBridge | null = null;
  private removeCloseListener: (() => void) | null = null;
  private removeEventListener: (() => void) | null = null;
  private started = false;
  private shutdownPromise: Promise<void> | null = null;
  private extensionDirectory: string | null = null;
  private effectiveLaunchSpec: PiLaunchSpec;
  private readonly stderrDecoder = new StringDecoder('utf8');
  private readonly stderrLogBuffer = new ProviderDiagnosticStreamBuffer();

  constructor(
    readonly launchSpec: PiLaunchSpec,
    private readonly callbacks: PiExecutionKernelCallbacks,
    extensionUiRenderer: PiExtensionUiRenderer | null,
  ) {
    let processSpec = launchSpec;
    if (launchSpec.enableTreeBridge || launchSpec.enableObsidianWorkspaceTool) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-pi-extension-'));
      try {
        const extensions: string[] = [];
        if (launchSpec.enableTreeBridge) {
          const extension = path.join(directory, 'tree-extension.ts');
          fs.writeFileSync(extension, PI_TREE_EXTENSION_SOURCE, 'utf8');
          extensions.push(extension);
        }
        if (launchSpec.enableObsidianWorkspaceTool) {
          const extension = path.join(directory, 'obsidian-mcp-extension.ts');
          fs.writeFileSync(extension, PI_OBSIDIAN_MCP_EXTENSION_SOURCE, 'utf8');
          extensions.push(extension);
        }
        processSpec = {
          ...launchSpec,
          args: [...launchSpec.args, ...extensions.flatMap(extension => ['--extension', extension])],
        };
        this.extensionDirectory = directory;
      } catch (error) {
        fs.rmSync(directory, { recursive: true, force: true });
        throw error;
      }
    }
    this.effectiveLaunchSpec = processSpec;
    this.subprocess = new PiSubprocess(processSpec);
    this.extensionUiRenderer = extensionUiRenderer;
  }

  private readonly extensionUiRenderer: PiExtensionUiRenderer | null;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.subprocess.start();
    this.callbacks.onDiagnostic?.({
      args: this.effectiveLaunchSpec.args,
      command: this.effectiveLaunchSpec.command,
      cwd: this.effectiveLaunchSpec.cwd,
      event: 'process-started',
      source: 'pi',
    });
    this.subprocess.stderr.on('data', (chunk: Buffer | string) => {
      const message = this.stderrDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.writeStderrDiagnostics(this.stderrLogBuffer.write(message));
    });
    this.subprocess.onCloseState((state) => {
      this.writeStderrDiagnostics(this.stderrLogBuffer.write(this.stderrDecoder.end()));
      this.writeStderrDiagnostics(this.stderrLogBuffer.end());
      this.callbacks.onDiagnostic?.({
        event: 'process-exited',
        exitCode: state.code,
        ...(state.error ? { message: state.error.message } : {}),
        signal: state.signal,
        source: 'pi',
      });
    });
    const transport = new PiRpcTransport({
      input: this.subprocess.stdout,
      onClose: listener => this.subprocess.onClose(listener),
      output: this.subprocess.stdin,
    });
    const extensionBridge = new PiExtensionUiBridge(
      transport,
      this.extensionUiRenderer,
      chunk => this.callbacks.onExtensionChunk(chunk),
    );
    this.transport = transport;
    this.extensionBridge = extensionBridge;
    transport.start();
    this.removeEventListener = transport.onEvent((event) => {
      if (isPiTreeResponse(event)) return;
      if (event.type === 'extension_ui_request') {
        this.callbacks.onExtensionRequest(event);
        extensionBridge.handleRequest(event);
        return;
      }
      this.callbacks.onEvent(event);
    });
    this.removeCloseListener = transport.onClose(error => {
      this.callbacks.onClose(error);
    });
  }

  getStderrSnapshot(): string {
    return this.subprocess.getStderrSnapshot();
  }

  request<T>(
    type: string,
    payload: Record<string, unknown> = {},
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (type === 'claudian_tree') {
      return requestPiTree(this.requireTransport(), payload, signal) as Promise<T>;
    }
    return this.requireTransport().request(type, payload, timeoutMs, signal);
  }

  send(record: PiRpcRecord): void {
    this.requireTransport().send(record);
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.shutdownInternal();
    return this.shutdownPromise;
  }

  private async shutdownInternal(): Promise<void> {
    this.extensionBridge?.cleanup();
    this.removeEventListener?.();
    this.removeEventListener = null;
    this.removeCloseListener?.();
    this.removeCloseListener = null;
    this.transport?.dispose();
    this.transport = null;
    this.extensionBridge = null;
    await this.subprocess.shutdown();
    if (this.extensionDirectory) {
      await fsp.rm(this.extensionDirectory, { recursive: true, force: true });
      this.extensionDirectory = null;
    }
  }

  private requireTransport(): PiRpcTransport {
    if (!this.transport) {
      throw new Error('Pi execution kernel is not started');
    }
    return this.transport;
  }

  private writeStderrDiagnostics(messages: readonly string[]): void {
    for (const message of messages) {
      this.callbacks.onDiagnostic?.({
        event: 'process-stderr',
        message,
        source: 'pi',
      });
    }
  }
}

export const createPiExecutionKernel: PiExecutionKernelFactory = (
  launchSpec,
  callbacks,
  extensionUiRenderer,
) => new PiRpcSessionKernel(
  launchSpec,
  callbacks,
  extensionUiRenderer,
);
