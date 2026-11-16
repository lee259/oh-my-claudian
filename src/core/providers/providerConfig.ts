import type { ProviderSelectionInputs } from './ProviderRuntimeHost';
import type { ProviderId } from './types';

type ProviderConfigMap = Partial<Record<string, Record<string, unknown>>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function getProviderConfig(
  settings: Record<string, unknown>,
  providerId: ProviderId,
): Record<string, unknown> {
  const candidate = settings.providerConfigs;
  if (!isRecord(candidate)) {
    return {};
  }

  const config = candidate[providerId];
  return isRecord(config) ? { ...config } : {};
}

export function setProviderConfig(
  settings: Record<string, unknown>,
  providerId: ProviderId,
  config: Record<string, unknown>,
): void {
  const current = settings.providerConfigs;
  const nextConfigs: ProviderConfigMap = isRecord(current)
    ? { ...(current as ProviderConfigMap) }
    : {};

  nextConfigs[providerId] = { ...config };
  settings.providerConfigs = nextConfigs;
}

/** Replaces a configuration object in place so a transactional writer sees the exact result. */
export function replaceProviderConfig(
  config: Record<string, unknown>,
  next: Record<string, unknown>,
): void {
  for (const key of Object.keys(config)) delete config[key];
  Object.assign(config, next);
}

/** Model ids the current settings document references, regardless of provider ownership. */
export function getProviderSelectionInputs(
  settings: Readonly<Record<string, unknown>>,
  providerId: ProviderId,
): ProviderSelectionInputs {
  const saved = isRecord(settings.savedProviderModel)
    ? settings.savedProviderModel[providerId]
    : undefined;
  const ids = [settings.model, settings.titleGenerationModel, saved]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return { referencedModelIds: [...new Set(ids)] };
}
