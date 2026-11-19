import type { Writable } from 'node:stream';

export function writePiJsonl(
  output: Writable | NodeJS.WritableStream,
  record: unknown,
): void {
  output.write(`${JSON.stringify(record)}\n`);
}
