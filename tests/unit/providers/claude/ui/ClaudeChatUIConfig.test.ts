import { setLocale } from '@/i18n/i18n';
import * as claudeUserSettingsEnv from '@/providers/claude/env/claudeUserSettingsEnv';
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS } from '@/providers/claude/settings';
import { claudeChatUIConfig } from '@/providers/claude/ui/ClaudeChatUIConfig';

describe('claudeChatUIConfig', () => {
  describe('permission modes', () => {
    it('exposes Claude modes with names and descriptions that match their behavior', () => {
      const options = claudeChatUIConfig.getPermissionModeOptions?.({});

      expect(options?.map(({ value, label }) => [value, label])).toEqual([
        ['claude-manual', 'Manual'],
        ['claude-edit', 'Accept edits'],
        ['plan', 'Plan'],
        ['claude-auto', 'Auto'],
      ]);
      expect(options?.every(option => option.description && option.icon)).toBe(true);
    });

    it('resolves mode labels using the active locale', () => {
      setLocale('zh-CN');
      expect(claudeChatUIConfig.getPermissionModeOptions?.({})[1]?.label).toBe('接受编辑');
      setLocale('en');
      expect(claudeChatUIConfig.getPermissionModeOptions?.({})[1]?.label).toBe('Accept edits');
    });

    it.each([
      [{ permissionMode: 'normal', providerConfigs: { claude: { safeMode: 'default' } } }, 'claude-manual'],
      [{ permissionMode: 'normal', providerConfigs: { claude: { safeMode: 'acceptEdits' } } }, 'claude-edit'],
      [{ permissionMode: 'plan', providerConfigs: { claude: { safeMode: 'acceptEdits' } } }, 'plan'],
      [{ permissionMode: 'normal', providerConfigs: { claude: { safeMode: 'auto' } } }, 'claude-auto'],
    ])('resolves the selected Claude mode from provider settings', (settings, expected) => {
      expect(claudeChatUIConfig.resolvePermissionModeOption?.(settings)).toBe(expected);
    });

    it('does not expose legacy YOLO as a Claude-native mode', () => {
      expect(claudeChatUIConfig.resolvePermissionModeOption?.({ permissionMode: 'yolo' }))
        .toBeNull();
    });

    it.each([
      ['claude-manual', 'default', 'normal'],
      ['claude-edit', 'acceptEdits', 'normal'],
      ['claude-auto', 'auto', 'normal'],
      ['plan', 'acceptEdits', 'plan'],
    ])('applies %s without conflating Claude modes', (value, safeMode, permissionMode) => {
      const settings: Record<string, unknown> = {
        permissionMode: 'normal',
        providerConfigs: { claude: { safeMode: 'acceptEdits' } },
      };

      claudeChatUIConfig.applyPermissionMode?.(value, settings);

      expect((settings.providerConfigs as Record<string, Record<string, unknown>>).claude.safeMode)
        .toBe(safeMode);
      expect(settings.permissionMode).toBe(permissionMode);
    });
  });

  describe('getDefaultModel', () => {
    it('prefers Opus for fresh Claude settings', () => {
      expect(DEFAULT_CLAUDE_PROVIDER_SETTINGS.defaultModel).toBe('opus');
      expect(claudeChatUIConfig.getDefaultModel?.({})).toBe('opus');
    });

    it('follows the Opus environment slot when it overrides the model id', () => {
      expect(claudeChatUIConfig.getDefaultModel?.({
        providerConfigs: {
          claude: {
            defaultModel: 'opus',
            environmentVariables: 'ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-enterprise',
          },
        },
      })).toBe('claude-code/claude-opus-enterprise');
    });

    it('supports a custom model selected as the Claude provider default', () => {
      expect(claudeChatUIConfig.getDefaultModel?.({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
            defaultModel: 'claude-code/claude-opus-4-6',
          },
        },
      })).toBe('claude-code/claude-opus-4-6');
    });

    it('falls back to the first dynamic option when the preference is unavailable', () => {
      expect(claudeChatUIConfig.getDefaultModel?.({
        providerConfigs: {
          claude: {
            defaultModel: 'retired-model',
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-gateway',
          },
        },
      })).toBe('claude-code/claude-sonnet-gateway');
    });
  });

  it('defaults Claude models to high effort', () => {
    expect(claudeChatUIConfig.getDefaultReasoningValue('haiku', {})).toBe('high');
    expect(claudeChatUIConfig.getDefaultReasoningValue('custom-model', {})).toBe('high');
  });

  describe('getModelOptions', () => {
    it('appends settings-defined custom models after the built-in options', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6\nclaude-opus-4-6[1m]',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'haiku',
        'sonnet',
        'opus',
        'fable',
        'claude-code/claude-opus-4-6',
        'claude-code/claude-opus-4-6[1m]',
      ]);
      expect(options.slice(-2)).toEqual([
        {
          value: 'claude-code/claude-opus-4-6',
          label: 'Opus 4.6',
          description: 'Custom model',
        },
        {
          value: 'claude-code/claude-opus-4-6[1m]',
          label: 'Opus 4.6 (1M)',
          description: 'Custom model',
        },
      ]);
    });

    it('deduplicates settings-defined custom models against exact duplicates', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'haiku\nclaude-fable-5\nclaude-opus-4-6\nclaude-opus-4-6\n',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'haiku',
        'sonnet',
        'opus',
        'fable',
        'claude-code/claude-opus-4-6',
      ]);
    });

    it('formats dated settings-defined custom models with shortened date tags', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-5-20251101',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-code/claude-opus-4-5-20251101',
        label: 'Opus 4.5 (2511)',
        description: 'Custom model',
      });
    });

    it('formats a future fable custom model id without the built-in default', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-fable-6',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-code/claude-fable-6',
        label: 'Fable 6',
        description: 'Custom model',
      });
    });

    it('uses custom model aliases for settings-defined custom model labels', () => {
      const options = claudeChatUIConfig.getModelOptions({
        customModelAliases: {
          'claude-opus-4-6': 'Work Opus',
        },
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-code/claude-opus-4-6',
        label: 'Work Opus',
        description: 'Custom model',
      });
    });

    it('replaces defaults with environment models and preserves configured custom models', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-4-5',
          },
        },
      });

      expect(options).toEqual([
        {
          value: 'claude-code/claude-sonnet-4-5',
          label: 'Sonnet 4.5',
          description: 'Custom model (model)',
          environmentTypes: ['model'],
        },
        {
          value: 'claude-code/claude-opus-4-6',
          label: 'Opus 4.6',
          description: 'Custom model',
        },
      ]);
    });

    it('keeps locally configured custom models alongside the active environment model', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'kimi-k3\nmodel-two\nmodel-three\nmodel-four',
            environmentVariables: 'ANTHROPIC_MODEL=kimi-k3',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'claude-code/kimi-k3',
        'claude-code/model-two',
        'claude-code/model-three',
        'claude-code/model-four',
      ]);
    });

    it('keeps discovered local catalog models alongside the active environment model', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            environmentVariables: 'ANTHROPIC_MODEL=kimi-k3',
            visibleModels: [
              'gpt-5.6-luna',
              'deepseek-flash',
              'deepseek-v4-pro',
              'kimi-k3',
            ],
            discoveredModels: [
              { value: 'gpt-5.6-luna', label: 'gpt-5.6-luna', description: 'Haiku slot' },
              { value: 'deepseek-flash', label: 'deepseek-flash', description: 'Sonnet slot' },
              { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro', description: 'Opus slot' },
              { value: 'kimi-k3', label: 'kimi-k3', description: 'Fable slot' },
              { value: 'hidden-model', label: 'hidden-model', description: 'Not selected' },
            ],
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'claude-code/kimi-k3',
        'claude-code/gpt-5.6-luna',
        'claude-code/deepseek-flash',
        'claude-code/deepseek-v4-pro',
      ]);
    });

    it('uses custom model aliases for environment-defined custom model labels', () => {
      const options = claudeChatUIConfig.getModelOptions({
        customModelAliases: {
          'claude-sonnet-4-5': 'Gateway Sonnet',
        },
        providerConfigs: {
          claude: {
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-4-5',
          },
        },
      });

      expect(options).toEqual([
        {
          value: 'claude-code/claude-sonnet-4-5',
          label: 'Gateway Sonnet',
          description: 'Custom model (model)',
          environmentTypes: ['model'],
        },
      ]);
    });

    it('shows the actual mapped target instead of SDK tier labels when tiers share a model', () => {
      jest.spyOn(claudeUserSettingsEnv, 'getClaudeUserSettingsModelEnvironment')
        .mockReturnValueOnce({
          env: {
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'newapi/deepseek-flash[1m]',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'newapi/deepseek-flash[1m]',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'newapi/deepseek-flash[1m]',
            ANTHROPIC_DEFAULT_FABLE_MODEL: 'newapi/deepseek-flash[1m]',
          },
          displayNames: {},
          tierDisplayNames: {},
        });

      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            discoveredModels: [
              { value: 'haiku', label: 'SDK Haiku', description: '', resolvedModel: 'newapi/deepseek-flash[1m]' },
              { value: 'sonnet', label: 'SDK Sonnet', description: '', resolvedModel: 'newapi/deepseek-flash[1m]' },
              { value: 'opus', label: 'SDK Opus', description: '', resolvedModel: 'newapi/deepseek-flash[1m]' },
              { value: 'fable', label: 'SDK Fable', description: '', resolvedModel: 'newapi/deepseek-flash[1m]' },
            ],
          },
        },
      });

      expect(options.map(({ value, label }) => [value, label])).toEqual([
        ['claude-code/haiku', 'newapi/deepseek-flash[1m]'],
        ['claude-code/sonnet', 'newapi/deepseek-flash[1m]'],
        ['claude-code/opus', 'newapi/deepseek-flash[1m]'],
        ['claude-code/fable', 'newapi/deepseek-flash[1m]'],
      ]);
    });

    it('does not override actual mapped targets with stale local display names', () => {
      jest.spyOn(claudeUserSettingsEnv, 'getClaudeUserSettingsModelEnvironment')
        .mockReturnValue({
          env: {
            ANTHROPIC_MODEL: 'newapi/deepseek-flash[1m]',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'newapi/deepseek-flash[1m]',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'newapi/deepseek-flash[1m]',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'newapi/deepseek-flash[1m]',
            ANTHROPIC_DEFAULT_FABLE_MODEL: 'newapi/deepseek-flash[1m]',
          },
          displayNames: {
            'newapi/deepseek-flash[1m]': 'kimi-k3',
          },
          tierDisplayNames: {
            haiku: 'gpt-5.6-luna',
            sonnet: 'deepseek-flash',
            opus: 'deepseek-v4-pro',
            fable: 'kimi-k3',
          },
        });

      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            discoveredModels: [
              { value: 'haiku', label: 'SDK Haiku', description: '' },
              { value: 'sonnet', label: 'SDK Sonnet', description: '' },
              { value: 'opus', label: 'SDK Opus', description: '' },
              { value: 'fable', label: 'SDK Fable', description: '' },
            ],
          },
        },
      });

      expect(options.map(({ value, label }) => [value, label])).toEqual([
        ['claude-code/haiku', 'newapi/deepseek-flash[1m]'],
        ['claude-code/sonnet', 'newapi/deepseek-flash[1m]'],
        ['claude-code/opus', 'newapi/deepseek-flash[1m]'],
        ['claude-code/fable', 'newapi/deepseek-flash[1m]'],
      ]);
      const selectedSettings: Record<string, unknown> = {};
      claudeChatUIConfig.applyModelDefaults('claude-code/sonnet', selectedSettings);
      expect((selectedSettings.providerConfigs as Record<string, Record<string, unknown>>)
        .claude.modelEnvironmentType).toBe('sonnet');
    });
  });

  describe('getReasoningOptions', () => {
    it('hides xhigh on models that do not support it', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-sonnet-4-5', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'max']);
    });

    it('keeps xhigh on supported opus models', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-opus-4-7', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
      expect(options.find(option => option.value === 'medium')?.label).toBe('Medium');
      expect(options.find(option => option.value === 'xhigh')?.label).toBe('xHigh');
    });

    it('keeps xhigh on fable models', () => {
      const options = claudeChatUIConfig.getReasoningOptions('fable', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('uses effort options for custom model ids', () => {
      const options = claudeChatUIConfig.getReasoningOptions('custom-model', {});

      expect(options.map(option => option.value)).toEqual([
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]);
      expect(options.some(option => option.tokens !== undefined)).toBe(false);
    });
  });

  describe('applyModelDefaults', () => {
    it('persists the tier identity of an environment-mapped model', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'high',
        providerConfigs: {
          claude: {
            lastModel: 'haiku',
            environmentVariables: [
              'ANTHROPIC_DEFAULT_HAIKU_MODEL=custom-haiku',
              'ANTHROPIC_DEFAULT_FABLE_MODEL=gpt-4.1',
            ].join('\n'),
          },
        },
      };

      claudeChatUIConfig.applyModelDefaults('claude-code/gpt-4.1', settings);

      expect((settings.providerConfigs as Record<string, Record<string, unknown>>).claude.lastModel)
        .toBe('fable');
      expect((settings.providerConfigs as Record<string, Record<string, unknown>>).claude.modelEnvironmentType)
        .toBe('fable');
      expect(settings.lastCustomModel).toBeUndefined();
    });

    it('preserves the environment tier of a concrete legacy Fable ID', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'high',
        providerConfigs: {
          claude: {
            lastModel: 'fable',
            modelEnvironmentType: 'fable',
            environmentVariables: [
              'ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-fable-5',
              'ANTHROPIC_DEFAULT_FABLE_MODEL=gpt-4.1',
            ].join('\n'),
          },
        },
      };

      claudeChatUIConfig.applyModelDefaults('claude-code/claude-fable-5', settings);

      expect((settings.providerConfigs as Record<string, Record<string, unknown>>).claude)
        .toMatchObject({
          lastModel: 'haiku',
          modelEnvironmentType: 'haiku',
        });
    });

    it('clamps stale xhigh effort when switching to a custom sonnet model', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
        providerConfigs: {},
      };

      claudeChatUIConfig.applyModelDefaults('claude-sonnet-4-5', settings);

      expect(settings.effortLevel).toBe('high');
      expect(settings.lastCustomModel).toBe('claude-sonnet-4-5');
    });

    it('preserves xhigh on custom opus models that support it', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
        providerConfigs: {},
      };

      claudeChatUIConfig.applyModelDefaults('claude-opus-4-7', settings);

      expect(settings.effortLevel).toBe('xhigh');
    });
  });

  describe('applyModelProjectionDefaults', () => {
    it('preserves a user-selected effort for default tier models', () => {
      const settings: Record<string, unknown> = { effortLevel: 'low' };

      claudeChatUIConfig.applyModelProjectionDefaults?.('opus', settings);

      expect(settings.effortLevel).toBe('low');
    });

    it('preserves xhigh on the opus alias that supports it', () => {
      const settings: Record<string, unknown> = { effortLevel: 'xhigh' };

      claudeChatUIConfig.applyModelProjectionDefaults?.('opus', settings);

      expect(settings.effortLevel).toBe('xhigh');
    });

    it('clamps an effort the projected model cannot use', () => {
      const settings: Record<string, unknown> = { effortLevel: 'xhigh' };

      // The haiku alias does not support xhigh -> fall back to the default.
      claudeChatUIConfig.applyModelProjectionDefaults?.('haiku', settings);

      expect(settings.effortLevel).toBe('high');
    });
  });
});
