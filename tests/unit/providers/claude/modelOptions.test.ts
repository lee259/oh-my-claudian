import { findClaudeModelOption, getClaudeModelOptions } from '@/providers/claude/modelOptions';
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

  it('uses the SDK identity when a saved tier alias is no longer reported', () => {
    const options = getClaudeModelOptions({
      providerConfigs: {
        claude: {
          ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
          discoveredModels: [
            {
              value: 'opus[1m]',
              resolvedModel: 'claude-opus-5-5[1m]',
              label: 'Claude Opus 5.5 (1M)',
              description: 'Latest Opus',
            },
          ],
        },
      },
    });

    expect(options.find(option => option.value.includes('opus'))).toMatchObject({
      value: 'claude-code/opus[1m]',
      label: 'Claude Opus 5.5 (1M)',
    });
  });

  it('resolves a saved tier alias to the highest discovered numeric model version', () => {
    const options = getClaudeModelOptions({
      providerConfigs: {
        claude: {
          ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
          discoveredModels: [
            { value: 'claude-opus-5-2', label: 'Opus 5.2', description: '' },
            { value: 'claude-opus-5-10', label: 'Opus 5.10', description: '' },
          ],
        },
      },
    });

    expect(options.find(option => option.label === 'Opus 5.10')?.value)
      .toBe('claude-code/claude-opus-5-10');
    expect(findClaudeModelOption(options, 'opus')?.value)
      .toBe('claude-code/claude-opus-5-10');
  });

  it('ignores snapshot dates when ranking versions and prefers standard context on ties', () => {
    const options = getClaudeModelOptions({
      providerConfigs: {
        claude: {
          ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
          discoveredModels: [
            { value: 'claude-opus-5-9', label: 'Opus 5.9', description: '' },
            { value: 'claude-opus-5-10-20260901', label: 'Opus snapshot', description: '' },
            { value: 'claude-opus-5-10[1m]', label: 'Opus 1M', description: '' },
          ],
        },
      },
    });

    expect(options.find(option => option.label.startsWith('Opus'))?.value)
      .toBe('claude-code/claude-opus-5-10-20260901');
  });
});
