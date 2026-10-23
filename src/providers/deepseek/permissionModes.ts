import type { ProviderPermissionModeOption } from '@/core/providers/types';

export const DEEPSEEK_PERMISSION_MODES = ['normal', 'yolo'] as const;

export const DEEPSEEK_PERMISSION_MODE_POLICY = Object.freeze({
  values: DEEPSEEK_PERMISSION_MODES,
  defaultValue: 'normal',
  fallbackValue: 'normal',
});

export const DEEPSEEK_PERMISSION_MODE_OPTIONS: readonly ProviderPermissionModeOption[] = Object.freeze([
  { value: 'normal', label: 'Workspace write', description: 'Ask before extra access.', icon: 'shield-check' },
  { value: 'yolo', label: 'Full access', description: 'Unrestricted files and internet.', icon: 'zap', isDangerous: true },
]);
