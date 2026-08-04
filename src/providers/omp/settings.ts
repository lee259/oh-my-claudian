import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  normalizeOmpConfigChoiceList,
  normalizeOmpDiscoveredModels,
  normalizeOmpThinkingConfig,
  normalizeOmpVisibleModels,
  type OmpConfigChoice,
  type OmpDiscoveredModel,
  type OmpThinkingConfig,
} from './models';

export interface OmpProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  availableModes: OmpConfigChoice[];
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  selectedMode: string;
  thinking: OmpThinkingConfig | null;
  discoveredModels: OmpDiscoveredModel[];
  visibleModels: string[];
}

export const DEFAULT_OMP_PROVIDER_SETTINGS: Readonly<OmpProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  availableModes: [],
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  selectedMode: 'default',
  thinking: null,
  discoveredModels: [],
  visibleModels: [],
});

export function getOmpProviderSettings(settings: Record<string, unknown>): OmpProviderSettings {
  const config = getProviderConfig(settings, 'omp');
  const discoveredModels = normalizeOmpDiscoveredModels(config.discoveredModels);
  return {
    cliPath: typeof config.cliPath === 'string' ? config.cliPath : DEFAULT_OMP_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost: normalizeHostnameStringMap(config.cliPathsByHost),
    availableModes: normalizeOmpConfigChoiceList(config.availableModes),
    enabled: config.enabled === true,
    environmentHash: typeof config.environmentHash === 'string' ? config.environmentHash : '',
    environmentVariables: typeof config.environmentVariables === 'string'
      ? config.environmentVariables
      : getProviderEnvironmentVariables(settings, 'omp') ?? '',
    selectedMode: typeof config.selectedMode === 'string' && config.selectedMode.trim()
      ? config.selectedMode
      : DEFAULT_OMP_PROVIDER_SETTINGS.selectedMode,
    thinking: normalizeOmpThinkingConfig(config.thinking),
    discoveredModels,
    visibleModels: normalizeOmpVisibleModels(config.visibleModels, discoveredModels),
  };
}

export function updateOmpProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<OmpProviderSettings>,
): OmpProviderSettings {
  const current = getOmpProviderSettings(settings);
  const discoveredModels = normalizeOmpDiscoveredModels(
    updates.discoveredModels ?? current.discoveredModels,
  );
  const next = {
    ...current,
    ...updates,
    discoveredModels,
    visibleModels: normalizeOmpVisibleModels(
      updates.visibleModels ?? current.visibleModels,
      discoveredModels,
    ),
  };
  setProviderConfig(settings, 'omp', next);
  return next;
}
