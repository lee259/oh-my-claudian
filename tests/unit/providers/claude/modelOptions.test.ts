import { getClaudeModelOptions } from '@/providers/claude/modelOptions';
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS } from '@/providers/claude/settings';

describe('getClaudeModelOptions discovered models', () => {
  it('uses discovered labels for built-in models and adds newly reported model IDs', () => {
    const options = getClaudeModelOptions({
      providerConfigs: {
        claude: {
          ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
          discoveredModels: [
            {
              value: 'opus',
              label: 'Claude Opus (account)',
              description: 'Account-specific Opus',
            },
            {
              value: 'claude-opus-4-7',
              label: 'Claude Opus 4.7',
              description: 'New release',
            },
          ],
        },
      },
    });

    expect(options.find(option => option.value === 'opus')).toMatchObject({
      label: 'Claude Opus (account)',
      description: 'Account-specific Opus',
    });
    expect(options.find(option => option.label === 'Claude Opus 4.7')).toMatchObject({
      label: 'Claude Opus 4.7',
      description: 'New release',
    });
  });
});
