import { claudeProviderRegistration } from '@/providers/claude/registration';
import { claudeChatUIConfig } from '@/providers/claude/ui/ClaudeChatUIConfig';

describe('Claude provider model resolution', () => {
  it('resolves a saved title tier alias to the discovered SDK identity', () => {
    const settings = {
      titleGenerationModel: 'opus',
      providerConfigs: {
        claude: {
          discoveredModels: [
            {
              value: 'opus[1m]',
              resolvedModel: 'claude-opus-5-5[1m]',
              label: 'Claude Opus 5.5 (1M)',
              description: '',
            },
          ],
        },
      },
    };

    expect(claudeProviderRegistration.resolveTitleGenerationModel?.({
      settings,
      getActiveEnvironmentVariables: () => '',
    } as never)).toBe('opus[1m]');
    expect(claudeChatUIConfig.getDefaultModel?.(settings)).toBe('claude-code/opus[1m]');
  });
});
