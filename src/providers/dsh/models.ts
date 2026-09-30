import type { DshDiscoveredModel, DshReasoningConfig } from './settings';

const DSH_MODEL_PREFIX = 'dsh:';
export const LEGACY_FORCED_DSH_DEFAULT_MODEL_ID = '["deepseek-official","deepseek-flash"]';

export interface DshConfigOptionCatalog {
  defaultModelId: string | null;
  models: DshDiscoveredModel[];
}

export interface DshModelRoute {
  modelId: string;
  providerId: string;
}

export function encodeDshModelId(rawId: string): string {
  const value = rawId.trim();
  return value ? `${DSH_MODEL_PREFIX}${value}` : '';
}

export function decodeDshModelId(value: string): string | null {
  if (!value.startsWith(DSH_MODEL_PREFIX)) return null;
  const rawId = value.slice(DSH_MODEL_PREFIX.length).trim();
  return rawId || null;
}

export function normalizeDshConfigOptionModels(value: unknown): DshDiscoveredModel[] {
  return normalizeDshConfigOptionCatalog(value).models;
}

export function normalizeDshConfigOptionCatalog(value: unknown): DshConfigOptionCatalog {
  if (!Array.isArray(value)) return { defaultModelId: null, models: [] };
  const modelOption = (value as unknown[]).find((entry) => {
    if (!isRecord(entry)) return false;
    return entry.id === 'model' && entry.type === 'select';
  });
  if (!isRecord(modelOption) || !Array.isArray(modelOption.options)) {
    return { defaultModelId: null, models: [] };
  }

  const models: DshDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of modelOption.options) {
    if (!isRecord(entry)) continue;
    if (Array.isArray(entry.options)) {
      const groupLabel = text(entry.name) ?? text(entry.group) ?? '';
      for (const option of entry.options) {
        appendModel(models, seen, option, groupLabel);
      }
    } else {
      appendModel(models, seen, entry, '');
    }
  }
  const currentValue = text(modelOption.currentValue);
  return {
    defaultModelId: currentValue && seen.has(currentValue) ? currentValue : null,
    models,
  };
}

export function normalizeDshDiscoveredModels(value: unknown): DshDiscoveredModel[] {
  if (!Array.isArray(value)) return [];
  const result: DshDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) appendModel(result, seen, entry, '');
  return result;
}

export function normalizeDshVisibleModels(value: unknown, models: readonly DshDiscoveredModel[] = []): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(models.map(model => model.rawId));
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const rawId = entry.trim();
    if (known.has(rawId) && !result.includes(rawId)) result.push(rawId);
  }
  return result;
}

export function normalizeDshReasoningConfigOptions(value: unknown): DshReasoningConfig | null {
  if (!Array.isArray(value)) return null;
  const option = (value as unknown[]).find((entry) => {
    if (!isRecord(entry)) return false;
    return entry.id === 'reasoning_effort' && entry.type === 'select';
  });
  if (!isRecord(option) || !Array.isArray(option.options)) return null;

  const options = (option.options as unknown[]).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = text(entry.value);
    if (!id) return [];
    const description = text(entry.description);
    return [{
      ...(description ? { description } : {}),
      id,
      name: text(entry.name) ?? id,
    }];
  });
  if (!options.length) return null;

  return {
    configId: text(option.id) ?? 'reasoning_effort',
    currentValue: text(option.currentValue),
    options,
  };
}

function appendModel(
  models: DshDiscoveredModel[],
  seen: Set<string>,
  value: unknown,
  groupLabel: string,
): void {
  if (!isRecord(value)) return;
  const rawId = text(value.rawId) ?? text(value.value) ?? text(value.modelId) ?? text(value.id);
  if (!rawId || seen.has(rawId)) return;
  seen.add(rawId);
  const modelName = text(value.name) ?? text(value.label);
  const labelName = modelName && modelName !== rawId ? modelName : formatDshModelId(rawId);
  const description = text(value.description);
  const label = groupLabel && !labelName.toLowerCase().startsWith(groupLabel.toLowerCase())
    ? `${groupLabel} · ${labelName}`
    : labelName;
  models.push({
    ...(description ? { description } : {}),
    label,
    rawId,
  });
}

export function parseDshModelRoute(value: string): DshModelRoute | null {
  try {
    const route: unknown = JSON.parse(value);
    if (
      Array.isArray(route)
      && route.length === 2
      && typeof route[0] === 'string'
      && route[0].trim()
      && typeof route[1] === 'string'
      && route[1].trim()
    ) {
      return { modelId: route[1], providerId: route[0] };
    }
  } catch {
    // Most DSH config-option values are provider-specific opaque strings.
  }
  return null;
}

function formatDshModelId(rawId: string): string {
  const modelId = parseDshModelRoute(rawId)?.modelId ?? rawId;
  const acronyms: Record<string, string> = { deepseek: 'DeepSeek', gpt: 'GPT' };
  return modelId.split(/[-_]/u).map(part => {
    const lower = part.toLowerCase();
    if (acronyms[lower]) return acronyms[lower];
    if (/^v\d+(?:\.\d+)*$/iu.test(part)) return part.toUpperCase();
    return part ? `${part[0].toUpperCase()}${part.slice(1)}` : part;
  }).join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
