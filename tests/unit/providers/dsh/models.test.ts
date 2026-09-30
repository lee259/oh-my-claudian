import {
  decodeDshModelId,
  encodeDshModelId,
  normalizeDshConfigOptionCatalog,
  normalizeDshConfigOptionModels,
  normalizeDshDiscoveredModels,
  normalizeDshReasoningConfigOptions,
  normalizeDshVisibleModels,
  parseDshModelRoute,
} from '../../../../src/providers/dsh/models';

describe('DSH model catalog', () => {
  it('normalizes grouped ACP model options and removes duplicate ids', () => {
    expect(normalizeDshConfigOptionModels([
      {
        id: 'model',
        type: 'select',
        options: [
          { name: 'DeepSeek', options: [{ value: 'deepseek/deepseek-v4', name: 'V4' }] },
          { name: 'Other', options: [{ value: 'deepseek/deepseek-v4', name: 'duplicate' }] },
        ],
      },
    ])).toEqual([{ label: 'DeepSeek · V4', rawId: 'deepseek/deepseek-v4' }]);
  });

  it('keeps ACP route values opaque while using model names for presentation', () => {
    const routeValue = '["deepseek-official","deepseek-flash"]';
    const catalog = normalizeDshConfigOptionCatalog([
      {
        id: 'model',
        type: 'select',
        currentValue: routeValue,
        options: [{
          group: 'deepseek-official',
          name: 'DeepSeek',
          options: [{ value: routeValue, name: 'DeepSeek-V41-Flash' }],
        }],
      },
    ]);

    expect(catalog).toEqual({
      defaultModelId: routeValue,
      models: [{ label: 'DeepSeek-V41-Flash', rawId: routeValue }],
    });
    expect(parseDshModelRoute(routeValue)).toEqual({
      modelId: 'deepseek-flash',
      providerId: 'deepseek-official',
    });
  });

  it('repairs a cached tuple label when the ACP option omitted its display name', () => {
    const routeValue = '["opencode","claude-fable-5"]';
    expect(normalizeDshDiscoveredModels([{ rawId: routeValue, label: routeValue }])).toEqual([
      { label: 'Claude Fable 5', rawId: routeValue },
    ]);
  });

  it('normalizes reasoning options and nullable descriptions', () => {
    expect(normalizeDshReasoningConfigOptions([
      {
        id: 'reasoning_effort',
        type: 'select',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low', description: null },
          { value: 'high', name: 'High', description: 'More reasoning' },
        ],
      },
    ])).toEqual({
      configId: 'reasoning_effort',
      currentValue: 'high',
      options: [
        { id: 'low', name: 'Low' },
        { description: 'More reasoning', id: 'high', name: 'High' },
      ],
    });
  });

  it('keeps selected models within the discovered catalog and round-trips ids', () => {
    const catalog = normalizeDshDiscoveredModels([
      { id: 'deepseek/deepseek-v4', name: 'DeepSeek V4', description: null },
    ]);
    expect(normalizeDshVisibleModels(['deepseek/deepseek-v4', 'missing'], catalog))
      .toEqual(['deepseek/deepseek-v4']);
    expect(decodeDshModelId(encodeDshModelId('deepseek/deepseek-v4'))).toBe('deepseek/deepseek-v4');
    expect(decodeDshModelId('other:model')).toBeNull();
  });
});
