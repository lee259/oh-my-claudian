import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import { readStoredBoolean, readStoredString } from '../../core/providers/settings/storedSettings';
import type { HostnameCliPaths } from '../../core/types/settings';

export interface DshProviderSettings {
  args: string[];
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  model: string;
}

export const DEFAULT_DSH_PROVIDER_SETTINGS: Readonly<DshProviderSettings> = Object.freeze({
  args: [],
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  model: '',
});

function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function getDshProviderSettings(settings: Record<string, unknown>): DshProviderSettings {
  const config = getProviderConfig(settings, 'dsh');
  return {
    args: normalizeArgs(config.args),
    cliPath: readStoredString(config.cliPath, DEFAULT_DSH_PROVIDER_SETTINGS.cliPath),
    cliPathsByHost: normalizeHostnameStringMap(config.cliPathsByHost),
    enabled: readStoredBoolean(config.enabled, DEFAULT_DSH_PROVIDER_SETTINGS.enabled),
    environmentHash: readStoredString(config.environmentHash, DEFAULT_DSH_PROVIDER_SETTINGS.environmentHash),
    environmentVariables: readStoredString(
      config.environmentVariables,
      getProviderEnvironmentVariables(settings, 'dsh') ?? DEFAULT_DSH_PROVIDER_SETTINGS.environmentVariables,
    ),
    model: readStoredString(config.model, DEFAULT_DSH_PROVIDER_SETTINGS.model),
  };
}

export function updateDshProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<DshProviderSettings>,
): DshProviderSettings {
  const next = { ...getDshProviderSettings(settings), ...updates };
  setProviderConfig(settings, 'dsh', next);
  return next;
}
