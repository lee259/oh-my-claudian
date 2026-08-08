import { TOOL_EDIT, TOOL_READ, TOOL_WRITE } from '../../../core/tools/toolNames';
import {
  type AcpResolvedToolRawName,
  AcpToolStreamAdapter,
} from '../../acp';

export function createOmpToolStreamAdapter(): AcpToolStreamAdapter {
  return new AcpToolStreamAdapter({
    normalizeToolInput: normalizeOmpToolInput,
    normalizeToolName: normalizeOmpToolName,
    normalizeToolUseResult: () => undefined,
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

function normalizeOmpToolInput(
  rawName: string | undefined,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedName = normalizeOmpToolName(rawName);
  if (
    (normalizedName === TOOL_READ || normalizedName === TOOL_WRITE || normalizedName === TOOL_EDIT)
    && typeof input.path === 'string'
    && typeof input.file_path !== 'string'
  ) {
    return { ...input, file_path: input.path };
  }
  return input;
}

function mapOmpToolName(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (/^(?:read|reading)\b/u.test(normalized)) return TOOL_READ;
  if (/^(?:write|writing)\b/u.test(normalized)) return TOOL_WRITE;
  if (/^(?:edit|editing)\b/u.test(normalized)) return TOOL_EDIT;
  return undefined;
}
