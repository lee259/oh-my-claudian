import {
  AcpClientConnection,
  type AcpClientConnectionDelegate,
} from './AcpClientConnection';
import { AcpJsonRpcTransport } from './AcpJsonRpcTransport';
import { AcpSubprocess, type AcpSubprocessLaunchSpec } from './AcpSubprocess';
import type { AcpMethodOverrides } from './methodNames';
import type { AcpClientCapabilities } from './types';

export interface AcpNativeProcessOptions {
  readonly launch: AcpSubprocessLaunchSpec;
  readonly version: string;
  readonly delegate: AcpClientConnectionDelegate;
  readonly clientCapabilities?: Partial<AcpClientCapabilities>;
  readonly methodOverrides?: AcpMethodOverrides;
}

/** One ACP agent process with its JSON-RPC transport and client. */
export class AcpNativeProcess {
  readonly client: AcpClientConnection;
  readonly transport: AcpJsonRpcTransport;
  private readonly process: AcpSubprocess;
  private shutdownFlight: Promise<void> | null = null;

  constructor(options: AcpNativeProcessOptions) {
    this.process = new AcpSubprocess(options.launch);
    this.process.start();
    this.transport = new AcpJsonRpcTransport({
      input: this.process.stdout,
      onClose: listener => this.process.onClose(listener),
      output: this.process.stdin,
    });
    this.client = new AcpClientConnection({
      ...(options.clientCapabilities ? { clientCapabilities: options.clientCapabilities } : {}),
      clientInfo: { name: 'claudian', version: options.version },
      delegate: options.delegate,
      ...(options.methodOverrides ? { methodOverrides: options.methodOverrides } : {}),
      transport: this.transport,
    });
  }

  isAlive(): boolean {
    return this.process.isAlive();
  }

  onClose(listener: (error?: Error) => void): () => void {
    return this.process.onClose(listener);
  }

  flush(): Promise<void> {
    return this.transport.flush();
  }

  shutdown(releaseListeners: () => void = () => undefined): Promise<void> {
    this.shutdownFlight ??= (async () => {
      releaseListeners();
      this.client.dispose();
      this.transport.dispose();
      await this.process.shutdown();
    })();
    return this.shutdownFlight;
  }
}
