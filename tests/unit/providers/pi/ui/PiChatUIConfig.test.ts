import { PI_PROVIDER_CAPABILITIES } from '@/providers/pi/capabilities';
import { piChatUIConfig } from '@/providers/pi/ui/PiChatUIConfig';

describe('Pi chat permission modes', () => {
  it('declares read-only and all-tools modes without Plan', () => {
    const options = piChatUIConfig.getPermissionModeOptions?.({});
    expect(PI_PROVIDER_CAPABILITIES.supportsPlanMode).toBe(false);
    expect(options?.map(({ value, label, isDangerous }) => ({
      value,
      label,
      isDangerous: isDangerous ?? false,
    }))).toEqual([
      { value: 'normal', label: 'Read only', isDangerous: false },
      { value: 'yolo', label: 'All tools', isDangerous: true },
    ]);
    expect(options?.every(option => option.description && option.icon)).toBe(true);
  });
});
