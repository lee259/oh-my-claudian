export interface CursorDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
  reasoning?: CursorReasoningConfig | null;
}

export interface CursorReasoningConfig {
  parameterId: string;
  currentValue: string;
  options: Array<{ label: string; value: string }>;
}

const CURSOR_MODEL_PREFIX = 'cursor:';

export function encodeCursorModelId(rawId: string): string {
  const normalized = rawId.trim();
  return normalized ? `${CURSOR_MODEL_PREFIX}${normalized}` : '';
}

export function decodeCursorModelId(value: string): string | null {
  if (!value.startsWith(CURSOR_MODEL_PREFIX)) return null;
  const rawId = value.slice(CURSOR_MODEL_PREFIX.length).trim();
  return rawId || null;
}

export function normalizeCursorDiscoveredModels(value: unknown): CursorDiscoveredModel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const models: CursorDiscoveredModel[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const rawId = firstText(record.modelId, record.id, record.rawId)?.trim() ?? '';
    if (!rawId || seen.has(rawId)) continue;
    seen.add(rawId);
    const label = firstText(record.name, record.label)?.trim() || rawId;
    const description = firstText(record.description)?.trim();
    const reasoning = normalizeCursorReasoningConfig(record.reasoning);
    models.push({ ...(description ? { description } : {}), label, rawId,
      ...(reasoning ? { reasoning } : record.reasoning === null ? { reasoning: null } : {}) });
  }
  return models;
}

/** Cursor owns both the parameter names and the allowed values. */
export function normalizeCursorReasoningConfig(value: unknown): CursorReasoningConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.parameterId !== 'string'
    || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(record.parameterId)
    || typeof record.currentValue !== 'string' || !Array.isArray(record.options)) return undefined;
  const options: CursorReasoningConfig['options'] = [];
  for (const entry of record.options) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const option = entry as Record<string, unknown>;
    if (typeof option.value !== 'string' || !option.value || /[[\],=]/u.test(option.value)
      || typeof option.label !== 'string' || !option.label
      || options.some(existing => existing.value === option.value)) continue;
    options.push({ label: option.label, value: option.value });
  }
  if (!options.some(option => option.value === record.currentValue)) return undefined;
  return { parameterId: record.parameterId, currentValue: record.currentValue, options };
}

export function attachCursorReasoningCatalog(
  models: CursorDiscoveredModel[],
  catalog: unknown,
): CursorDiscoveredModel[] {
  if (!catalog || typeof catalog !== 'object' || !Array.isArray((catalog as { models?: unknown }).models)) return models;
  const entries = (catalog as { models: unknown[] }).models;
  return models.map(model => {
    const baseId = model.rawId.split('[')[0];
    const entry = entries.find(value => value && typeof value === 'object'
      && (value as Record<string, unknown>).value === baseId) as Record<string, unknown> | undefined;
    if (!entry || !Array.isArray(entry.configOptions)) return model;
    const candidates = (entry.configOptions as unknown[]).filter((value): value is Record<string, unknown> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      return record.type === 'select' && record.category === 'thought_level';
    });
    // Prefer effort over a separate thinking on/off switch when both exist.
    const option = candidates.find(value => value.id !== 'thinking') ?? candidates[0];
    if (!option || !Array.isArray(option.options)) return { ...model, reasoning: null };
    const reasoning = normalizeCursorReasoningConfig({
      parameterId: option.id,
      currentValue: option.currentValue,
      options: (option.options as unknown[]).map(value => {
        const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        return { label: entry.name, value: entry.value };
      }),
    });
    return { ...model, reasoning: reasoning ?? null };
  });
}

export function getCursorModelReasoning(
  rawId: string,
  models: CursorDiscoveredModel[],
): CursorReasoningConfig | undefined {
  const config = models.find(model => model.rawId === rawId)?.reasoning;
  if (!config) return undefined;
  const parameters = /\[([^[\]]*)\]$/u.exec(rawId)?.[1].split(',') ?? [];
  const currentValue = parameters.find(parameter => parameter.split('=')[0] === config.parameterId)?.split('=')[1];
  return currentValue && config.options.some(option => option.value === currentValue)
    ? { ...config, currentValue } : config;
}

export function resolveCursorReasoningModelId(
  rawId: string,
  reasoning: string | null | undefined,
  models: CursorDiscoveredModel[],
): string {
  const config = getCursorModelReasoning(rawId, models);
  if (!config || !config.options.some(option => option.value === reasoning)) return rawId;
  const match = /^(.*?)\[([^[\]]*)\]$/u.exec(rawId);
  if (!match && /[[\]]/u.test(rawId)) return rawId;
  const parameters = match?.[2].split(',').filter(Boolean) ?? [];
  const index = parameters.findIndex(parameter => parameter.split('=')[0] === config.parameterId);
  const parameter = `${config.parameterId}=${reasoning}`;
  if (index === -1) parameters.push(parameter);
  else parameters[index] = parameter;
  return `${match?.[1] ?? rawId}[${parameters.join(',')}]`;
}

export function normalizeCursorVisibleModels(
  value: unknown,
  discoveredModels: CursorDiscoveredModel[] = [],
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
