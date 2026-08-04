import { buildOmpUsageInfo } from '@/providers/omp/execution/OmpExecutionSession';

describe('OMP usage projection', () => {
  it('projects ACP context usage into the chat context meter', () => {
    expect(buildOmpUsageInfo({ size: 200_000, used: 42_000 }, 'openai/gpt-5-mini')).toEqual({
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      contextTokens: 42_000,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 0,
      model: 'openai/gpt-5-mini',
      percentage: 21,
    });
  });
});
