import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { DEEPSEEK_PROVIDER_ICON } from '@/shared/icons';

describe('DeepSeekChatUIConfig', () => {
  it('offers exactly the saved permission modes, with only native full access bypassing approvals', () => {
    const ui = ProviderRegistry.getChatUIConfig('deepseek');
    const policy = { values: ['normal', 'yolo'], defaultValue: 'normal', fallbackValue: 'normal' };
    const options = ui.getPermissionModeOptions?.({}) ?? [];

    expect(options.map(option => option.value)).toEqual([...policy.values]);
    expect(options.map(({ value, icon }) => ({ value, icon }))).toEqual([
      { value: 'normal', icon: 'shield-check' },
      { value: 'yolo', icon: 'zap' },
    ]);
    expect(new Set(options.map(option => option.label)).size).toBe(options.length);
    // `yolo` is the mode execution applies as native danger-full-access.
    expect(options.filter(option => option.isDangerous).map(option => option.value)).toEqual(['yolo']);
    for (const safe of [policy.defaultValue, policy.fallbackValue]) {
      const option = options.find(candidate => candidate.value === safe);
      expect(option).toBeDefined();
      expect(option!.isDangerous).toBeFalsy();
    }
    expect(ui.getModeSelector?.({})).toBeNull();
    expect(ui.getProviderIcon?.()).toBe(DEEPSEEK_PROVIDER_ICON);
  });
});

it('projects native permission controls and fails closed without inheriting another provider\'s full access', () => {
  const ui = ProviderRegistry.getChatUIConfig('deepseek');
  const settings: Record<string, unknown> = { permissionMode: 'yolo', providerConfigs: { deepseek: { extensionField: 'preserve' } } };
  expect(ui.getPermissionModeToggle?.()).toMatchObject({ inactiveValue: 'normal', activeValue: 'yolo', activeIsDangerous: true });
  expect(ui.resolvePermissionMode?.(settings)).toBe('normal');
  ui.applyPermissionMode?.('yolo', settings);
  expect(ui.resolvePermissionMode?.(settings)).toBe('yolo');
  ui.applyPermissionMode?.('invalid', settings);
  expect(ui.resolvePermissionMode?.(settings)).toBe('normal');
  expect((settings.providerConfigs as Record<string, unknown>).deepseek).toMatchObject({ extensionField: 'preserve' });
});
