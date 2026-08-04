import { OMP_PROVIDER_CAPABILITIES } from '@/providers/omp/capabilities';
import { ompChatUIConfig } from '@/providers/omp/ui/OmpChatUIConfig';

describe('OMP chat configuration', () => {
  const settings: Record<string, unknown> = {
    providerConfigs: {
      omp: {
        selectedMode: 'plan',
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

  it('exposes OMP ACP thinking levels and the native plan mode', () => {
    expect(OMP_PROVIDER_CAPABILITIES.supportsPlanMode).toBe(true);
    expect(ompChatUIConfig.getReasoningOptions('omp:openai/gpt-5-mini', settings)).toEqual([
      { label: 'Off', value: 'off' },
      { label: 'Auto', value: 'auto' },
      { label: 'High', value: 'high' },
    ]);
    expect(ompChatUIConfig.getDefaultReasoningValue('omp:openai/gpt-5-mini', settings)).toBe('auto');
    expect(ompChatUIConfig.resolvePermissionMode?.(settings)).toBe('plan');
    expect(ompChatUIConfig.getModeSelector?.(settings) ?? null).toBeNull();
  });

  it('exposes only Build and Plan through the shared control', () => {
    expect(ompChatUIConfig.getPermissionModeToggle?.()).toEqual({
      activeLabel: 'Build',
      activeValue: 'yolo',
      inactiveLabel: 'Plan',
      inactiveValue: 'plan',
      planLabel: 'Plan',
      planValue: 'plan',
    });
    ompChatUIConfig.applyPermissionMode?.('yolo', settings);
    expect(ompChatUIConfig.resolvePermissionMode?.(settings)).toBe('yolo');
    ompChatUIConfig.applyPermissionMode?.('plan', settings);
    expect(ompChatUIConfig.resolvePermissionMode?.(settings)).toBe('plan');
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
