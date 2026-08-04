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
  });

  it('maps the shared plan control to OMP native mode selection', () => {
    ompChatUIConfig.applyPermissionMode?.('normal', settings);
    expect(ompChatUIConfig.resolvePermissionMode?.(settings)).toBe('normal');
    ompChatUIConfig.applyPermissionMode?.('plan', settings);
    expect(ompChatUIConfig.resolvePermissionMode?.(settings)).toBe('plan');
  });
});
