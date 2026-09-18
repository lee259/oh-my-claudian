import {
  reportHistoryReplay,
  reportResolvedTurnPrompt,
} from '@/core/execution';

describe('reportResolvedTurnPrompt', () => {
  it('reports only prompt size metadata through the diagnostics port', () => {
    const onResolved = jest.fn();

    reportResolvedTurnPrompt({
      input: [{ type: 'text', text: 'secret input' }],
      configuration: { systemInstructions: { kind: 'none' } },
      toolPolicy: { kind: 'provider-default' },
      diagnostics: { onResolved },
      signal: new AbortController().signal,
    }, 42);

    expect(onResolved).toHaveBeenCalledWith({
      turnPrompt: {
        source: 'provider',
        characters: 42,
        sections: [{ name: 'turn-prompt', characters: 42 }],
      },
    });
    expect(JSON.stringify(onResolved.mock.calls[0])).not.toContain('secret input');
  });
});

describe('reportHistoryReplay', () => {
  it('reports only history compaction metadata through the diagnostics port', () => {
    const onResolved = jest.fn();

    reportHistoryReplay({
      input: [{ type: 'text', text: 'secret input' }],
      configuration: { systemInstructions: { kind: 'none' } },
      toolPolicy: { kind: 'provider-default' },
      diagnostics: { onResolved },
      signal: new AbortController().signal,
    }, {
      budgetCharacters: 32000,
      originalCharacters: 64000,
      finalCharacters: 28000,
      totalTurns: 12,
      includedTurns: 5,
      omittedTurns: 7,
      truncatedMessages: 1,
      wasCompacted: true,
    });

    expect(onResolved).toHaveBeenCalledWith({
      historyReplay: {
        budgetCharacters: 32000,
        originalCharacters: 64000,
        finalCharacters: 28000,
        totalTurns: 12,
        includedTurns: 5,
        omittedTurns: 7,
        truncatedMessages: 1,
        wasCompacted: true,
      },
    });
    expect(JSON.stringify(onResolved.mock.calls[0])).not.toContain('secret input');
  });
});
