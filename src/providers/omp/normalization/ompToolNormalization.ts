import { TOOL_EDIT, TOOL_READ, TOOL_WRITE } from '../../../core/tools/toolNames';
import type { SDKToolUseResult, StructuredPatchHunk } from '../../../core/types/diff';
import {
  type AcpResolvedToolRawName,
  AcpToolStreamAdapter,
} from '../../acp';

export function createOmpToolStreamAdapter(): AcpToolStreamAdapter {
  return new AcpToolStreamAdapter({
    normalizeToolInput: normalizeOmpToolInput,
    normalizeToolName: normalizeOmpToolName,
    normalizeToolUseResult: normalizeOmpToolUseResult,
    resolveRawToolName: resolveOmpRawToolName,
  });
}

export function resolveOmpRawToolName(
  current: AcpResolvedToolRawName | undefined,
  update: { kind?: string | null; title?: string | null },
): AcpResolvedToolRawName {
  const kind = update.kind?.trim().toLowerCase();
  const title = update.title?.trim() ?? '';
  const mappedKind = mapOmpToolName(kind);
  if (mappedKind) return { provenance: 'mapped-kind', rawName: mappedKind };

  const mappedTitle = mapOmpToolName(title);
  if (mappedTitle) return { provenance: 'title', rawName: mappedTitle };
  if (current) return current;
  return { provenance: 'title', rawName: title || 'tool' };
}

export function normalizeOmpToolName(rawName: string | undefined): string {
  return mapOmpToolName(rawName) ?? rawName?.trim() ?? 'tool';
}

export function normalizeOmpToolInput(
  rawName: string | undefined,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedName = normalizeOmpToolName(rawName);
  if (normalizedName === TOOL_EDIT && typeof input.file_path !== 'string') {
    const path = typeof input.path === 'string'
      ? input.path
      : typeof input.input === 'string'
        ? input.input.match(/^\[([^\r\n]+)#[\da-f]+\]/iu)?.[1]
        : undefined;
    if (path) return { ...input, file_path: path };
  }
  if (
    (normalizedName === TOOL_READ || normalizedName === TOOL_WRITE || normalizedName === TOOL_EDIT)
    && typeof input.path === 'string'
    && typeof input.file_path !== 'string'
  ) {
    return { ...input, file_path: input.path };
  }
  return input;
}

export function normalizeOmpToolUseResult(
  rawName: string | undefined,
  input: Record<string, unknown>,
  rawOutput: unknown,
  rawInput?: unknown,
): SDKToolUseResult {
  const result: SDKToolUseResult = {
    providerPayload: {
      rawName,
      ...(rawInput !== undefined ? { rawInput } : {}),
      ...(rawOutput !== undefined ? { rawOutput } : {}),
    },
  };
  if (normalizeOmpToolName(rawName) !== TOOL_EDIT || !isRecord(rawOutput)) return result;
  let details = isRecord(rawOutput.details) ? rawOutput.details : rawOutput;
  if (Array.isArray(details.perFileResults)) {
    // The shared Write/Edit card represents one file. Keep multi-file data opaque.
    if (details.perFileResults.length !== 1 || !isRecord(details.perFileResults[0])) return result;
    details = details.perFileResults[0];
  }
  if (details.isError === true) return result;
  const filePath = typeof details.path === 'string' ? details.path : input.file_path;
  if (typeof filePath === 'string') result.filePath = filePath;
  if (typeof details.diff === 'string') {
    const structuredPatch = parseOmpNumberedDiff(details.diff);
    if (structuredPatch.length > 0) result.structuredPatch = structuredPatch;
  }
  if (typeof details.oldText === 'string' && typeof details.newText === 'string') {
    result.oldText = details.oldText;
    result.newText = details.newText;
  }
  return result;
}

/** OMP context/delete rows use old coordinates; insert rows use new coordinates. */
function parseOmpNumberedDiff(diff: string): StructuredPatchHunk[] {
  const hunks: StructuredPatchHunk[] = [];
  let current: StructuredPatchHunk | undefined;
  let offset = 0;
  for (const row of diff.split(/\r?\n/u)) {
    const match = row.match(/^([ +-])\s*(\d+)\|(.*)$/u);
    if (!match) {
      current = undefined;
      continue;
    }
    const [, prefix, number, text] = match;
    const line = Number(number);
    if (!Number.isSafeInteger(line) || line < 1) continue;
    const expected = prefix === '+'
      ? current && current.newStart + current.newLines
      : current && current.oldStart + current.oldLines;
    if (!current || expected !== line) {
      current = {
        oldStart: prefix === '+' ? Math.max(1, line - offset) : line,
        newStart: prefix === '+' ? line : Math.max(1, line + offset),
        oldLines: 0,
        newLines: 0,
        lines: [],
      };
      hunks.push(current);
    }
    current.lines.push(prefix + text);
    if (prefix !== '+') current.oldLines++;
    if (prefix !== '-') current.newLines++;
    if (prefix === '+') offset++;
    if (prefix === '-') offset--;
  }
  return hunks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mapOmpToolName(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'read' || /^reading\s+.+\s+for\s+context$/u.test(normalized)) return TOOL_READ;
  if (normalized === 'write' || /^writing\s+.+\s+for\s+context$/u.test(normalized)) return TOOL_WRITE;
  if (normalized === 'edit' || /^editing\s+.+\s+for\s+context$/u.test(normalized)) return TOOL_EDIT;
  return undefined;
}
