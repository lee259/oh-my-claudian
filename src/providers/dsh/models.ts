const DSH_MODEL_PREFIX = 'dsh:';

export function encodeDshModelId(rawId: string): string {
  const value = rawId.trim();
  return value ? `${DSH_MODEL_PREFIX}${value}` : '';
}

export function decodeDshModelId(value: string): string | null {
  if (!value.startsWith(DSH_MODEL_PREFIX)) return null;
  const rawId = value.slice(DSH_MODEL_PREFIX.length).trim();
  return rawId || null;
}
