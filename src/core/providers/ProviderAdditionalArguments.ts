import type { ProviderId } from './types';

/** Splits the settings editor's one-argument-per-line value without invoking a shell. */
export function parseProviderAdditionalArguments(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value.split(/\r?\n/u).filter(argument => argument.trim().length > 0);
}

export function getProviderAdditionalArguments(
  settings: Record<string, unknown>,
  providerId: ProviderId,
): string[] {
  const values = settings.providerAdditionalArguments;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
  return parseProviderAdditionalArguments((values as Record<string, unknown>)[providerId]);
}

export function setProviderAdditionalArguments(
  settings: Record<string, unknown>,
  providerId: ProviderId,
  value: string,
): void {
  const current = settings.providerAdditionalArguments;
  const values = current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  settings.providerAdditionalArguments = { ...values, [providerId]: value };
}
