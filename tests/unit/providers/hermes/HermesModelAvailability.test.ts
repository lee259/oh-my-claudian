import { normalizeHermesDiscoveredModels } from '@/providers/hermes/models';
import { hermesChatUIConfig } from '@/providers/hermes/ui/HermesChatUIConfig';

it('keeps an explicitly selected unavailable model out of the chat selector', () => {
  const discoveredModels = normalizeHermesDiscoveredModels([
    { rawId: 'old:model', label: 'Old', available: false },
    { rawId: 'new:model', label: 'New' },
  ]);
  expect(discoveredModels[0]).toMatchObject({ available: false });
  const settings = { providerConfigs: { hermes: { enabled: true, discoveredModels, visibleModels: ['old:model', 'new:model'] } } };
  expect(hermesChatUIConfig.getModelOptions(settings as never).map(model => model.value)).toEqual(['hermes:new:model']);
  expect(hermesChatUIConfig.getDefaultModel!(settings as never)).toBe('hermes:new:model');
});
