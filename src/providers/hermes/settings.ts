import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import {
  readStoredBoolean,
  readStoredString,
} from '../../core/providers/settings/storedSettings';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  type HermesDiscoveredModel,
  normalizeHermesDiscoveredModels,
  normalizeHermesVisibleModels,
} from './models';

export interface HermesProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  discoveredModels: HermesDiscoveredModel[];
  catalogTimestamp: number;
  visibleModels: string[];
}

export const DEFAULT_HERMES_PROVIDER_SETTINGS: Readonly<HermesProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  discoveredModels: [],
  catalogTimestamp: 0,
  visibleModels: [],
});

export function getHermesProviderSettings(settings: Record<string, unknown>): HermesProviderSettings {
  const config = getProviderConfig(settings, 'hermes');
  const discoveredModels = normalizeHermesDiscoveredModels(config.discoveredModels);
  return {
    cliPath: readStoredString(config.cliPath, DEFAULT_HERMES_PROVIDER_SETTINGS.cliPath),
    cliPathsByHost: normalizeHostnameStringMap(config.cliPathsByHost),
    enabled: readStoredBoolean(config.enabled, DEFAULT_HERMES_PROVIDER_SETTINGS.enabled),
    environmentHash: readStoredString(
      config.environmentHash,
      DEFAULT_HERMES_PROVIDER_SETTINGS.environmentHash,
    ),
    environmentVariables: readStoredString(
      config.environmentVariables,
      getProviderEnvironmentVariables(settings, 'hermes')
        ?? DEFAULT_HERMES_PROVIDER_SETTINGS.environmentVariables,
    ),
    discoveredModels,
    catalogTimestamp: typeof config.catalogTimestamp === 'number'
      && Number.isFinite(config.catalogTimestamp)
      && config.catalogTimestamp >= 0
      ? Math.floor(config.catalogTimestamp)
      : DEFAULT_HERMES_PROVIDER_SETTINGS.catalogTimestamp,
    visibleModels: normalizeHermesVisibleModels(config.visibleModels, discoveredModels),
  };
}

export function updateHermesProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<HermesProviderSettings>,
): HermesProviderSettings {
  const current = getHermesProviderSettings(settings);
  const discoveredModels = normalizeHermesDiscoveredModels(
    updates.discoveredModels ?? current.discoveredModels,
  );
  const next = {
    ...current,
    ...updates,
    discoveredModels,
    visibleModels: normalizeHermesVisibleModels(
      updates.visibleModels ?? current.visibleModels,
      discoveredModels,
    ),
  };
  setProviderConfig(settings, 'hermes', { ...getProviderConfig(settings, 'hermes'), ...next });
  return next;
}
