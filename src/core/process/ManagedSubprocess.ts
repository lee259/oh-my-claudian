import type { Readable, Writable } from 'node:stream';

import {
  ManagedStdioProcess,
  type ManagedStdioProcessExitState,
  type ManagedStdioProcessOptions,
} from './ManagedStdioProcess';

export type SubprocessCloseListener = (error?: Error) => void;

export class ManagedSubprocess {
  private closeError: Error | null = null;
  private readonly closeListeners = new Set<SubprocessCloseListener>();
  private notifiedClose = false;
  private readonly process: ManagedStdioProcess;

  constructor(options: ManagedStdioProcessOptions) {
    this.process = new ManagedStdioProcess(options);
    this.process.onError((error) => {
      this.closeError = error;
      this.notifyClose(error);
    });
    this.process.onExit((state) => this.handleExit(state));
  }

  get stdin(): Writable {
    return this.requireStarted().stdin;
  }

  get stdout(): Readable {
    return this.requireStarted().stdout;
  }

  get stderr(): Readable {
    return this.requireStarted().stderr;
  }

  start(): void {
    this.process.start();
  }

  isAlive(): boolean {
    return this.process.isAlive();
  }

  getStderrSnapshot(): string {
    return this.process.getStderrSnapshot();
  }

  onClose(listener: SubprocessCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  shutdown(): Promise<void> {
    return this.process.shutdown();
  }

  private handleExit({ code, signal }: ManagedStdioProcessExitState): void {
    const exitError = this.closeError ?? (
      code === 0 && signal === null
        ? undefined
        : new Error(`Subprocess exited (${formatExit(code, signal)})`)
    );
    this.notifyClose(exitError);
  }

  private requireStarted(): ManagedStdioProcess {
    if (!this.process.isStarted()) {
      throw new Error('Subprocess is not started');
    }
    return this.process;
  }

  private notifyClose(error?: Error): void {
    if (this.notifiedClose) return;
    this.notifiedClose = true;
    for (const listener of [...this.closeListeners]) {
      try {
        listener(error);
      } catch {
        // Close observers cannot interrupt process cleanup.
      }
    }
    this.closeListeners.clear();
  }
}

function formatExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `signal ${signal}`;
  if (code === null) return 'unknown';
  return `code ${code}`;
}
