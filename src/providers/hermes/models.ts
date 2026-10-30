export interface HermesDiscoveredModel {
  description?: string;
  available?: boolean;
  label: string;
  rawId: string;
}

const PREFIX = 'hermes:';

export function encodeHermesModelId(rawId: string): string {
  const value = rawId.trim();
  return value ? `${PREFIX}${value}` : '';
}

export function decodeHermesModelId(value: string): string | null {
  if (!value.startsWith(PREFIX)) return null;
  return value.slice(PREFIX.length).trim() || null;
}

export function normalizeHermesDiscoveredModels(value: unknown): HermesDiscoveredModel[] {
  if (!Array.isArray(value)) return [];
  const models: HermesDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.modelId === 'string' ? record.modelId : record.rawId;
    if (typeof id !== 'string' || !id.trim() || seen.has(id.trim())) continue;
    const rawId = id.trim();
    seen.add(rawId);
    const name = typeof record.name === 'string' ? record.name : record.label;
    const label = typeof name === 'string' && name.trim() ? name.trim() : rawId;
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    models.push({ rawId, label, ...(description ? { description } : {}), ...(record.available === false ? { available: false } : {}) });
  }
  return models;
}

export function normalizeHermesVisibleModels(value: unknown, models: HermesDiscoveredModel[]): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(models.map(model => model.rawId));
  const selected = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && known.has(entry.trim())) selected.add(entry.trim());
  }
  return [...selected];
}
