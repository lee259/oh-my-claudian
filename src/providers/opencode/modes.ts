export interface OpencodeMode {
  description?: string | null;
  id: string;
  name: string;
}

export const OPENCODE_BUILD_MODE_ID = 'build';
/** Legacy IDs are normalized to native modes when loading older settings. */
export const LEGACY_OPENCODE_YOLO_MODE_ID = 'claudian-yolo';
export const LEGACY_OPENCODE_SAFE_MODE_ID = 'claudian-safe';
export const OPENCODE_PLAN_MODE_ID = 'plan';

export function isOpencodeBuildModeId(value: unknown): value is string {
  return typeof value === 'string' && value.toLowerCase() === OPENCODE_BUILD_MODE_ID;
}

export function isOpencodePlanModeId(value: unknown): value is string {
  return typeof value === 'string' && value.toLowerCase() === OPENCODE_PLAN_MODE_ID;
}

export function normalizeOpencodeAvailableModes(value: unknown): OpencodeMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: OpencodeMode[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : id;
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push({
      ...(description ? { description } : {}),
      id,
      name: name || id,
    });
  }

  return normalized;
}

/** Maps OpenCode v2 primary-capable agents into the same native mode catalog used by ACP. */
export function normalizeOpencodeAgentModes(value: unknown): OpencodeMode[] {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && !Array.isArray(value)
      && Array.isArray((value as Record<string, unknown>).data)
      ? (value as { data: unknown[] }).data
      : [];
  return normalizeOpencodeAvailableModes(entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const agent = entry as Record<string, unknown>;
    const name = typeof agent.name === 'string' ? agent.name.trim() : '';
    const mode = typeof agent.mode === 'string' ? agent.mode : 'primary';
    if (!name || agent.hidden === true || agent.disable === true || mode === 'subagent') return [];
    const normalizedName = name.toLowerCase();
    const id = normalizedName === 'build' || normalizedName === 'plan'
      ? normalizedName
      : name;
    return [{
      ...(typeof agent.description === 'string' ? { description: agent.description } : {}),
      id,
      name,
    }];
  }));
}

export function getEffectiveOpencodeModes(modes: OpencodeMode[]): OpencodeMode[] {
  return [...modes];
}

export function normalizeOpencodeSelectedMode(
  value: unknown,
): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed;
}

export function normalizeSelectedOpencodeMode(
  value: unknown,
  modes: OpencodeMode[] = [],
): string {
  const normalized = normalizeOpencodeSelectedMode(value);
  const canonicalModeId = normalized === LEGACY_OPENCODE_SAFE_MODE_ID
    || normalized === LEGACY_OPENCODE_YOLO_MODE_ID
    ? OPENCODE_BUILD_MODE_ID
    : normalized;
  if (modes.some((mode) => mode.id === canonicalModeId)) return canonicalModeId;
  if (modes.some((mode) => mode.id === OPENCODE_BUILD_MODE_ID)) return OPENCODE_BUILD_MODE_ID;
  return modes[0]?.id ?? '';
}

export function resolveOpencodeModeForPermissionMode(
  permissionMode: unknown,
  modes: OpencodeMode[] = [],
): string {
  const nativeModes = getEffectiveOpencodeModes(modes);
  const planMode = nativeModes.find((mode) => isOpencodePlanModeId(mode.id));
  if (permissionMode === 'plan' && planMode) {
    return planMode.id;
  }
  return nativeModes.find((mode) => isOpencodeBuildModeId(mode.id))?.id
    ?? nativeModes[0]?.id
    ?? '';
}

export function resolveOpencodePermissionMode(
  modeId: unknown,
): 'normal' | 'plan' | 'yolo' | null {
  return isOpencodePlanModeId(modeId) ? 'plan' : modeId ? 'normal' : null;
}
