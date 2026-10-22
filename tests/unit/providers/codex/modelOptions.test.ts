import { TEST_CODEX_CATALOG } from '@test/helpers/codexModels';

import { getCodexModelOptions } from '@/providers/codex/modelOptions';

describe('getCodexModelOptions', () => {
  it.each(['constructor', 'toString', '__proto__'])(
    'uses the discovered display name when %s has no own alias', (model) => {
      const settings = {
        providerConfigs: { codex: {
          discoveredModels: [{ ...TEST_CODEX_CATALOG[0], model, displayName: 'Native model' }],
          visibleModels: [model], modelAliases: {},
        } },
      };

      expect(getCodexModelOptions(settings)).toEqual([
        expect.objectContaining({ value: model, label: 'Native model' }),
      ]);
    },
  );

  it('uses own aliases without exposing disabled models', () => {
    const settings = {
      providerConfigs: { codex: {
        discoveredModels: ['__proto__', 'constructor', 'disabled'].map(model => ({
          ...TEST_CODEX_CATALOG[0], model, displayName: 'Native model',
        })),
        visibleModels: ['__proto__', 'constructor'],
        modelAliases: JSON.parse('{"__proto__":"Primary","constructor":"Builder","disabled":"Hidden"}'),
      } },
    };

    expect(getCodexModelOptions(settings).map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 'constructor', label: 'Builder' }, { value: '__proto__', label: 'Primary' },
    ]);
  });
});
