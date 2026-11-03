import { renderClaudeModelPicker } from '@/providers/claude/ui/ClaudeModelPicker';
import type { ProviderModelPickerOptions } from '@/shared/settings/ProviderModelPicker';

let mockOptions: ProviderModelPickerOptions;
jest.mock('@/shared/settings/ProviderModelPicker', () => ({
  renderProviderModelPicker: (options: ProviderModelPickerOptions) => {
    mockOptions = options;
    return { refresh: jest.fn(), dispose: jest.fn() };
  },
}));

it('persists explicit enabled models while retaining other provider settings', async () => {
  const settings: any = { providerConfigs: { claude: { customModels: 'custom-a', safeMode: 'auto' } }, customModelAliases: {} };
  const context: any = { plugin: { settings, mutateSettings: async (fn: (value: any) => void) => fn(settings) }, notifyProviderModelOptionsChanged: jest.fn() };
  renderClaudeModelPicker({} as HTMLElement, context, {} as never, jest.fn(), jest.fn());
  expect(mockOptions.getState().selectedIds).toContain('sonnet');
  await mockOptions.onSelectedIdsChange(['sonnet']);
  expect(settings.providerConfigs.claude.visibleModels).toEqual(['sonnet']);
  expect(settings.providerConfigs.claude.safeMode).toBe('auto');
  expect(context.notifyProviderModelOptionsChanged).toHaveBeenCalledWith('claude');
});

it('keeps unrelated aliases while updating an enabled model alias', async () => {
  const settings: any = { providerConfigs: { claude: {} }, customModelAliases: { unrelated: 'Keep' } };
  const context: any = { plugin: { settings, mutateSettings: async (fn: (value: any) => void) => fn(settings) }, notifyProviderModelOptionsChanged: jest.fn() };
  renderClaudeModelPicker({} as HTMLElement, context, {} as never, jest.fn(), jest.fn());
  await mockOptions.onAliasesChange({ sonnet: 'Writing' });
  expect(settings.customModelAliases).toMatchObject({ sonnet: 'Writing', unrelated: 'Keep' });
});

it('uses the first enabled model as default and supports disabling all models', async () => {
  const settings: any = { providerConfigs: { claude: { defaultModel: 'opus' } }, customModelAliases: {} };
  const context: any = { plugin: { settings, mutateSettings: async (fn: (value: any) => void) => fn(settings) }, notifyProviderModelOptionsChanged: jest.fn() };
  renderClaudeModelPicker({} as HTMLElement, context, {} as never, jest.fn(), jest.fn());
  expect(mockOptions.getState().selectedIds[0]).toBe('opus');
  await mockOptions.onSelectedIdsChange(['sonnet', 'opus']);
  expect(settings.providerConfigs.claude.defaultModel).toBe('sonnet');
  await mockOptions.onSelectedIdsChange([]);
  expect(mockOptions.getState().selectedIds).toEqual([]);
  expect(mockOptions.getState().defaultModelId).toBeNull();
});

it('retains the Claude tier preference for an environment-mapped model', async () => {
  const settings: any = { providerConfigs: { claude: {
    environmentVariables: 'ANTHROPIC_DEFAULT_OPUS_MODEL=gateway/opus', defaultModel: 'opus',
  } }, customModelAliases: {} };
  const context: any = { plugin: { settings, mutateSettings: async (fn: (value: any) => void) => fn(settings) }, notifyProviderModelOptionsChanged: jest.fn() };
  renderClaudeModelPicker({} as HTMLElement, context, {} as never, jest.fn(), jest.fn());
  const opus = mockOptions.getState().models.find(model => model.id.includes('gateway/opus'));
  expect(opus).toBeDefined();
  await mockOptions.onSelectedIdsChange([opus!.id]);
  expect(settings.providerConfigs.claude.defaultModel).toBe('opus');
});
