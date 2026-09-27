import { decodeClaudeModels } from '@/providers/claude/modelCatalog';

describe('decodeClaudeModels', () => {
  it('filters invalid records and keeps the first normalized entry for each model ID', () => {
    expect(decodeClaudeModels([
      null,
      { value: '  claude-opus-4-7  ', label: '  Opus 4.7  ', description: 'New model' },
      { value: 'claude-opus-4-7', label: 'Duplicate' },
      { value: '  ', label: 'Empty' },
      { value: 123, label: 'Invalid' },
    ])).toEqual([
      {
        value: 'claude-opus-4-7',
        label: 'Opus 4.7',
        description: 'New model',
      },
    ]);
  });

  it('falls back to the model ID for blank labels and preserves resolved model IDs', () => {
    expect(decodeClaudeModels([
      {
        value: 'claude-custom',
        label: ' ',
        description: 12,
        resolvedModel: ' claude-resolved ',
      },
    ])).toEqual([
      {
        value: 'claude-custom',
        label: 'claude-custom',
        description: '',
        resolvedModel: 'claude-resolved',
      },
    ]);
  });

  it('returns an empty list for non-array SDK results', () => {
    expect(decodeClaudeModels({ models: [] })).toEqual([]);
  });
});
