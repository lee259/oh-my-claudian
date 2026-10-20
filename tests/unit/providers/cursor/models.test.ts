import {
  attachCursorReasoningCatalog,
  decodeCursorModelId,
  encodeCursorModelId,
  getCursorModelReasoning,
  normalizeCursorDiscoveredModels,
  resolveCursorReasoningModelId,
} from '@/providers/cursor/models';

describe('Cursor models', () => {
  it('normalizes ACP model state and isolates Cursor selector ids', () => {
    expect(normalizeCursorDiscoveredModels([
      { modelId: 'claude-4-sonnet', name: 'Claude 4 Sonnet' },
      { id: 'gpt-5', name: 'GPT-5', description: 'OpenAI model' },
      { modelId: 'claude-4-sonnet', name: 'Duplicate' },
    ])).toEqual([
      { label: 'Claude 4 Sonnet', rawId: 'claude-4-sonnet' },
      { description: 'OpenAI model', label: 'GPT-5', rawId: 'gpt-5' },
    ]);

    expect(encodeCursorModelId('gpt-5')).toBe('cursor:gpt-5');
    expect(decodeCursorModelId('cursor:gpt-5')).toBe('gpt-5');
    expect(decodeCursorModelId('omp:gpt-5')).toBeNull();
  });
});

describe('Cursor native reasoning catalog', () => {
  const rawId = 'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]';
  const options = [{ name: 'Low', value: 'low' }, { name: 'High', value: 'high' }];

  it('uses native effort options in preference to the separate thinking switch', () => {
    const models = attachCursorReasoningCatalog([{ label: 'Opus', rawId }], { models: [{
      value: 'claude-opus-5', configOptions: [
        { id: 'thinking', category: 'thought_level', type: 'select', currentValue: 'true', options: [{ name: 'On', value: 'true' }] },
        { id: 'effort', category: 'thought_level', type: 'select', currentValue: 'low', options },
      ],
    }] });
    expect(models[0].reasoning).toEqual({
      parameterId: 'effort', currentValue: 'low', options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }],
    });
    expect(getCursorModelReasoning(rawId, models)?.currentValue).toBe('high');
    expect(normalizeCursorDiscoveredModels(models)).toEqual(models);
    expect(resolveCursorReasoningModelId(rawId, 'low', models))
      .toBe('claude-opus-5[thinking=true,context=300k,effort=low,fast=false]');
    expect(resolveCursorReasoningModelId(rawId, 'max', models)).toBe(rawId);
    expect(resolveCursorReasoningModelId(rawId, null, models)).toBe(rawId);
  });

  it.each(['reasoning', 'reasoning_effort', 'effort', 'thinking'])('preserves the native %s parameter name and option values', parameterId => {
    const id = `native-model[context=1m,${parameterId}=high,fast=true]`;
    const models = attachCursorReasoningCatalog([{ label: 'Native', rawId: id }], { models: [{
      value: 'native-model', configOptions: [{ id: parameterId, category: 'thought_level', type: 'select', currentValue: 'high', options }],
    }] });
    expect(resolveCursorReasoningModelId(id, 'low', models)).toBe(`native-model[context=1m,${parameterId}=low,fast=true]`);
  });

  it('supports native catalogs with bare model IDs', () => {
    const models = [{ label: 'Native', rawId: 'native-model', reasoning: {
      parameterId: 'effort', currentValue: 'high', options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }],
    } }];
    expect(resolveCursorReasoningModelId('native-model', 'low', models)).toBe('native-model[effort=low]');
  });

  it('does not invent controls for unsupported or malformed catalogs', () => {
    const models = [{ label: 'Composer', rawId: 'composer-2.5[fast=true]' }];
    expect(attachCursorReasoningCatalog(models, null)).toEqual(models);
    expect(attachCursorReasoningCatalog(models, { models: [{ value: 'composer-2.5', configOptions: [] }] }))
      .toEqual([{ ...models[0], reasoning: null }]);
    expect(normalizeCursorDiscoveredModels([{ ...models[0], reasoning: {
      parameterId: 'effort', currentValue: 'high', options: [{ label: 'High', value: 'high,fast=true' }],
    } }])[0].reasoning).toBeUndefined();
    expect(normalizeCursorDiscoveredModels([{ ...models[0], reasoning: null }])[0].reasoning).toBeNull();
  });
});
