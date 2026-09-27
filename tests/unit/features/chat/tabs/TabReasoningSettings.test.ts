import type { ProviderChatUIConfig } from '@/core/providers/types';
import { resolveTabReasoningSettings } from '@/features/chat/tabs/TabReasoningSettings';

function createUiConfig(options: string[], defaultValue: string, adaptive: boolean): ProviderChatUIConfig {
  return {
    getReasoningOptions: () => options.map(value => ({ value, label: value })),
    getDefaultReasoningValue: () => defaultValue,
    isAdaptiveReasoningModel: () => adaptive,
  } as unknown as ProviderChatUIConfig;
}

describe('resolveTabReasoningSettings', () => {
  it('keeps reasoning selections isolated per tab and provider model', () => {
    const settings = { model: 'claude/opus', effortLevel: 'high', thinkingBudget: 'medium' };
    const firstTab = new Map<string, string>();
    const secondTab = new Map<string, string>();
    const config = createUiConfig(['low', 'medium', 'high'], 'high', true);

    expect(resolveTabReasoningSettings({ ...settings }, 'claude', firstTab, config).effortLevel)
      .toBe('high');
    firstTab.set('claude:claude/opus', 'low');
    expect(resolveTabReasoningSettings({ ...settings }, 'claude', firstTab, config).effortLevel)
      .toBe('low');
    expect(resolveTabReasoningSettings({ ...settings }, 'claude', secondTab, config).effortLevel)
      .toBe('high');

    expect(resolveTabReasoningSettings(
      { ...settings, model: 'claude/sonnet' }, 'claude', firstTab, config,
    ).effortLevel).toBe('high');
  });

  it('uses the model default when a saved tab choice is no longer supported', () => {
    const selections = new Map([['pi:pi/model', 'obsolete']]);
    const settings = { model: 'pi/model', effortLevel: 'medium', thinkingBudget: 'medium' };
    const resolved = resolveTabReasoningSettings(
      settings,
      'pi',
      selections,
      createUiConfig(['low', 'high'], 'high', false),
    );

    expect(resolved.thinkingBudget).toBe('high');
    expect(selections.get('pi:pi/model')).toBe('high');
  });
});
