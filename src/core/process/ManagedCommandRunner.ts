import type { ManagedStdioProcessOptions } from './ManagedStdioProcess';
import { ManagedSubprocess } from './ManagedSubprocess';

export type ManagedCommandTermination = 'abort' | 'error' | 'output-limit' | 'timeout';

export interface ManagedCommandRequest {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  spawn?: ManagedStdioProcessOptions['spawn'];
  timeoutMs: number;
  /** Combined output limit, or a per-stream tail limit when truncating. */
  stdoutLimitBytes: number;
  /** Truncation keeps a bounded tail per stream without terminating the command. */
  outputLimitBehavior?: 'terminate' | 'truncate';
  /** Also pipe stderr and expose it on the result. Defaults to false. */
  captureStderr?: boolean;
}

export interface ManagedCommandResult {
  exitCode: number | null;
  stdout: string;
  termination?: ManagedCommandTermination;
  error?: string;
  outputTruncated?: boolean;
  /** Captured stderr output when `captureStderr` is enabled. */
  stderr?: string;
}

export class ManagedCommandRunner {
  run(request: ManagedCommandRequest): Promise<ManagedCommandResult> {
    if (request.signal?.aborted) {
      return Promise.resolve({ exitCode: null, stdout: '', termination: 'abort' });
    }

    return new Promise(resolve => {
      const process = new ManagedSubprocess({
        args: request.args,
        command: request.command,
        cwd: request.cwd,
        env: request.env,
        finalShutdownTimeoutMs: 0,
        sigkillTimeoutMs: 0,
        spawn: request.spawn,
        stdio: request.captureStderr ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'ignore'],
      });
      const chunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let byteLength = 0;
      let outputTruncated = false;
      const capturedLengths = new Map<Buffer[], number>();
      const captured = (): Pick<ManagedCommandResult, 'stdout' | 'stderr' | 'outputTruncated'> => ({
        stdout: Buffer.concat(chunks).toString('utf8'),
        ...(stderrChunks.length ? { stderr: Buffer.concat(stderrChunks).toString('utf8') } : {}),
        ...(outputTruncated ? { outputTruncated: true } : {}),
      });
      let settled = false;
      let timeout: number | null = null;

      const finish = (result: ManagedCommandResult): void => {
        if (settled) return;
        settled = true;
        if (timeout !== null) window.clearTimeout(timeout);
        request.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const terminate = (result: ManagedCommandResult): void => {
        void process.shutdown();
        finish({ ...result, ...captured() });
      };
      const onAbort = (): void => {
        terminate({ exitCode: null, stdout: '', termination: 'abort' });
      };

      request.signal?.addEventListener('abort', onAbort, { once: true });
      timeout = window.setTimeout(() => {
        terminate({ exitCode: null, stdout: '', termination: 'timeout' });
      }, request.timeoutMs);

      process.onCloseState(({ code, error }) => {
        if (error) {
          finish({ exitCode: null, ...captured(), termination: 'error', error: error.message });
          return;
        }
        finish({ exitCode: code, ...captured() });
      });

      try {
        process.start();
      } catch (error) {
        finish({ exitCode: null, ...captured(), termination: 'error', error: error instanceof Error ? error.message : String(error) });
        return;
      }

      if (request.signal?.aborted) {
        onAbort();
        return;
      }

      const collect = (destination: Buffer[], chunk: Buffer | string): void => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteLength += buffer.byteLength;
        if (request.outputLimitBehavior !== 'truncate') {
          if (byteLength > request.stdoutLimitBytes) {
            terminate({ exitCode: null, stdout: '', termination: 'output-limit' });
            return;
          }
          destination.push(buffer);
          return;
        }
        destination.push(buffer);
        let length = (capturedLengths.get(destination) ?? 0) + buffer.byteLength;
        while (length > request.stdoutLimitBytes && destination.length) {
          outputTruncated = true;
          const first = destination[0];
          const excess = length - request.stdoutLimitBytes;
          if (first.byteLength <= excess) {
            destination.shift();
            length -= first.byteLength;
          } else {
            destination[0] = first.subarray(excess);
            length -= excess;
          }
        }
        capturedLengths.set(destination, length);
      };
      process.stdout.on('data', (chunk: Buffer | string) => collect(chunks, chunk));
      if (request.captureStderr) {
        process.stderr.on('data', (chunk: Buffer | string) => collect(stderrChunks, chunk));
      }
    });
  }
}
