import { hermesChatUIConfig } from '@/providers/hermes/ui/HermesChatUIConfig';

describe('Hermes approval mode UI', () => {
  it('exposes the three native approval choices and persists the selection', () => {
    const settings: Record<string, unknown> = {};
    expect(hermesChatUIConfig.getPermissionModeOptions!(settings).map(option => option.value))
      .toEqual(['default', 'accept_edits', 'dont_ask']);
    hermesChatUIConfig.applyPermissionMode!('accept_edits', settings);
    expect(hermesChatUIConfig.resolvePermissionMode!(settings)).toBe('accept_edits');
    hermesChatUIConfig.applyPermissionMode!('dont_ask', settings);
    expect(hermesChatUIConfig.resolvePermissionMode!(settings)).toBe('dont_ask');
    hermesChatUIConfig.applyPermissionMode!('unknown', settings);
    expect(hermesChatUIConfig.resolvePermissionMode!(settings)).toBe('default');
  });
});
