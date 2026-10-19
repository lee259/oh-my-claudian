import { setLocale } from '@/i18n/i18n';
import { OMP_PROVIDER_CAPABILITIES } from '@/providers/omp/capabilities';
import { ompChatUIConfig } from '@/providers/omp/ui/OmpChatUIConfig';

describe('OMP chat configuration', () => {
  afterEach(() => {
    setLocale('en');
  });
  const settings: Record<string, unknown> = {
    providerConfigs: {
      omp: {
        thinking: {
          configId: 'thinking',
          currentValue: 'auto',
          options: [
            { id: 'off', name: 'Off' },
            { id: 'auto', name: 'Auto' },
            { id: 'high', name: 'High' },
          ],
        },
      },
    },
  };

  it('exposes OMP ACP thinking levels without a provider plan mode', () => {
    expect(OMP_PROVIDER_CAPABILITIES.supportsPlanMode).toBe(false);
    expect(ompChatUIConfig.getReasoningOptions('omp:openai/gpt-5-mini', settings)).toEqual([
      { label: 'Off', value: 'off' },
      { label: 'Auto', value: 'auto' },
      { label: 'High', value: 'high' },
    ]);
    expect(ompChatUIConfig.getDefaultReasoningValue('omp:openai/gpt-5-mini', settings)).toBe('auto');
    expect(ompChatUIConfig.resolvePermissionMode?.(settings)).toBe('always-ask');
    expect(ompChatUIConfig.getModeSelector?.(settings) ?? null).toBeNull();
  });

  it('exposes OMP native approval modes and preserves their IDs', () => {
    expect(ompChatUIConfig.getPermissionModeOptions?.(settings).map(({ value, label }) => [
      value,
      label,
    ])).toEqual([
      ['always-ask', 'Always ask'],
      ['write', 'Write'],
      ['yolo', 'YOLO'],
    ]);

    expect(ompChatUIConfig.getPermissionModeToggle?.()).toEqual({
      activeLabel: 'YOLO',
      activeValue: 'yolo',
      activeDescription: 'Run with full access without approval. Use with care.',
      activeIcon: 'zap',
      activeIsDangerous: true,
      inactiveLabel: 'Always ask',
      inactiveValue: 'always-ask',
      inactiveDescription: 'Ask before running commands or making file changes.',
      inactiveIcon: 'hand',
      values: ['always-ask', 'write', 'yolo'],
    });
    ompChatUIConfig.applyPermissionMode?.('write', settings);
    expect(ompChatUIConfig.resolvePermissionMode?.(settings)).toBe('write');
    ompChatUIConfig.applyPermissionMode?.('yolo', settings);
    expect(ompChatUIConfig.resolvePermissionMode?.(settings)).toBe('yolo');
    ompChatUIConfig.applyPermissionMode?.('always-ask', settings);
    expect(ompChatUIConfig.resolvePermissionMode?.(settings)).toBe('always-ask');
  });

  it('localizes the permission control with the active interface locale', () => {
    setLocale('zh-CN');
    expect(ompChatUIConfig.getPermissionModeToggle?.()).toMatchObject({
      activeLabel: 'YOLO',
      inactiveLabel: '始终询问',
    });
  });

  it('provides a context snapshot when restoring an OMP conversation', () => {
    expect(ompChatUIConfig.getInitialUsage?.('omp:openai/gpt-5-mini', settings)).toMatchObject({
      contextTokens: 0,
      contextWindow: 200_000,
      model: 'openai/gpt-5-mini',
      percentage: 0,
    });
  });

});

it('only exposes explicitly enabled roles and preserves direct model selection', () => {
  const settings = { providerConfigs: { omp: {
    discoveredModels: [
      { rawId: '@smol', label: '@smol', description: 'openai/gpt-5-mini:off' },
      { rawId: '@default', label: '@default' },
      { rawId: 'openai/gpt-5', label: 'GPT-5' },
    ],
    visibleModels: ['@smol', 'openai/gpt-5'],
  } } };
  expect(ompChatUIConfig.getModelOptions(settings).map(m => [m.value, m.label])).toEqual([
    ['omp:openai/gpt-5', 'GPT-5'], ['omp:@smol', '@smol'],
  ]);
  expect(ompChatUIConfig.getDefaultModel?.(settings)).toBe('omp:@smol');
  expect(ompChatUIConfig.getModelOptions({ providerConfigs: { omp: {
    ...settings.providerConfigs.omp, visibleModels: [],
  } } })).toEqual([]);
  expect(ompChatUIConfig.getDefaultModel?.({})).toBeNull();
});

it('defaults role thinking to the native role while permitting a user override', () => {
  const settings = { effortLevel: 'high', providerConfigs: { omp: { thinking: {
    configId: 'thinking', currentValue: 'auto', options: [{ id: 'high', name: 'High' }],
  } } } };
  expect(ompChatUIConfig.getReasoningOptions('omp:@smol', settings)).toEqual([
    { value: 'role-default', label: 'Role default' }, { value: 'high', label: 'High' },
  ]);
  expect(ompChatUIConfig.getDefaultReasoningValue('omp:@smol', settings)).toBe('role-default');
  ompChatUIConfig.applyModelDefaults('omp:@smol', settings);
  expect(settings.effortLevel).toBe('role-default');
});
