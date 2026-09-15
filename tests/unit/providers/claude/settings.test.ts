const mockGetHostnameKey = jest.fn(() => 'device:current');

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => mockGetHostnameKey(),
}));

import { getClaudeProviderSettings } from '@/providers/claude/settings';

describe('Claude settings normalization', () => {
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
});
