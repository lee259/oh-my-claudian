import * as fs from 'fs';

import { readClaudeUserSettingsModelFile } from '@/providers/claude/env/claudeUserSettingsEnv';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));

describe('readClaudeUserSettingsModelFile', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads only model settings and maps native display names to model ids', () => {
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'secret',
        ANTHROPIC_MODEL: 'gateway-default',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-7',
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'Claude Sonnet 4.7 Custom',
        CLAUDE_CODE_USE_BEDROCK: '1',
      },
    }));

    expect(readClaudeUserSettingsModelFile('/settings.json')).toEqual({
      env: {
        ANTHROPIC_MODEL: 'gateway-default',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-7',
      },
      displayNames: {
        'claude-sonnet-4-7': 'Claude Sonnet 4.7 Custom',
      },
    });
  });

  it('returns an empty model environment for missing or malformed settings', () => {
    (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('missing'); });
    expect(readClaudeUserSettingsModelFile('/missing.json')).toEqual({ env: {}, displayNames: {} });

    (fs.readFileSync as jest.Mock).mockReturnValue('{invalid');
    expect(readClaudeUserSettingsModelFile('/invalid.json')).toEqual({ env: {}, displayNames: {} });
  });
});
