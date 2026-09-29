import { sanitizeDiagnosticMessage,stringifyDiagnosticError } from '@/core/providers/ProviderDiagnostics';
import { JsonRpcErrorResponse } from '@/providers/acp';

const DETAIL_KEYS = ['code', 'detail', 'error', 'errorId', 'message', 'provider', 'reason', 'requestId', 'status', 'traceId'] as const;
const MAX_ERROR_DETAIL_LENGTH = 800;

/** Preserve useful ACP failure context without exposing arbitrary response payloads. */
export function formatOmpExecutionError(error: unknown): string {
  if (error instanceof JsonRpcErrorResponse) {
    const details = formatSafeErrorDetails(error.data);
    const message = cleanDiagnosticText(error.message);
    const lines = [`OMP ACP request "${error.method}" failed (JSON-RPC ${error.code}): ${message}`];
    if (details) {
      lines.push(`Details: ${details}`);
    } else if (error.code === -32603 && /^internal error$/iu.test(message)) {
      lines.push('OMP provided no additional safe details. Check its logs around this time and verify the selected provider/model is reachable.');
    }
    return lines.join('\n');
  }

  return cleanDiagnosticText(stringifyDiagnosticError(error));
}

function formatSafeErrorDetails(data: unknown): string | null {
  if (!isRecord(data)) return null;

  const nested = isRecord(data.error) ? data.error : null;
  const fields: string[] = [];
  for (const key of DETAIL_KEYS) {
    const value = data[key] ?? nested?.[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value).replace(/\s+/gu, ' ').trim();
    if (!text) continue;
    fields.push(`${key}=${text}`);
  }

  if (fields.length === 0) return null;
  return cleanDiagnosticText(fields.join('; ')).slice(0, MAX_ERROR_DETAIL_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanDiagnosticText(text: string): string {
  return sanitizeDiagnosticMessage(text)
    // eslint-disable-next-line no-control-regex -- Strip terminal escape sequences from provider diagnostics.
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    // eslint-disable-next-line no-control-regex -- Remove non-printing controls from provider diagnostics.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, ' ')
    .trim();
}
