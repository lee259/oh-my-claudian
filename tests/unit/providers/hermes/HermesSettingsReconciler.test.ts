import { hermesSettingsReconciler } from '@/providers/hermes/env/HermesSettingsReconciler';
import { getHermesProviderSettings } from '@/providers/hermes/settings';

it('retains explicit choices but invalidates their availability when the environment changes', () => {
  const settings = { providerConfigs: { hermes: { enabled: true, discoveredModels: [{ rawId: 'custom:model', label: 'Model' }], visibleModels: ['custom:model'] } } };
  expect(hermesSettingsReconciler.handleEnvironmentChange?.(settings)).toBe(true);
  const provider = getHermesProviderSettings(settings);
  expect(provider.visibleModels).toEqual(['custom:model']);
  expect(provider.discoveredModels[0].available).toBe(false);
});
