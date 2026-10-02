const mockGetHostnameKey = jest.fn(() => 'device:current');

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => mockGetHostnameKey(),
}));

import { getClaudeProviderSettings } from '@/providers/claude/settings';

describe('Claude settings normalization', () => {
  it('keeps subagent progress summaries disabled by default and decodes stored values', () => {
    expect(getClaudeProviderSettings({}).agentProgressSummaries).toBe(false);
    expect(getClaudeProviderSettings({
      providerConfigs: { claude: { agentProgressSummaries: true } },
    }).agentProgressSummaries).toBe(true);
    expect(getClaudeProviderSettings({
      providerConfigs: { claude: { agentProgressSummaries: 'yes' } },
    }).agentProgressSummaries).toBe(false);
  });

  it('keeps prompt suggestions disabled by default and decodes stored values', () => {
    expect(getClaudeProviderSettings({}).promptSuggestions).toBe(false);
    expect(getClaudeProviderSettings({
      providerConfigs: { claude: { promptSuggestions: true } },
    }).promptSuggestions).toBe(true);
    expect(getClaudeProviderSettings({
      providerConfigs: { claude: { promptSuggestions: 'yes' } },
    }).promptSuggestions).toBe(false);
  });

  it('normalizes mixed CLI maps without interpreting host-shaped keys', () => {
    expect(getClaudeProviderSettings({
      providerConfigs: {
        claude: {
          cliPathsByHost: {
            ' legacy-host ': ' /legacy/claude ',
            invalid: 42,
            empty: '',
          },
        },
      },
    }).cliPathsByHost).toEqual({
      'legacy-host': '/legacy/claude',
    });
  });

  it('rejects arrays as CLI maps', () => {
    expect(getClaudeProviderSettings({
      providerConfigs: { claude: { cliPathsByHost: ['/array/claude'] } },
    }).cliPathsByHost).toEqual({});
  });

  it('normalizes the explicitly visible model list from provider settings', () => {
    expect(getClaudeProviderSettings({
      providerConfigs: {
        claude: { visibleModels: [' haiku ', 'sonnet', 'haiku', 42] },
      },
    }).visibleModels).toEqual(['haiku', 'sonnet']);
    expect(getClaudeProviderSettings({}).visibleModels).toBeNull();
  });
});
