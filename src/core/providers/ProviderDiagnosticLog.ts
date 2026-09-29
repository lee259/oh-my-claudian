import type { ProviderId } from '../types/provider';
import { sanitizeDiagnosticMessage } from './ProviderDiagnostics';

const MAX_DIAGNOSTIC_LINE_LENGTH = 16_000;
const OMITTED_DIAGNOSTIC_LINE = '[stderr line omitted because it exceeded the diagnostic size limit]';

export type ProviderDiagnosticLogSource = ProviderId | 'claudian';

export type ProviderDiagnosticLogEvent =
  | 'process-started'
  | 'process-stderr'
  | 'process-exited'
  | 'execution-error'
  | 'uncaught-exception'
  | 'unhandled-rejection';

export interface ProviderDiagnosticLogRecord {
  readonly args?: readonly string[];
  readonly command?: string;
  readonly cwd?: string;
  readonly event: ProviderDiagnosticLogEvent;
  readonly exitCode?: number | null;
  readonly message?: string;
  readonly signal?: string | null;
  readonly source: ProviderDiagnosticLogSource;
  readonly timestamp?: number;
}

export interface ProviderDiagnosticLogSink {
  write(record: ProviderDiagnosticLogRecord): Promise<void>;
}

/** Buffers complete stderr lines so secrets split across stream chunks are redacted together. */
export class ProviderDiagnosticStreamBuffer {
  private pendingLine = '';
  private droppingLine = false;

  write(chunk: string): string[] {
    const messages: string[] = [];
    let offset = 0;

    while (offset < chunk.length) {
      if (this.droppingLine) {
        const newline = chunk.indexOf('\n', offset);
        if (newline < 0) return messages;
        this.droppingLine = false;
        offset = newline + 1;
        continue;
      }

      const newline = chunk.indexOf('\n', offset);
      const hasNewline = newline >= 0;
      const end = hasNewline ? newline : chunk.length;
      const segment = chunk.slice(offset, end);
      if (this.pendingLine.length + segment.length > MAX_DIAGNOSTIC_LINE_LENGTH) {
        messages.push(OMITTED_DIAGNOSTIC_LINE);
        this.pendingLine = '';
        this.droppingLine = !hasNewline;
      } else {
        this.pendingLine += segment;
        if (hasNewline) {
          messages.push(this.pendingLine);
          this.pendingLine = '';
        }
      }

      if (!hasNewline) return messages;
      offset = newline + 1;
    }

    return messages;
  }

  end(): string[] {
    if (this.droppingLine) {
      this.droppingLine = false;
      return [];
    }
    if (!this.pendingLine) return [];
    const message = this.pendingLine;
    this.pendingLine = '';
    return [message];
  }
}

const SENSITIVE_ARGUMENT_FLAG = /^(?:--?|\/)(?:.*(?:api[-_]?key|token|secret|password|credential|authorization|system[-_]?prompt))/iu;

export function sanitizeDiagnosticArguments(args: readonly string[]): string[] {
  const sanitized: string[] = [];
  let redactNext = false;

  for (const argument of args) {
    if (redactNext) {
      sanitized.push('[REDACTED]');
      redactNext = false;
      continue;
    }

    const separatorIndex = argument.indexOf('=');
    const flag = separatorIndex >= 0 ? argument.slice(0, separatorIndex) : argument;
    if (SENSITIVE_ARGUMENT_FLAG.test(flag)) {
      if (separatorIndex >= 0) {
        sanitized.push(`${flag}=[REDACTED]`);
      } else {
        sanitized.push(argument);
        redactNext = true;
      }
      continue;
    }

    sanitized.push(sanitizeDiagnosticMessage(argument));
  }

  return sanitized;
}

export function sanitizeProviderDiagnosticLogRecord(
  record: ProviderDiagnosticLogRecord,
): ProviderDiagnosticLogRecord {
  return {
    ...record,
    ...(record.args ? { args: sanitizeDiagnosticArguments(record.args) } : {}),
    ...(record.command ? { command: sanitizeDiagnosticMessage(record.command) } : {}),
    ...(record.cwd ? { cwd: sanitizeDiagnosticMessage(record.cwd) } : {}),
    ...(record.message ? { message: sanitizeDiagnosticMessage(record.message).slice(-16_000) } : {}),
  };
}
