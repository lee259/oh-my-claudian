import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import {
  readStoredBoolean,
  readStoredString,
} from '../../core/providers/settings/storedSettings';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  type CursorDiscoveredModel,
  normalizeCursorDiscoveredModels,
  normalizeCursorVisibleModels,
} from './models';

export interface CursorProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  discoveredModels: CursorDiscoveredModel[];
  catalogTimestamp: number;
  visibleModels: string[];
  modelAliases: Record<string, string>;
}

export const DEFAULT_CURSOR_PROVIDER_SETTINGS: Readonly<CursorProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  discoveredModels: [],
  catalogTimestamp: 0,
  visibleModels: [],
  modelAliases: {},
});

export function getCursorProviderSettings(settings: Record<string, unknown>): CursorProviderSettings {
  const config = getProviderConfig(settings, 'cursor');
  const discoveredModels = normalizeCursorDiscoveredModels(config.discoveredModels);
  return {
    cliPath: readStoredString(config.cliPath, DEFAULT_CURSOR_PROVIDER_SETTINGS.cliPath),
    cliPathsByHost: normalizeHostnameStringMap(config.cliPathsByHost),
    enabled: readStoredBoolean(config.enabled, DEFAULT_CURSOR_PROVIDER_SETTINGS.enabled),
    environmentHash: readStoredString(
      config.environmentHash,
      DEFAULT_CURSOR_PROVIDER_SETTINGS.environmentHash,
    ),
    environmentVariables: readStoredString(
      config.environmentVariables,
      getProviderEnvironmentVariables(settings, 'cursor')
        ?? DEFAULT_CURSOR_PROVIDER_SETTINGS.environmentVariables,
    ),
    discoveredModels,
    modelAliases: normalizeModelAliases(config.modelAliases),
    catalogTimestamp: typeof config.catalogTimestamp === 'number'
      && Number.isFinite(config.catalogTimestamp)
      && config.catalogTimestamp >= 0
      ? Math.floor(config.catalogTimestamp)
      : DEFAULT_CURSOR_PROVIDER_SETTINGS.catalogTimestamp,
    visibleModels: normalizeCursorVisibleModels(config.visibleModels, discoveredModels),
  };
}

export function updateCursorProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<CursorProviderSettings>,
): CursorProviderSettings {
  const current = getCursorProviderSettings(settings);
  const discoveredModels = normalizeCursorDiscoveredModels(
    updates.discoveredModels ?? current.discoveredModels,
  );
  const next = {
    ...current,
    ...updates,
    discoveredModels,
    modelAliases: normalizeModelAliases(updates.modelAliases ?? current.modelAliases),
    visibleModels: normalizeCursorVisibleModels(
      updates.visibleModels ?? current.visibleModels,
      discoveredModels,
    ),
  };
  setProviderConfig(settings, 'cursor', { ...getProviderConfig(settings, 'cursor'), ...next });
  return next;
}

function normalizeModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter((entry): entry is [string, string] => entry[0].trim().length > 0
      && typeof entry[1] === 'string' && entry[1].trim().length > 0)
    .map(([id, alias]) => [id, alias.trim()]));
}
