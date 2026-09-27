import {
  assertOpencodeModelAvailable,
  ensureOpencodeModelAvailable,
} from '@/providers/opencode/runtime/OpencodeModelAvailability';

describe('OpenCode model availability', () => {
  it('rejects a selected model that is no longer in the active discovery catalog', () => {
    expect(() => assertOpencodeModelAvailable({
      model: 'opencode:opencode/mimo-v2.6-flash-free',
      providerConfigs: {
        opencode: {
          enabled: true,
          discoveredModels: [],
          visibleModels: ['opencode/mimo-v2.6-flash-free'],
        },
      },
    }, undefined)).toThrow(/The selected OpenCode model is unavailable\./u);
  });

  it('accepts a visible model that is still in the discovery catalog', () => {
    expect(() => assertOpencodeModelAvailable({
      model: 'opencode:opencode-go/mimo-v2.6-flash',
      providerConfigs: {
        opencode: {
          enabled: true,
          discoveredModels: [{ label: 'MiMo Flash', rawId: 'opencode-go/mimo-v2.6-flash' }],
          visibleModels: ['opencode-go/mimo-v2.6-flash'],
        },
      },
    }, undefined)).not.toThrow(/The selected OpenCode model is unavailable\./u);
  });

  it('refreshes the catalog before rejecting a cold-start model selection', async () => {
    const settings: Record<string, unknown> = {
      model: 'opencode:opencode/mimo-v2.6-flash-free',
      providerConfigs: {
        opencode: {
          enabled: true,
          discoveredModels: [],
          visibleModels: ['opencode/mimo-v2.6-flash-free'],
        },
      },
    };
    const refreshCatalog = jest.fn(async () => {
      (settings.providerConfigs as Record<string, Record<string, unknown>>).opencode.discoveredModels = [
        { label: 'opencode/MiMo-V2.6-Flash-Free', rawId: 'opencode/mimo-v2.6-flash-free' },
      ];
      return true;
    });

    await ensureOpencodeModelAvailable(
      settings,
      undefined,
      refreshCatalog,
    );
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
  });
});
