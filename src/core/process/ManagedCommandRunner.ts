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
  stdoutLimitBytes: number;
  /** Also pipe stderr and expose it on the result. Defaults to false. */
  captureStderr?: boolean;
}

export interface ManagedCommandResult {
  exitCode: number | null;
  stdout: string;
  termination?: ManagedCommandTermination;
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
        stdio: request.captureStderr ? 'pipe' : ['ignore', 'pipe', 'ignore'],
      });
      const chunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let byteLength = 0;
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
        finish(result);
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
          finish({ exitCode: null, stdout: '', termination: 'error' });
          return;
        }
        const result: ManagedCommandResult = {
          exitCode: code,
          stdout: Buffer.concat(chunks).toString('utf8'),
        };
        if (stderrChunks.length > 0) {
          result.stderr = Buffer.concat(stderrChunks).toString('utf8');
        }
        finish(result);
      });

      try {
        process.start();
      } catch {
        finish({ exitCode: null, stdout: '', termination: 'error' });
        return;
      }

      if (request.signal?.aborted) {
        onAbort();
        return;
      }

      process.stdout.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteLength += buffer.byteLength;
        if (byteLength > request.stdoutLimitBytes) {
          terminate({ exitCode: null, stdout: '', termination: 'output-limit' });
          return;
        }
        chunks.push(buffer);
      });

      if (request.captureStderr) {
        process.stderr.on('data', (chunk: Buffer | string) => {
          stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
      }
    });
  }
}
