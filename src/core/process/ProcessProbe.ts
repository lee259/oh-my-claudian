import { ManagedStdioProcess, type ManagedStdioProcessOptions } from './ManagedStdioProcess';

const NATIVE_PROCESS_PROBE_TIMEOUT_MS = 15_000;
const MAX_PROCESS_PROBE_OUTPUT_BYTES = 16_384;

/** Runs a bounded, read-only command without sharing a chat process. */
export async function runProcessProbe(
  options: ManagedStdioProcessOptions & { signal?: AbortSignal },
  timeoutMs = NATIVE_PROCESS_PROBE_TIMEOUT_MS,
): Promise<string | null> {
  if (options.signal?.aborted) return null;
  const process = new ManagedStdioProcess(options);
  const output: Buffer[] = [];
  let outputBytes = 0;
  let timer: number | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      };
      onAbort = () => finish(null);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      process.onError(() => finish(null));
      process.onClose(({ code, error }) => finish(
        code === 0 && !error ? Buffer.concat(output).toString('utf8') : null,
      ));
      timer = window.setTimeout(() => finish(null), timeoutMs);
      process.start();
      process.stdin.end();
      process.stdout.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        outputBytes += bytes.length;
        if (outputBytes > MAX_PROCESS_PROBE_OUTPUT_BYTES) {
          finish(null);
          return;
        }
        output.push(bytes);
      });
    });
  } catch {
    return null;
  } finally {
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
    window.clearTimeout(timer);
    await process.shutdown();
  }
}
