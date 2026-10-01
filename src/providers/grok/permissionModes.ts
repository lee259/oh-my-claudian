import type {
  ProviderPermissionModeOption,
  ProviderPermissionModeToggleConfig,
} from '../../core/providers/types';
import { t } from '../../i18n/i18n';

/** Ask remains the existing safe default; users can explicitly select xAI's other modes. */
export const GROK_PERMISSION_MODES = ['auto', 'normal', 'acceptEdits', 'yolo'] as const;
export type GrokPermissionMode = typeof GROK_PERMISSION_MODES[number];

export const GROK_PERMISSION_MODE_TOGGLE_VALUES = ['auto', 'acceptEdits'];

export function getGrokPermissionModeOptions(): ProviderPermissionModeOption[] {
  return [
    {
      value: 'auto',
      label: t('chat.composer.modeGrokAuto'),
      description: t('chat.composer.modeGrokAutoDescription'),
      icon: 'sparkles',
    },
    {
      value: 'normal',
      label: t('chat.composer.modeGrokAsk'),
      description: t('chat.composer.modeGrokAskDescription'),
      icon: 'hand',
    },
    {
      value: 'plan',
      label: t('chat.composer.plan'),
      description: t('chat.composer.modePlanGenericDescription'),
      icon: 'clipboard-list',
      isPlanMode: true,
    },
    {
      value: 'acceptEdits',
      label: t('chat.composer.modeGrokAcceptEdits'),
      description: t('chat.composer.modeGrokAcceptEditsDescription'),
      icon: 'file-check-2',
    },
    {
      value: 'yolo',
      label: t('chat.composer.modeGrokAlwaysApprove'),
      description: t('chat.composer.modeGrokAlwaysApproveDescription'),
      icon: 'zap',
      isDangerous: true,
    },
  ];
}

export function getGrokPermissionModeToggle(): ProviderPermissionModeToggleConfig {
  return {
    values: [...GROK_PERMISSION_MODE_TOGGLE_VALUES],
    inactiveValue: 'normal',
    inactiveLabel: t('chat.composer.modeGrokAsk'),
    inactiveDescription: t('chat.composer.modeGrokAskDescription'),
    inactiveIcon: 'hand',
    activeValue: 'yolo',
    activeLabel: t('chat.composer.modeGrokAlwaysApprove'),
    activeDescription: t('chat.composer.modeGrokAlwaysApproveDescription'),
    activeIcon: 'zap',
    activeIsDangerous: true,
    planValue: 'plan',
    planLabel: t('chat.composer.plan'),
    planDescription: t('chat.composer.modePlanGenericDescription'),
    planIcon: 'clipboard-list',
  };
}

export function isGrokPermissionMode(value: string): value is GrokPermissionMode {
  return GROK_PERMISSION_MODES.includes(value as GrokPermissionMode);
}

/** ACP cannot express Accept edits directly, so Grok's edit prompts use client approval. */
export function shouldAutoApproveGrokPermission(
  permissionMode: string | undefined,
  toolKind: string | null | undefined,
): boolean {
  return permissionMode === 'acceptEdits' && toolKind === 'edit';
}
