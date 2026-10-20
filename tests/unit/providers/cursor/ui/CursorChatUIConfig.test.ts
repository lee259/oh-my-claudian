import { CURSOR_PROVIDER_CAPABILITIES } from '@/providers/cursor/capabilities';
import { CursorModelDiscoveryService } from '@/providers/cursor/metadata/CursorModelDiscoveryService';
import { getCursorProviderSettings } from '@/providers/cursor/settings';
import { cursorChatUIConfig } from '@/providers/cursor/ui/CursorChatUIConfig';

describe('Cursor chat permission modes', () => {
  it('declares the Agent, Ask, and Plan modes supported by the ACP adapter', () => {
    expect(cursorChatUIConfig.getPermissionModeOptions?.({}).map(({ value, label, isPlanMode }) => ({
      value,
      label,
      isPlanMode: isPlanMode ?? false,
    }))).toEqual([
      { value: 'normal', label: 'Agent', isPlanMode: false },
      { value: 'ask', label: 'Ask', isPlanMode: false },
      { value: 'plan', label: 'Plan', isPlanMode: true },
    ]);
  });
});

describe('Cursor chat reasoning', () => {
  it('offers reasoning choices for a parameterized Cursor model', () => {
    const rawId = 'grok-4.7[context=256k,reasoning_effort=high,fast=true]';
    const settings = {
      providerConfigs: { cursor: {
        discoveredModels: [{ label: 'Grok 4.7', rawId, reasoning: { parameterId: 'reasoning_effort', currentValue: 'high', options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }] } }],
        visibleModels: [rawId],
      } },
    };
    expect(CURSOR_PROVIDER_CAPABILITIES.reasoningControl).toBe('effort');
    expect(cursorChatUIConfig.isAdaptiveReasoningModel(`cursor:${rawId}`, settings)).toBe(true);
    expect(cursorChatUIConfig.getReasoningOptions(`cursor:${rawId}`, settings))
      .toContainEqual(expect.objectContaining({ value: 'high' }));
  });
});

  it('hides controls on models without native reasoning options', () => {
    expect(cursorChatUIConfig.getReasoningOptions('cursor:composer-2.5[fast=true]', {})).toEqual([]);
    expect(cursorChatUIConfig.isAdaptiveReasoningModel('cursor:composer-2.5[fast=true]', {})).toBe(false);
  });

  it('warms legacy metadata without replacing explicit model selections or other settings', async () => {
    const rawId = 'native-model[effort=high,fast=true]';
    const settings = { providerConfigs: { cursor: {
      enabled: true, discoveredModels: [{ label: 'Native', rawId }], visibleModels: [rawId],
    } } };
    const discover = jest.spyOn(CursorModelDiscoveryService.prototype, 'discoverCatalog').mockResolvedValue({ models: [{
      label: 'Native', rawId: 'native-model[effort=low,fast=false]', reasoning: {
        parameterId: 'effort', currentValue: 'low', options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }],
      },
    }] });
    const plugin = { settings, mutateSettings: async (mutate: (settings: unknown) => void) => mutate(settings) } as never;
    try {
      await cursorChatUIConfig.prepareModelMetadata?.(`cursor:${rawId}`, settings, { plugin });
      expect(getCursorProviderSettings(settings)).toMatchObject({ enabled: true, visibleModels: [rawId], discoveredModels: [{ rawId }] });
      expect(cursorChatUIConfig.getDefaultReasoningValue(`cursor:${rawId}`, settings)).toBe('high');
      await cursorChatUIConfig.prepareModelMetadata?.(`cursor:${rawId}`, settings, { plugin });
      expect(discover).toHaveBeenCalledTimes(1);
    } finally { discover.mockRestore(); }
  });
