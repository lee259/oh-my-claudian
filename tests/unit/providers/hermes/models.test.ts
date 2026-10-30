import { decodeHermesModelId, encodeHermesModelId, normalizeHermesDiscoveredModels, normalizeHermesVisibleModels } from '@/providers/hermes/models';

describe('Hermes model selections', () => {
  it('preserves Hermes provider-qualified model IDs and requires explicit selection', () => {
    const models = normalizeHermesDiscoveredModels([
      { modelId: 'openrouter:anthropic/claude-sonnet', name: 'Claude Sonnet' },
      { modelId: 'custom:local:model', name: 'Local' },
      { modelId: 'openrouter:anthropic/claude-sonnet', name: 'duplicate' },
      { modelId: '', name: 'invalid' },
    ]);
    expect(models).toEqual([
      { rawId: 'openrouter:anthropic/claude-sonnet', label: 'Claude Sonnet' },
      { rawId: 'custom:local:model', label: 'Local' },
    ]);
    expect(encodeHermesModelId(models[1].rawId)).toBe('hermes:custom:local:model');
    expect(decodeHermesModelId('hermes:custom:local:model')).toBe('custom:local:model');
    expect(decodeHermesModelId('cursor:custom:local:model')).toBeNull();
    expect(normalizeHermesVisibleModels([], models)).toEqual([]);
    expect(normalizeHermesVisibleModels(['custom:local:model', 'missing', 'custom:local:model'], models)).toEqual(['custom:local:model']);
  });
});
