import type { ProviderChatUIConfig } from '@/core/providers/types';
import { t } from '@/i18n/i18n';
import { DEEPSEEK_PROVIDER_ICON } from '@/shared/icons';

import { deepseekModelPolicy } from '../DeepSeekModelPolicy';
import { DEEPSEEK_PERMISSION_MODE_OPTIONS } from '../permissionModes';
import { getDeepSeekProviderSettings, updateDeepSeekProviderSettings } from '../settings';

export const deepseekChatUIConfig: ProviderChatUIConfig = {
  ...deepseekModelPolicy,
  getPermissionModeToggle() {
    return { inactiveValue: 'normal', inactiveLabel: t('chat.composer.modeWorkspaceWrite'), inactiveIcon: 'shield-check',
      activeValue: 'yolo', activeLabel: t('chat.composer.modeFullAccess'), activeIcon: 'zap', activeIsDangerous: true };
  },
  resolvePermissionMode: settings => getDeepSeekProviderSettings(settings).permissionMode,
  applyPermissionMode(value, settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    const bag = settings as Record<string, unknown>;
    const permissionMode = value === 'yolo' ? 'yolo' : 'normal';
    updateDeepSeekProviderSettings(bag, { permissionMode });
    bag.permissionMode = permissionMode;
  },
  getPermissionModeOptions() {
    return DEEPSEEK_PERMISSION_MODE_OPTIONS.map(option => ({ ...option, label: t(option.value === 'yolo' ? 'chat.composer.modeFullAccess' : 'chat.composer.modeWorkspaceWrite') }));
  },
  getModeSelector(): null {
    return null;
  },
  getProviderIcon() {
    return DEEPSEEK_PROVIDER_ICON;
  },
};
