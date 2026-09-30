import * as path from 'node:path';

import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import { readStoredBoolean, readStoredString } from '../../core/providers/settings/storedSettings';
import type { HostnameCliPaths } from '../../core/types/settings';
import { normalizeDshDiscoveredModels, normalizeDshVisibleModels } from './models';

export interface DshDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

export interface DshReasoningOption {
  description?: string;
  id: string;
  name: string;
}

export interface DshReasoningConfig {
  configId: string;
  currentValue: string | null;
  options: DshReasoningOption[];
}

export interface DshProviderSettings {
  catalogTimestamp: number;
  catalogSessionId: string;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  discoveredModels: DshDiscoveredModel[];
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  reasoning: DshReasoningConfig | null;
  visibleModels: string[];
}

export const DEFAULT_DSH_PROVIDER_SETTINGS: Readonly<DshProviderSettings> = Object.freeze({
  catalogTimestamp: 0,
  catalogSessionId: '',
  cliPath: '',
  cliPathsByHost: {},
  discoveredModels: [],
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  reasoning: null,
  visibleModels: [],
});

export function getDshProviderSettings(settings: Record<string, unknown>): DshProviderSettings {
  const config = getProviderConfig(settings, 'dsh');
  const discoveredModels = normalizeDshDiscoveredModels(config.discoveredModels);
  const cliPathsByHost = normalizeHostnameStringMap(config.cliPathsByHost);
  for (const [hostname, cliPath] of Object.entries(cliPathsByHost)) {
    if (isNpmRunnerCliPath(cliPath)) delete cliPathsByHost[hostname];
  }
  return {
    catalogTimestamp: typeof config.catalogTimestamp === 'number' && Number.isFinite(config.catalogTimestamp)
      ? config.catalogTimestamp
      : 0,
    catalogSessionId: readStoredString(config.catalogSessionId, DEFAULT_DSH_PROVIDER_SETTINGS.catalogSessionId).trim(),
    cliPath: normalizeDshCliPath(config.cliPath, DEFAULT_DSH_PROVIDER_SETTINGS.cliPath),
    cliPathsByHost,
    discoveredModels,
    enabled: readStoredBoolean(config.enabled, DEFAULT_DSH_PROVIDER_SETTINGS.enabled),
    environmentHash: readStoredString(config.environmentHash, DEFAULT_DSH_PROVIDER_SETTINGS.environmentHash),
    environmentVariables: readStoredString(
      config.environmentVariables,
      getProviderEnvironmentVariables(settings, 'dsh') ?? DEFAULT_DSH_PROVIDER_SETTINGS.environmentVariables,
    ),
    reasoning: normalizeDshReasoning(config.reasoning),
    visibleModels: normalizeDshVisibleModels(config.visibleModels, discoveredModels),
  };
}

export function getConfiguredDshCliPath(settings: Record<string, unknown>, hostnameKey: string): string | null {
  const provider = getDshProviderSettings(settings);
  return provider.cliPathsByHost[hostnameKey] || provider.cliPath || null;
}

export function isNpmRunnerCliPath(value: string): boolean {
  const basename = path.basename(value).replace(/\.(?:cmd|exe)$/iu, '').toLowerCase();
  return basename === 'npm' || basename === 'npx';
}

function normalizeDshCliPath(value: unknown, fallback: string): string {
  const cliPath = readStoredString(value, fallback).trim();
  return isNpmRunnerCliPath(cliPath) ? fallback : cliPath;
}

export function updateDshProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<DshProviderSettings>,
): DshProviderSettings {
  const current = getDshProviderSettings(settings);
  const next = { ...current, ...updates };
  setProviderConfig(settings, 'dsh', next);
  return next;
}

function normalizeDshReasoning(value: unknown): DshReasoningConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const configId = typeof record.configId === 'string' ? record.configId.trim() : '';
  const options = Array.isArray(record.options)
    ? record.options.flatMap(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const option = entry as Record<string, unknown>;
      const id = typeof option.id === 'string' ? option.id.trim() : '';
      if (!id) return [];
      return [{
        ...(typeof option.description === 'string' && option.description.trim()
          ? { description: option.description.trim() }
          : {}),
        id,
        name: typeof option.name === 'string' && option.name.trim() ? option.name.trim() : id,
      }];
    })
    : [];
  if (!configId || options.length === 0) return null;
  return {
    configId,
    currentValue: typeof record.currentValue === 'string' && record.currentValue.trim()
      ? record.currentValue.trim()
      : null,
    options,
  };
}
