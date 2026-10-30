import { getHermesProviderSettings, updateHermesProviderSettings } from '@/providers/hermes/settings';

describe('Hermes settings', () => {
  it('preserves provider-owned unknown fields while changing enablement', () => {
    const settings = { providerConfigs: { hermes: { enabled: false, extensionData: { value: 1 } } } };
    updateHermesProviderSettings(settings, { enabled: true });
    expect(settings.providerConfigs.hermes).toMatchObject({ enabled: true, extensionData: { value: 1 } });
    expect(getHermesProviderSettings(settings).visibleModels).toEqual([]);
  });
});
