import type { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { LineBuffer } from '@/utils/LineBuffer';

export type PiJsonlLineHandler = (line: string) => void;

interface JsonlReadableStream {
  off(eventName: 'data', listener: (chunk: Buffer | string) => void): unknown;
  off(eventName: 'end' | 'close', listener: () => void): unknown;
  off(eventName: 'error', listener: (error: unknown) => void): unknown;
  on(eventName: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(eventName: 'end' | 'close', listener: () => void): unknown;
  on(eventName: 'error', listener: (error: unknown) => void): unknown;
}

export function subscribePiJsonlLines(
  input: JsonlReadableStream,
  onLine: PiJsonlLineHandler,
  onEnd?: () => void,
  onError?: (error: Error) => void,
): () => void {
  const lines = new LineBuffer();
  const decoder = new StringDecoder('utf8');

  const handleData = (chunk: Buffer | string): void => {
    lines.push(decoder.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk), onLine);
  };

  const handleEnd = (): void => {
    lines.push(decoder.end(), onLine);
    if (lines.bufferedLength > 0) onLine(lines.take());
    onEnd?.();
  };

  const handleError = (error: unknown): void => {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  };

  input.on('data', handleData);
  input.on('end', handleEnd);
  input.on('close', handleEnd);
  input.on('error', handleError);

  return () => {
    input.off('data', handleData);
    input.off('end', handleEnd);
    input.off('close', handleEnd);
    input.off('error', handleError);
  };
}

export function writePiJsonl(
  output: Writable | NodeJS.WritableStream,
  record: unknown,
): void {
  output.write(`${JSON.stringify(record)}\n`);
}
