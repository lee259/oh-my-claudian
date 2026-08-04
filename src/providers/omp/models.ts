export interface OmpDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

const OMP_MODEL_PREFIX = 'omp:';

export function encodeOmpModelId(rawId: string): string {
  const normalized = rawId.trim();
  return normalized ? `${OMP_MODEL_PREFIX}${normalized}` : '';
}

export function decodeOmpModelId(value: string): string | null {
  if (!value.startsWith(OMP_MODEL_PREFIX)) return null;
  const rawId = value.slice(OMP_MODEL_PREFIX.length).trim();
  return rawId || null;
}

export function normalizeOmpDiscoveredModels(value: unknown): OmpDiscoveredModel[] {
  if (!Array.isArray(value)) return [];
  const result: OmpDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const rawId = firstText(record.rawId, record.id, record.modelId)?.trim() ?? '';
    if (!rawId || seen.has(rawId)) continue;
    seen.add(rawId);
    const label = firstText(record.label, record.name)?.trim() || rawId;
    const description = firstText(record.description)?.trim();
    result.push({ ...(description ? { description } : {}), label, rawId });
  }
  return result;
}

export function normalizeOmpConfigOptionModels(value: unknown): OmpDiscoveredModel[] {
  if (!Array.isArray(value)) return [];
  const modelOption = value.find(option => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return false;
    const record = option as Record<string, unknown>;
    return record.id === 'model' && record.type === 'select';
  }) as Record<string, unknown> | undefined;
  if (!modelOption || !Array.isArray(modelOption.options)) return [];

  return normalizeOmpDiscoveredModels(modelOption.options.map(option => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return null;
    const record = option as Record<string, unknown>;
    return {
      description: record.description,
      name: record.name,
      modelId: record.value,
    };
  }));
}

export function normalizeOmpVisibleModels(
  value: unknown,
  discoveredModels: OmpDiscoveredModel[] = [],
): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(discoveredModels.map(model => model.rawId));
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const rawId = entry.trim();
    if (!rawId || (known.size > 0 && !known.has(rawId)) || result.includes(rawId)) continue;
    result.push(rawId);
  }
  return result;
}

function firstText(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}
