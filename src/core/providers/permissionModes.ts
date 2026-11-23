import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
} from './types';

export interface PermissionModePolicy {
  readonly values: readonly string[];
  /** The provider's safe default for a provider/projection with no usable saved mode. */
  readonly fallbackValue: string;
}

/** One provider's permission-mode allow-list and fail-closed fallback. */
export function resolvePermissionModePolicy(
  uiConfig: ProviderChatUIConfig,
  settings: Record<string, unknown>,
): PermissionModePolicy | null {
  const toggle = uiConfig.getPermissionModeToggle?.() ?? null;
  const options = uiConfig.getPermissionModeOptions?.(settings) ?? [];
  const values = [
    ...toggleValues(toggle),
    ...options.map(option => option.value),
  ].filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
  const fallbackValue = toggle?.inactiveValue ?? options[0]?.value;
  return fallbackValue && values.includes(fallbackValue)
    ? { fallbackValue, values }
    : null;
}

/** A known stored value, else the provider's fail-closed fallback. */
export function resolvePermissionMode(
  policy: PermissionModePolicy | null | undefined,
  value: unknown,
): string | undefined {
  if (!policy) return typeof value === 'string' ? value : undefined;
  return typeof value === 'string' && policy.values.includes(value)
    ? value
    : policy.fallbackValue;
}

function toggleValues(toggle: ProviderPermissionModeToggleConfig | null): string[] {
  if (!toggle) return [];
  return [
    toggle.inactiveValue,
    toggle.activeValue,
    ...(toggle.values ?? []),
    ...(toggle.planValue ? [toggle.planValue] : []),
  ];
}
