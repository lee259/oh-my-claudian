import { readAntigravityModelList } from '@/providers/antigravity/models';

describe('readAntigravityModelList', () => {
  it('groups effort variants while preserving fixed-effort model ids', () => {
    const models = readAntigravityModelList([
      'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
      'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
      'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
      'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
      'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
    ].join('\n'));

    expect(models.map(model => model.rawId)).toEqual([
      'gemini-3.8-flash',
      'claude-sonnet-4-6',
      'gpt-oss-120b-medium',
    ]);
    expect(models[0]?.reasoningEfforts.map(effort => effort.value)).toEqual(['low', 'medium', 'high']);
    expect(models[2]?.reasoningEfforts).toEqual([]);
  });
});
